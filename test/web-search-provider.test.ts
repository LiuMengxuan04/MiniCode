import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getSearchProviders,
  searchDuckDuckGoLite,
} from '../src/utils/web.js'

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe('getSearchProviders', () => {
  const originalKey = process.env.YDC_API_KEY

  beforeEach(() => {
    delete process.env.YDC_API_KEY
  })

  afterEach(() => {
    restoreEnv('YDC_API_KEY', originalKey)
  })

  it('defaults to DuckDuckGo and Sogou when YDC_API_KEY is unset', () => {
    assert.deepEqual(getSearchProviders(), ['duckduckgo-lite', 'sogou'])
  })

  it('puts youcom first when YDC_API_KEY is set', () => {
    process.env.YDC_API_KEY = 'test-key'
    assert.deepEqual(getSearchProviders(), ['youcom', 'duckduckgo-lite', 'sogou'])
  })

  it('treats a whitespace-only YDC_API_KEY as unset', () => {
    process.env.YDC_API_KEY = '   '
    assert.deepEqual(getSearchProviders(), ['duckduckgo-lite', 'sogou'])
  })
})

describe('searchDuckDuckGoLite provider chain with youcom', () => {
  const originalKey = process.env.YDC_API_KEY
  const originalFetch = globalThis.fetch

  afterEach(() => {
    restoreEnv('YDC_API_KEY', originalKey)
    globalThis.fetch = originalFetch
  })

  it('falls back to the next provider when the youcom response is malformed', async () => {
    process.env.YDC_API_KEY = 'test-key'

    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      calls.push(url)
      if (url.includes('ydc-index.io')) {
        return new Response('not-json', { status: 200 })
      }
      // Minimal DuckDuckGo lite page with one result.
      const html = `
        <a class="result-link" href="https://example.com/docs">Example Docs</a>
        <td class="result-snippet">Useful snippet</td>
      `
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }) as typeof fetch

    const result = await searchDuckDuckGoLite({ query: 'mcp docs', maxResults: 5 })
    assert.ok(result.organic.length > 0)
    assert.equal(result.base_resp.source, 'duckduckgo-lite')
    assert.ok(calls.some(url => url.includes('ydc-index.io')), 'youcom should be tried first')
    assert.ok(calls.some(url => url.includes('duckduckgo.com')), 'should fall back to duckduckgo')
  })
})
