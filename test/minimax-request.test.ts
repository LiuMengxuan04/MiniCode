import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { AnthropicModelAdapter } from '../src/anthropic-adapter.js'
import { runAgentTurn } from '../src/agent-loop.js'
import { ToolRegistry } from '../src/tool.js'
import type { RuntimeConfig } from '../src/config.js'

const originalFetch = globalThis.fetch
const endpoints = ['https://api.minimax.io/anthropic', 'https://api.minimaxi.com/anthropic/']
type RequestBody = {
  model: string
  max_tokens: number
  messages: Array<{ role: string; content: Array<Record<string, unknown>> }>
  tools: Array<{ name: string }>
  thinking?: unknown
  output_config?: unknown
  service_tier?: unknown
}

afterEach(() => { globalThis.fetch = originalFetch })

function runtime(model: string, baseUrl: string, maxOutputTokens?: number): RuntimeConfig {
  return { model, baseUrl, maxOutputTokens, apiKey: 'test-key', mcpServers: {}, sourceSummary: 'test' }
}

function captureRequests() {
  const requests: Array<{ url: string; body: RequestBody }> = []
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '<final>done' }] })
  }) as typeof fetch
  return requests
}

describe('MiniMax HTTP requests', () => {
  for (const baseUrl of endpoints) {
    it(`uses the current direct MiniMax output limits at ${baseUrl}`, async () => {
      const requests = captureRequests()
      for (const model of ['MiniMax-M3.1-Flash', 'MiniMax-M3']) {
        for (const [configured, expected] of [[undefined, 32_000], [100_000, 100_000], [600_000, 524_288]] as const) {
          const adapter = new AnthropicModelAdapter(new ToolRegistry([]), async () =>
            runtime(model, baseUrl, configured))
          await adapter.next([{ role: 'user', content: 'hello' }])
          const request = requests.at(-1)!
          assert.equal(request.url, `${baseUrl.replace(/\/$/, '')}/v1/messages`)
          assert.equal(request.body.model, model)
          assert.equal(request.body.max_tokens, expected)
          assert.equal(request.body.thinking, undefined)
          assert.equal(request.body.output_config, undefined)
          assert.equal(request.body.service_tier, undefined)
        }
      }
    })
  }

  for (const [model, baseUrl] of [
    ['MiniMax-M3', 'https://gateway.example/anthropic'],
    ['MiniMax-M2.7', endpoints[1]],
    ['custom-model', endpoints[0]],
    ['MiniMax-M3.1-Flash', 'https://gateway.example/anthropic'],
    ['MiniMax-M3.1-Flash', 'https://api.minimax.io.example/anthropic'],
    ['custom/MiniMax-M3.1-Flash', endpoints[0]],
  ]) {
    it(`preserves explicit ${model} requests at ${baseUrl}`, async () => {
      const requests = captureRequests()
      const adapter = new AnthropicModelAdapter(new ToolRegistry([]), async () => runtime(model, baseUrl, 100_000))
      await adapter.next([{ role: 'user', content: 'hello' }])
      assert.equal(requests[0].body.model, model)
      assert.equal(requests[0].body.max_tokens, 64_000)
      assert.equal(requests[0].body.thinking, undefined)
      assert.equal(requests[0].body.output_config, undefined)
    })
  }

  it('round-trips Flash thinking and tool history through the agent loop', async () => {
    const requests: RequestBody[] = []
    const thinking = { type: 'thinking', thinking: 'Inspect the test value.', signature: 'opaque-signature' }
    globalThis.fetch = (async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return Response.json(requests.length === 1
        ? { stop_reason: 'tool_use', content: [thinking, { type: 'tool_use', id: 'tool_1', name: 'echo', input: { value: 'ok' } }] }
        : { stop_reason: 'end_turn', content: [{ type: 'text', text: '<final>done' }] })
    }) as typeof fetch
    const tools = new ToolRegistry([{
      name: 'echo', description: 'Echo a test value.',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      schema: z.object({ value: z.string() }),
      async run(input) { return { ok: true, output: input.value } },
    }])
    const adapter = new AnthropicModelAdapter(tools, async () => runtime('MiniMax-M3.1-Flash', endpoints[0]))
    await runAgentTurn({ model: adapter, tools, messages: [{ role: 'user', content: 'Echo ok' }], cwd: process.cwd() })
    assert.equal(requests.length, 2)
    assert.deepEqual(requests[1].tools.map(tool => tool.name), ['echo'])
    const assistant = requests[1].messages.find(message => message.role === 'assistant')!
    assert.deepEqual(assistant.content[0], thinking)
    assert.deepEqual(assistant.content[1], { type: 'tool_use', id: 'tool_1', name: 'echo', input: { value: 'ok' } })
    const result = requests[1].messages.at(-1)!.content[0]
    assert.equal(result.type, 'tool_result')
    assert.equal(result.tool_use_id, 'tool_1')
    assert.equal(result.content, 'ok')
  })

  it('loads saved and environment model IDs unchanged at the HTTP boundary', async () => {
    const sandbox = await mkdtemp(path.join(process.cwd(), '.minimax-config-test-'))
    const settingsDir = path.join(sandbox, '.mini-code')
    const script = `
      const { loadRuntimeConfig } = await import('./src/config.ts')
      const { AnthropicModelAdapter } = await import('./src/anthropic-adapter.ts')
      const { ToolRegistry } = await import('./src/tool.ts')
      globalThis.fetch = async (_url, init) => {
        console.log(init.body)
        return Response.json({ content: [{ type: 'text', text: 'done' }] })
      }
      await new AnthropicModelAdapter(new ToolRegistry([]), loadRuntimeConfig).next([{ role: 'user', content: 'hello' }])
    `
    try {
      await mkdir(settingsDir)
      for (const model of ['MiniMax-M3.1-Flash', 'MiniMax-M3', 'MiniMax-M2.7', 'custom-model']) {
        await writeFile(path.join(settingsDir, 'settings.json'), JSON.stringify({
          model, maxOutputTokens: 100_000,
          env: { ANTHROPIC_BASE_URL: endpoints[0], ANTHROPIC_AUTH_TOKEN: 'test-token' },
        }))
        const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
          cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: sandbox, MINI_CODE_HOME: settingsDir },
        })
        const body = JSON.parse(stdout) as RequestBody
        assert.equal(body.model, model)
        assert.equal(body.max_tokens, ['MiniMax-M3.1-Flash', 'MiniMax-M3'].includes(model) ? 100_000 : 64_000)
      }
      const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: sandbox, MINI_CODE_HOME: settingsDir, MINI_CODE_MODEL: 'MiniMax-M3.1-Flash' },
      })
      assert.equal(JSON.parse(stdout).model, 'MiniMax-M3.1-Flash')
      await writeFile(path.join(settingsDir, 'settings.json'), JSON.stringify({
        env: { ANTHROPIC_BASE_URL: endpoints[0], ANTHROPIC_AUTH_TOKEN: 'test-token' },
      }))
      await assert.rejects(promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: sandbox, MINI_CODE_HOME: settingsDir },
      }), /No model configured/)
    } finally {
      await rm(sandbox, { recursive: true, force: true })
    }
  })
})
