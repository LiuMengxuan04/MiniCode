import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  READ_CACHE_LIMIT,
  readFileTool,
  resetReadCache,
} from '../src/tools/read-file.js'
import type { ToolContext } from '../src/tool.js'

const ORIGINAL_DEDUP = process.env.MINI_CODE_READ_DEDUP

function makeContext(cwd: string): ToolContext {
  return { cwd }
}

function makeTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'minicode-read-dedup-'))
}

describe('read_file dedup', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
    resetReadCache()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIGINAL_DEDUP === undefined) {
      delete process.env.MINI_CODE_READ_DEDUP
    } else {
      process.env.MINI_CODE_READ_DEDUP = ORIGINAL_DEDUP
    }
  })

  it('returns full content on first read', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'hello world\n', 'utf8')
    const result = await readFileTool.run(
      { path: 'a.txt' },
      makeContext(dir),
    )
    assert.equal(result.ok, true)
    assert.ok(result.output.includes('hello world'))
    assert.ok(result.output.includes('FILE: a.txt'))
  })

  it('returns a dedup marker when the same file is read again unchanged', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'same content\n', 'utf8')
    const first = await readFileTool.run(
      { path: 'a.txt' },
      makeContext(dir),
    )
    assert.ok(first.output.includes('same content'))

    const second = await readFileTool.run(
      { path: 'a.txt' },
      makeContext(dir),
    )
    assert.equal(second.ok, true)
    assert.ok(second.output.includes('already read'))
    assert.ok(second.output.includes('fresh: true'))
    assert.ok(!second.output.includes('same content'))
  })

  it('allows a full re-read when earlier content is no longer in context', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'recoverable content\n', 'utf8')
    await readFileTool.run({ path: 'a.txt' }, makeContext(dir))
    const deduped = await readFileTool.run(
      { path: 'a.txt' },
      makeContext(dir),
    )
    assert.ok(deduped.output.includes('already read'))

    const fresh = await readFileTool.run(
      { path: 'a.txt', fresh: true },
      makeContext(dir),
    )
    assert.ok(fresh.output.includes('recoverable content'))
    assert.ok(!fresh.output.includes('already read'))

    const dedupedAgain = await readFileTool.run(
      { path: 'a.txt' },
      makeContext(dir),
    )
    assert.ok(dedupedAgain.output.includes('already read'))
  })

  it('re-reads and returns new content after the file changes', async () => {
    const file = path.join(dir, 'a.txt')
    writeFileSync(file, 'v1 content\n', 'utf8')
    await readFileTool.run({ path: 'a.txt' }, makeContext(dir))

    writeFileSync(file, 'v2 content\n', 'utf8')
    const result = await readFileTool.run(
      { path: 'a.txt' },
      makeContext(dir),
    )
    assert.equal(result.ok, true)
    assert.ok(result.output.includes('v2 content'))
    assert.ok(!result.output.includes('already read'))
  })

  it('does not dedup across different offsets', async () => {
    const file = path.join(dir, 'big.txt')
    const content = 'x'.repeat(100)
    writeFileSync(file, content, 'utf8')

    const first = await readFileTool.run(
      { path: 'big.txt', offset: 0, limit: 50 },
      makeContext(dir),
    )
    assert.ok(first.output.includes('x'.repeat(50)))

    const second = await readFileTool.run(
      { path: 'big.txt', offset: 50, limit: 50 },
      makeContext(dir),
    )
    assert.ok(second.output.includes('x'.repeat(50)))
    assert.ok(!second.output.includes('already read'))
  })

  it('honors MINI_CODE_READ_DEDUP=0 to disable dedup', async () => {
    process.env.MINI_CODE_READ_DEDUP = '0'
    writeFileSync(path.join(dir, 'a.txt'), 'content\n', 'utf8')

    await readFileTool.run({ path: 'a.txt' }, makeContext(dir))
    const second = await readFileTool.run(
      { path: 'a.txt' },
      makeContext(dir),
    )
    assert.equal(second.ok, true)
    assert.ok(second.output.includes('content'))
    assert.ok(!second.output.includes('already read'))
  })

  it('re-reads fully after the cache is reset', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'content\n', 'utf8')
    await readFileTool.run({ path: 'a.txt' }, makeContext(dir))
    resetReadCache()

    const result = await readFileTool.run(
      { path: 'a.txt' },
      makeContext(dir),
    )
    assert.ok(result.output.includes('content'))
    assert.ok(!result.output.includes('already read'))
  })

  it('evicts the oldest path when the cache reaches its limit', async () => {
    for (let i = 0; i <= READ_CACHE_LIMIT; i += 1) {
      const name = `file-${i}.txt`
      writeFileSync(path.join(dir, name), `content ${i}\n`, 'utf8')
      await readFileTool.run({ path: name }, makeContext(dir))
    }

    const result = await readFileTool.run(
      { path: 'file-0.txt' },
      makeContext(dir),
    )
    assert.ok(result.output.includes('content 0'))
    assert.ok(!result.output.includes('already read'))
  })
})
