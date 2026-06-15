import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatMessage } from '../src/types.js'
import { MINI_CODE_PROJECTS_DIR } from '../src/config.js'
import { projectDirName } from '../src/session-paths.js'
import {
  MAX_TOOL_RESULTS_PER_BATCH_CHARS,
  PERSISTED_OUTPUT_TAG,
  SHELL_PREVIEW_SIZE_CHARS,
  SHELL_TOOL_NAMES,
  TOOL_RESULTS_SUBDIR,
  applyToolResultBudget,
  createContentReplacementState,
  normalizeToolResultContent,
  replaceLargeToolResult,
} from '../src/utils/tool-result-storage.js'

function toolResult(
  id: string,
  content: unknown,
): Omit<Extract<ChatMessage, { role: 'tool_result' }>, 'content'> & { content: unknown } {
  return {
    role: 'tool_result',
    toolUseId: id,
    toolName: 'run_command',
    content,
    isError: false,
  }
}

function createStorageState(sessionId = 'test-session') {
  return createContentReplacementState({
    cwd: path.join(process.cwd(), 'tool-result-storage-fixture'),
    sessionId,
  })
}

function sizedOutput(label: string, size: number): string {
  const header = [
    `$ ${label}`,
    `src/${label}.ts:10: simulated tool output`,
    'note: this fixture keeps an exact character budget for threshold tests',
    '',
  ].join('\n')
  const fillerLine = `[${label}] deterministic filler 0123456789 abcdefghijklmnopqrstuvwxyz\n`
  let output = header

  while (output.length + fillerLine.length <= size) {
    output += fillerLine
  }

  if (output.length < size) {
    output += '.'.repeat(size - output.length)
  }

  return output
}

function extractSavedPath(content: string): string {
  const match = content.match(/Full output saved to: (.+)\n/)
  assert.ok(match, 'replacement should include saved path')
  return match[1]
}

function persistedMessages(
  results: Array<Extract<ChatMessage, { role: 'tool_result' }>>,
): Array<Extract<ChatMessage, { role: 'tool_result' }>> {
  return results.filter(result => result.content.startsWith(PERSISTED_OUTPUT_TAG))
}

