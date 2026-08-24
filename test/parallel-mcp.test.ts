import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createMcpBackedTools } from '../src/mcp.js'
import { createDefaultToolRegistry, hydrateMcpTools } from '../src/tools/index.js'

const searchResult = {
  results: [
    {
      url: 'https://example.com/result',
      title: null,
      excerpts: ['Canonical result excerpt.'],
    },
  ],
}

async function withMcpServer(
  run: (url: string, requests: Array<{ method?: string; params?: unknown; headers?: Record<string, string | string[] | undefined> }>) => Promise<void>,
): Promise<void> {
  const requests: Array<{ method?: string; params?: unknown; headers?: Record<string, string | string[] | undefined> }> = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      id?: number
      method?: string
      params?: unknown
    }
    requests.push({ ...message, headers: request.headers })

    let result: unknown = {}
    if (message.method === 'initialize') {
      result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mock', version: '1' } }
    } else if (message.method === 'tools/list') {
      result = {
        tools: [
          {
            name: 'web_search',
            inputSchema: {
              type: 'object',
              properties: {
                objective: { type: 'string' },
                search_queries: { type: 'array', items: { type: 'string' } },
              },
              required: ['objective', 'search_queries'],
              additionalProperties: false,
            },
          },
          {
            name: 'web_fetch',
            inputSchema: {
              type: 'object',
              properties: { urls: { type: 'array', items: { type: 'string' } } },
              required: ['urls'],
              additionalProperties: false,
            },
          },
        ],
      }
    } else if (message.method === 'resources/list') {
      result = { resources: [] }
    } else if (message.method === 'prompts/list') {
      result = { prompts: [] }
    } else if (message.method === 'tools/call') {
      const params = message.params as { name?: string; arguments?: unknown }
      if (params.name === 'web_search') {
        const args = params.arguments as { objective?: string }
        result = args.objective === 'Force an MCP error'
          ? {
              isError: true,
              structuredContent: { error: 'Parallel search failed' },
              content: [{ type: 'text', text: 'mirrored error' }],
            }
          : {
              structuredContent: searchResult,
              content: [{ type: 'text', text: JSON.stringify(searchResult) }],
            }
      } else if (params.name === 'web_fetch') {
        result = {
          structuredContent: { pages: [{ url: 'https://example.com/requested', excerpts: ['Requested page excerpt.'], title: null }] },
          content: [{ type: 'text', text: 'mirrored fetch payload' }],
        }
      }
    }

    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address === 'object')
  try {
    await run(`http://127.0.0.1:${address.port}/mcp`, requests)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

test('Parallel Streamable HTTP discovers and calls both hosted tools without duplicate payloads', async () => {
  await withMcpServer(async (url, requests) => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (input, init) => {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      return originalFetch(target === 'https://search.parallel.ai/mcp' ? url : input, init)
    }

    const customHeader = 'kept-by-minicode'
    let mcp: Awaited<ReturnType<typeof createMcpBackedTools>> | undefined
    try {
      mcp = await createMcpBackedTools({
        cwd: process.cwd(),
        mcpServers: {
          'parallel-search': {
            command: '',
            url: 'https://search.parallel.ai/mcp',
            protocol: 'streamable-http',
            headers: { 'X-User-Header': customHeader },
          },
        },
      })
      assert.deepEqual(mcp.tools.map(tool => tool.name), [
        'mcp__parallel-search__web_search',
        'mcp__parallel-search__web_fetch',
      ])

      const search = mcp.tools[0]
      const searchOutput = await search.run({
        objective: 'Find current MCP compatibility information',
        search_queries: ['MiniCode MCP Streamable HTTP'],
      }, { cwd: process.cwd() })
      assert.equal(searchOutput.ok, true)
      assert.equal(searchOutput.output, JSON.stringify(searchResult, null, 2))
      assert.equal(searchOutput.output.match(/Canonical result excerpt\./g)?.length, 1)
      assert.equal(JSON.stringify(requests).includes('https://example.com/requested'), false)

      const fetchTool = mcp.tools[1]
      const fetchOutput = await fetchTool.run(
        { urls: ['https://example.com/requested'] },
        { cwd: process.cwd() },
      )
      assert.equal(fetchOutput.ok, true)
      assert.match(fetchOutput.output, /Requested page excerpt\./)

      const errorOutput = await search.run(
        { objective: 'Force an MCP error', search_queries: ['failing query'] },
        { cwd: process.cwd() },
      )
      assert.equal(errorOutput.ok, false)
      assert.equal(errorOutput.output, JSON.stringify({ error: 'Parallel search failed' }, null, 2))
      assert(requests.every(request => request.headers?.['x-user-header'] === customHeader))

      const calls = requests.filter(request => request.method === 'tools/call')
      assert.deepEqual(calls.map(call => call.params), [
        {
          name: 'web_search',
          arguments: {
            objective: 'Find current MCP compatibility information',
            search_queries: ['MiniCode MCP Streamable HTTP'],
          },
        },
        {
          name: 'web_fetch',
          arguments: { urls: ['https://example.com/requested'] },
        },
        {
          name: 'web_search',
          arguments: {
            objective: 'Force an MCP error',
            search_queries: ['failing query'],
          },
        },
      ])
    } finally {
      await mcp?.dispose()
      globalThis.fetch = originalFetch
    }
  })
})

test('generic MCP formatting and the default no-server registry stay unchanged', async () => {
  const registry = await createDefaultToolRegistry({ cwd: process.cwd(), runtime: null })
  assert(registry.find('web_search'))
  assert(registry.find('web_fetch'))
  await hydrateMcpTools({ cwd: process.cwd(), runtime: null, tools: registry })
  assert.deepEqual(registry.getMcpServers(), [])
  await registry.dispose()

  await withMcpServer(async (url) => {
    const mcp = await createMcpBackedTools({
      cwd: process.cwd(),
      mcpServers: { custom: { command: '', url, headers: { 'X-User-Header': 'preserved' } } },
    })
    try {
      const result = await mcp.tools[0].run(
        { objective: 'custom', search_queries: ['custom'] },
        { cwd: process.cwd() },
      )
      assert.match(result.output, /Canonical result excerpt\./)
      assert.match(result.output, /STRUCTURED_CONTENT:/)
    } finally {
      await mcp.dispose()
    }
  })
})
