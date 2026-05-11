import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractSelectedText,
  renderTranscript,
  type TranscriptEntry,
  type TranscriptSelection,
} from '../src/tui/transcript.ts'

function stripAnsi(input: string): string {
  return input.replace(/\[[\d;]*[A-Za-z]/g, '')
}

function withTerminalWidth<T>(columns: number, fn: () => T): T {
  const original = process.stdout.columns
  Object.defineProperty(process.stdout, 'columns', {
    value: columns,
    configurable: true,
  })
  try {
    return fn()
  } finally {
    Object.defineProperty(process.stdout, 'columns', {
      value: original,
      configurable: true,
    })
  }
}

describe('transcript CJK selection', () => {
  it('highlights a single full-width CJK character by display column', () => {
    const entries: TranscriptEntry[] = [
      { id: 1, kind: 'assistant', body: '你A' },
    ]
    const selection: TranscriptSelection = {
      startLine: 1,
      startCol: 2,
      endLine: 1,
      endCol: 4,
    }

    const rendered = withTerminalWidth(60, () => renderTranscript(entries, 0, 10, selection))
    const plain = stripAnsi(rendered)

    assert.ok(plain.includes('  你A'))
    assert.ok(rendered.includes('[7m你[0m'))
  })

  it('extracts a single full-width CJK character by display column', () => {
    const entries: TranscriptEntry[] = [
      { id: 1, kind: 'assistant', body: '你A' },
    ]
    const selection: TranscriptSelection = {
      startLine: 1,
      startCol: 2,
      endLine: 1,
      endCol: 4,
    }

    const selected = withTerminalWidth(60, () => extractSelectedText(entries, selection))

    assert.equal(selected, '你')
  })
})