describe('tool result replacement', () => {
  it('persists a single oversized tool result and preserves the full original output on disk', async () => {
    const state = createStorageState()
    const original = sizedOutput('single-large-output', 50_001)
    const result = await replaceLargeToolResult(
      toolResult('single-large', original),
      state,
    )

    assert.ok(result.content.startsWith(PERSISTED_OUTPUT_TAG))
    assert.ok(result.content.endsWith('</persisted-output>'))
    assert.ok(result.content.includes(original.slice(0, 200)))
    assert.equal(state.replacements.get('single-large'), result.content)

    const savedPath = extractSavedPath(result.content)
    const saved = await readFile(savedPath, 'utf8')
    assert.equal(saved, original)
  })

  it('honors the 50_000 single-result boundary', async () => {
    const exact = sizedOutput('exact-single-boundary', 50_000)
    const over = sizedOutput('over-single-boundary', 50_001)

    const exactResult = await replaceLargeToolResult(toolResult('exact-single', exact))
    const overResult = await replaceLargeToolResult(toolResult('over-single', over))

    assert.equal(exactResult.content, exact)
    assert.ok(overResult.content.startsWith(PERSISTED_OUTPUT_TAG))
  })

  it('normalizes empty outputs without misclassifying non-empty falsy-looking strings', async () => {
    for (const [id, value] of [
      ['empty-string', ''],
      ['empty-whitespace', ' \n\t '],
      ['empty-null', null],
      ['empty-undefined', undefined],
    ] as const) {
      const result = await replaceLargeToolResult(toolResult(id, value))
      assert.equal(result.content, '(run_command completed with no output)')
    }

    for (const value of ['0', 'false', '[]']) {
      const result = await replaceLargeToolResult(toolResult(`non-empty-${value}`, value))
      assert.equal(result.content, value)
    }
  })

  it('honors the 200_000 batch boundary', async () => {
    const state = createStorageState()
    const exact = await applyToolResultBudget([
      toolResult('batch-exact-a', sizedOutput('batch-exact-a', 100_000)),
      toolResult('batch-exact-b', sizedOutput('batch-exact-b', 100_000)),
    ] as Extract<ChatMessage, { role: 'tool_result' }>[], state)

    assert.equal(exact.newlyReplaced.length, 0)
    assert.equal(persistedMessages(exact.results).length, 0)

    const overState = createStorageState('batch-over')
    const over = await applyToolResultBudget([
      toolResult('batch-over-a', sizedOutput('batch-over-a', 100_001)),
      toolResult('batch-over-b', sizedOutput('batch-over-b', 100_000)),
    ] as Extract<ChatMessage, { role: 'tool_result' }>[], overState)

    assert.equal(over.newlyReplaced.length, 1)
    assert.equal(persistedMessages(over.results).length, 1)
  })

  it('replaces the largest fresh batch results until visible content is under budget', async () => {
    const state = createStorageState()
    const result = await applyToolResultBudget([
      toolResult('largest-a', sizedOutput('largest-a', 100_000)),
      toolResult('largest-b', sizedOutput('largest-b', 100_000)),
      toolResult('largest-c', sizedOutput('largest-c', 100_000)),
    ] as Extract<ChatMessage, { role: 'tool_result' }>[], state)

    const replacedIds = persistedMessages(result.results).map(message => message.toolUseId)
    const totalVisible = result.results.reduce(
      (sum, message) => sum + message.content.length,
      0,
    )

    assert.deepEqual(replacedIds, ['largest-a', 'largest-b'])
    assert.ok(totalVisible <= MAX_TOOL_RESULTS_PER_BATCH_CHARS)
    assert.equal(result.newlyReplaced.length, 2)
  })

  it('uses stable tie-breaking when same-size batch results need replacement', async () => {
    const state = createStorageState()
    const result = await applyToolResultBudget([
      toolResult('tie-c', sizedOutput('tie-c', 100_000)),
      toolResult('tie-a', sizedOutput('tie-a', 100_000)),
      toolResult('tie-b', sizedOutput('tie-b', 100_000)),
    ] as Extract<ChatMessage, { role: 'tool_result' }>[], state)

    const replacedIds = persistedMessages(result.results).map(message => message.toolUseId)
    assert.deepEqual(replacedIds.sort(), ['tie-a', 'tie-b'])
  })

  it('replays single-result replacements byte-identically without regenerating them', async () => {
    const state = createStorageState()
    const original = sizedOutput('single-large-output', 50_001)
    const first = await replaceLargeToolResult(
      toolResult('single-replay', original),
      state,
    )
    const second = await replaceLargeToolResult(
      toolResult('single-replay', original),
      state,
    )

    assert.equal(second.content, first.content)
    assert.equal(state.replacements.size, 1)
    assert.equal(state.replacements.get('single-replay'), first.content)
  })

  it('replays batch replacements byte-identically without new replacement records', async () => {
    const state = createStorageState()
    const inputs = [
      toolResult('batch-replay-a', sizedOutput('batch-replay-a', 100_001)),
      toolResult('batch-replay-b', sizedOutput('batch-replay-b', 100_000)),
    ] as Extract<ChatMessage, { role: 'tool_result' }>[]

    const first = await applyToolResultBudget(inputs, state)
    const replaced = persistedMessages(first.results)[0]
    assert.ok(replaced)

    const second = await applyToolResultBudget(inputs, state)
    const replayed = second.results.find(result => result.toolUseId === replaced.toolUseId)

    assert.equal(replayed?.content, replaced.content)
    assert.equal(second.newlyReplaced.length, 0)
  })

  it('does not re-persist content that is already a persisted-output replacement', async () => {
    const state = createStorageState()
    const replacement = [
      PERSISTED_OUTPUT_TAG,
      'Output too large. Full output saved to: /tmp/example.txt',
      PERSISTED_OUTPUT_TAG,
    ].join('\n')

    const result = await applyToolResultBudget([
      toolResult('already-persisted', replacement),
      toolResult('fresh-small', 'ok'),
    ] as Extract<ChatMessage, { role: 'tool_result' }>[], state)

    assert.equal(result.results[0].content, replacement)
    assert.equal(state.replacements.get('already-persisted'), replacement)
    assert.equal(result.newlyReplaced.length, 0)
  })

  it('stores persisted outputs under the project/session tool-results directory', async () => {
    const cwd = path.join(process.cwd(), 'tool-result-storage-fixture')
    const sessionId = 'session-path-check'
    const state = createContentReplacementState({ cwd, sessionId })
    const original = sizedOutput('project-session-path-check', 50_001)
    const result = await replaceLargeToolResult(toolResult('path-check', original), state)
    const savedPath = extractSavedPath(result.content)
    const expectedRoot = path.join(
      MINI_CODE_PROJECTS_DIR,
      projectDirName(cwd),
      sessionId,
      TOOL_RESULTS_SUBDIR,
    )
    const relative = path.relative(expectedRoot, savedPath)

    assert.ok(!relative.startsWith('..'))
    assert.ok(!path.isAbsolute(relative))
    assert.equal(await readFile(savedPath, 'utf8'), original)
  })

  it('keeps persisted paths under the tool-results directory for unsafe toolUseIds', async () => {
    const state = createStorageState('unsafe-id-session')
    const original = sizedOutput('unsafe-tool-use-id', 50_001)
    const result = await replaceLargeToolResult(
      toolResult('../..\\evil/name', original),
      state,
    )
    const savedPath = extractSavedPath(result.content)
    const root = path.join(
      MINI_CODE_PROJECTS_DIR,
      projectDirName(path.join(process.cwd(), 'tool-result-storage-fixture')),
      'unsafe-id-session',
      TOOL_RESULTS_SUBDIR,
    )
    const relative = path.relative(root, savedPath)

    assert.ok(!relative.startsWith('..'))
    assert.ok(!path.isAbsolute(relative))
    assert.equal(await readFile(savedPath, 'utf8'), original)
  })

  it('respects never-persist thresholds and skip lists for bounded tools like read_file', async () => {
    const state = createStorageState('never-persist')
    const original = sizedOutput('read-file-never-persist', 120_000)

    const single = await replaceLargeToolResult(
      {
        role: 'tool_result',
        toolUseId: 'read-large',
        toolName: 'read_file',
        content: original,
        isError: false,
      },
      state,
      Number.POSITIVE_INFINITY,
    )
    assert.equal(single.content, original)

    const batch = await applyToolResultBudget([
      {
        role: 'tool_result',
        toolUseId: 'read-large-a',
        toolName: 'read_file',
        content: original,
        isError: false,
      },
      {
        role: 'tool_result',
        toolUseId: 'read-large-b',
        toolName: 'read_file',
        content: original,
        isError: false,
      },
    ], state, 10_000, new Set(['read_file']))

    assert.equal(batch.newlyReplaced.length, 0)
    assert.equal(persistedMessages(batch.results).length, 0)
    assert.equal(batch.results[0]?.content, original)
    assert.equal(batch.results[1]?.content, original)
  })

  it('uses larger preview for shell tools and saves with .txt extension', async () => {
    assert.ok(SHELL_TOOL_NAMES.has('run_command'), 'run_command should be a shell tool')

    const state = createStorageState('shell-preview')
    // Build content larger than SHELL_PREVIEW_SIZE_CHARS to verify the larger preview is used
    const lineCount = 500
    const lines = Array.from({ length: lineCount }, (_, i) => `line ${i}: build output entry`)
    const original = lines.join('\n') // well over 50_001 chars

    // Pad to exceed the persist threshold
    const padded = original + '\n' + 'x'.repeat(50_001 - original.length + 1)

    const result = await replaceLargeToolResult(
      {
        role: 'tool_result',
        toolUseId: 'shell-preview-check',
        toolName: 'run_command',
        content: padded,
        isError: false,
      },
      state,
    )

    assert.ok(result.content.startsWith(PERSISTED_OUTPUT_TAG))
    // The preview for shell tools is SHELL_PREVIEW_SIZE_CHARS (5K) not the default 2K
    const previewLines = result.content.split('\n')
    const previewContent = previewLines.slice(4, -2).join('\n') // skip header + closing tag
    assert.ok(previewContent.length >= SHELL_PREVIEW_SIZE_CHARS * 0.5,
      `expected shell preview >= ${SHELL_PREVIEW_SIZE_CHARS * 0.5} chars, got ${previewContent.length}`)

    const savedPath = extractSavedPath(result.content)
    assert.ok(savedPath.endsWith('.txt'), 'shell tool output should be saved as .txt')
    assert.equal(await readFile(savedPath, 'utf8'), padded)
  })

  it('normalizes content-block arrays to text via normalizeToolResultContent', () => {
    const blocks = [
      { type: 'text', text: 'first line' },
      { type: 'text', text: 'second line' },
      { type: 'image', source: { url: 'data:...' } },
    ]
    const normalized = normalizeToolResultContent(blocks)
    assert.ok(normalized.includes('first line'))
    assert.ok(normalized.includes('second line'))
    assert.ok(normalized.includes('[image]'), 'non-text blocks should become [type] placeholders')
  })

  it('persists structured content-block arrays as .json and saves raw blocks', async () => {
    const state = createStorageState('structured-json')
    const blocks = Array.from({ length: 3_000 }, (_, i) => ({
      type: 'text',
      text: `line ${i}: ${'x'.repeat(20)}`,
    }))

    const result = await replaceLargeToolResult(
      {
        role: 'tool_result',
        toolUseId: 'structured-blocks',
        toolName: 'web_fetch',
        content: blocks,
        isError: false,
      },
      state,
    )

    assert.ok(result.content.startsWith(PERSISTED_OUTPUT_TAG),
      'large structured content should be persisted')

    const savedPath = extractSavedPath(result.content)
    assert.ok(savedPath.endsWith('.json'), 'structured content should be saved as .json')

    const saved = JSON.parse(await readFile(savedPath, 'utf8')) as unknown[]
    assert.equal(saved.length, blocks.length)
    assert.deepEqual((saved[0] as { type: string; text: string }).type, 'text')
  })
})
