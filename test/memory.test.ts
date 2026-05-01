import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  describeMemoryFiles,
  discoverInstructionFiles,
  loadMemory,
  renderMemoryReport,
  type ContextFile,
} from '../src/memory.js'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minicode-memory-test-'))
}

function makeHomeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minicode-memory-home-'))
}

async function discoverTestFiles(cwd: string, homeDir = makeHomeDir()) {
  try {
    return await discoverInstructionFiles(cwd, homeDir, cwd)
  } finally {
    if (path.basename(homeDir).startsWith('minicode-memory-home-')) {
      fs.rmSync(homeDir, { recursive: true, force: true })
    }
  }
}

async function loadTestMemory(cwd: string, homeDir = makeHomeDir()) {
  try {
    return await loadMemory(cwd, homeDir, cwd)
  } finally {
    if (path.basename(homeDir).startsWith('minicode-memory-home-')) {
      fs.rmSync(homeDir, { recursive: true, force: true })
    }
  }
}

function write(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

describe('discoverInstructionFiles', () => {
  test('returns empty when no files exist', async () => {
    const dir = makeTempDir()
    try {
      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('finds MINI.md in cwd', async () => {
    const dir = makeTempDir()
    try {
      write(dir, 'MINI.md', 'project rules')
      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 1)
      assert.equal(files[0].content, 'project rules')
      assert.ok(files[0].path.endsWith('MINI.md'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('finds MINI.local.md in cwd', async () => {
    const dir = makeTempDir()
    try {
      write(dir, 'MINI.local.md', 'local rules')
      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 1)
      assert.equal(files[0].content, 'local rules')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('finds .mini-code/MINI.md', async () => {
    const dir = makeTempDir()
    try {
      write(dir, '.mini-code/MINI.md', 'mini-code instructions')
      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 1)
      assert.equal(files[0].content, 'mini-code instructions')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('finds CLAUDE.md for compatibility', async () => {
    const dir = makeTempDir()
    try {
      write(dir, 'CLAUDE.md', 'claude rules')
      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 1)
      assert.equal(files[0].content, 'claude rules')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('finds CLAUDE.local.md for compatibility', async () => {
    const dir = makeTempDir()
    try {
      write(dir, 'CLAUDE.local.md', 'claude local rules')
      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 1)
      assert.equal(files[0].content, 'claude local rules')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('finds .claude/CLAUDE.md for compatibility', async () => {
    const dir = makeTempDir()
    try {
      write(dir, '.claude/CLAUDE.md', 'claude dir rules')
      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 1)
      assert.equal(files[0].content, 'claude dir rules')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('walks upward from cwd to root', async () => {
    const root = makeTempDir()
    const child = path.join(root, 'apps', 'web')
    fs.mkdirSync(child, { recursive: true })
    try {
      write(root, 'MINI.md', 'root rules')
      write(child, 'MINI.md', 'child rules')
      const files = await discoverInstructionFiles(child, makeHomeDir(), root)
      assert.equal(files.length, 2)
      // root first, then child
      assert.equal(files[0].content, 'root rules')
      assert.equal(files[1].content, 'child rules')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('dedupes files with identical content', async () => {
    const root = makeTempDir()
    const child = path.join(root, 'apps', 'web')
    fs.mkdirSync(child, { recursive: true })
    try {
      write(root, 'MINI.md', 'same rules')
      write(child, 'MINI.md', 'same rules')
      const files = await discoverInstructionFiles(child, makeHomeDir(), root)
      assert.equal(files.length, 1)
      // keeps the one closer to cwd (child)
      assert.ok(files[0].path.includes('web'))
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('skips empty files', async () => {
    const dir = makeTempDir()
    try {
      write(dir, 'MINI.md', '   \n\n  ')
      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('loads user global MINI.md from home directory', async () => {
    const dir = makeTempDir()
    const miniCodeHome = makeTempDir()
    try {
      write(miniCodeHome, 'MINI.md', 'global rules')
      const files = await discoverInstructionFiles(dir, miniCodeHome, dir)
      const globalFile = files.find(f => f.content === 'global rules')
      assert.ok(globalFile)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.rmSync(miniCodeHome, { recursive: true, force: true })
    }
  })

  test('global loaded before project files', async () => {
    const dir = makeTempDir()
    const miniCodeHome = makeTempDir()
    try {
      write(miniCodeHome, 'MINI.md', 'global rules')
      write(dir, 'MINI.md', 'project rules')
      const files = await discoverInstructionFiles(dir, miniCodeHome, dir)
      assert.equal(files.length, 2)
      assert.equal(files[0].content, 'global rules')
      assert.equal(files[1].content, 'project rules')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.rmSync(miniCodeHome, { recursive: true, force: true })
    }
  })

  test('MINI.md takes priority over CLAUDE.md in same directory', async () => {
    const dir = makeTempDir()
    try {
      write(dir, 'MINI.md', 'mini rules')
      write(dir, 'CLAUDE.md', 'claude rules')
      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 2)
      assert.equal(files[0].content, 'mini rules')
      assert.equal(files[1].content, 'claude rules')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('MINI.local.md loaded after MINI.md in same directory', async () => {
    const dir = makeTempDir()
    try {
      write(dir, 'MINI.md', 'shared rules')
      write(dir, 'MINI.local.md', 'local rules')
      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 2)
      assert.equal(files[0].content, 'shared rules')
      assert.equal(files[1].content, 'local rules')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('discovers .mini-code/rules/*.md files sorted by filename', async () => {
    const dir = makeTempDir()
    try {
      write(dir, '.mini-code/rules/testing.md', 'testing rules')
      write(dir, '.mini-code/rules/typescript.md', 'typescript rules')
      write(dir, '.mini-code/rules/ignore.txt', 'ignored')
      write(dir, '.mini-code/rules/a-first.md', 'first rules')

      const files = await discoverTestFiles(dir)
      assert.deepEqual(files.map(f => path.basename(f.path)), [
        'a-first.md',
        'testing.md',
        'typescript.md',
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('loads rules after directory instruction files', async () => {
    const dir = makeTempDir()
    try {
      write(dir, 'MINI.md', 'project rules')
      write(dir, '.mini-code/rules/testing.md', 'testing rules')

      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 2)
      assert.equal(files[0].content, 'project rules')
      assert.equal(files[1].content, 'testing rules')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('resolves @path includes relative to the source file', async () => {
    const dir = makeTempDir()
    try {
      write(dir, 'MINI.md', 'before\n@docs/workflow.md\nafter')
      write(dir, 'docs/workflow.md', 'workflow rules')

      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 1)
      assert.ok(files[0].content.includes('before'))
      assert.ok(files[0].content.includes('included from docs/workflow.md'))
      assert.ok(files[0].content.includes('workflow rules'))
      assert.ok(files[0].content.includes('after'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('resolves nested includes and skips cycles', async () => {
    const dir = makeTempDir()
    try {
      write(dir, 'MINI.md', '@a.md')
      write(dir, 'a.md', 'a\n@b.md')
      write(dir, 'b.md', 'b\n@a.md')

      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 1)
      assert.ok(files[0].content.includes('a'))
      assert.ok(files[0].content.includes('b'))
      assert.ok(files[0].content.includes('cycle detected a.md'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('skips unsafe and missing includes with marker comments', async () => {
    const dir = makeTempDir()
    try {
      const absoluteRef = path.join(dir, 'absolute.md')
      write(dir, 'MINI.md', `@../outside.md\n@missing.md\n@${absoluteRef}`)

      const files = await discoverTestFiles(dir)
      assert.equal(files.length, 1)
      assert.ok(files[0].content.includes('unsafe path ../outside.md'))
      assert.ok(files[0].content.includes('not found missing.md'))
      assert.ok(files[0].content.includes('unsafe path'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('memory report', () => {
  test('describes files with scope and preview', () => {
    const dir = makeTempDir()
    try {
      const filePath = write(dir, '.mini-code/rules/testing.md', '# Testing\nUse tests')
      const infos = describeMemoryFiles([{ path: filePath, content: '# Testing\nUse tests' }], dir)
      assert.equal(infos[0].scope, 'rules')
      assert.equal(infos[0].lineCount, 2)
      assert.equal(infos[0].preview, '# Testing')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('renders /memory report', () => {
    const result = renderMemoryReport([
      { path: 'MINI.md', content: '# Project\nRules' },
    ])
    assert.ok(result.includes('Memory files loaded: 1'))
    assert.ok(result.includes('scope: project'))
    assert.ok(result.includes('preview: # Project'))
  })
})

describe('loadMemory', () => {
  test('returns empty string when no files exist', async () => {
    const dir = makeTempDir()
    try {
      const result = await loadTestMemory(dir)
      assert.equal(result, '')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('renders instruction files with scope', async () => {
    const dir = makeTempDir()
    try {
      write(dir, 'MINI.md', 'project rules')
      const result = await loadTestMemory(dir)
      assert.ok(result.includes('project rules'))
      assert.ok(result.includes('MINI.md'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('truncates files exceeding per-file limit', async () => {
    const dir = makeTempDir()
    try {
      const longContent = 'x'.repeat(10_000)
      write(dir, 'MINI.md', longContent)
      const result = await loadTestMemory(dir)
      assert.ok(result.includes('[truncated]'))
      // total should not include the full 10k
      assert.ok(result.length < 10_000)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('truncates total content exceeding limit', async () => {
    const root = makeTempDir()
    const child = path.join(root, 'apps', 'web')
    fs.mkdirSync(child, { recursive: true })
    try {
      write(root, 'MINI.md', 'a'.repeat(12_000))
      write(child, 'MINI.md', 'b'.repeat(12_000))
      // Call from child so upward walk finds both root and child
      const result = await loadMemory(child, makeHomeDir(), root)
      assert.ok(result.length < 30_000)
      assert.ok(result.includes('b'))
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('omits instructions section when no files found', async () => {
    const dir = makeTempDir()
    try {
      const result = await loadTestMemory(dir)
      assert.equal(result, '')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
