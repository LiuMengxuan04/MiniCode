import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentStep, ChatMessage, ModelAdapter } from '../src/types.js'
import { ModelRequestError } from '../src/utils/errors.js'
import { requestWithPromptTooLongRecovery } from '../src/prompt-too-long.js'
import { runAgentTurn } from '../src/agent-loop.js'
import { ToolRegistry } from '../src/tool.js'
import type { PermissionManager } from '../src/permissions.js'

function makeMessages(count: number): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
  ]
  for (let i = 0; i < count; i++) {
    messages.push({ role: 'user', content: `User message ${i}`.repeat(400) })
    messages.push({
      role: 'assistant',
      content: `Assistant response ${i}`.repeat(600),
    })
    if (i % 2 === 0) {
      messages.push({
        role: 'assistant_tool_call',
        toolUseId: `tool-${i}`,
        toolName: 'read_file',
        input: { path: `file-${i}.txt` },
      } as ChatMessage)
      messages.push({
        role: 'tool_result',
        toolUseId: `tool-${i}`,
        toolName: 'read_file',
        content: `file content ${i} `.repeat(900),
        isError: false,
      } as ChatMessage)
    }
  }
  return messages
}

const okStep: AgentStep = { type: 'assistant', content: 'ok' }

function makeAdapter(
  calls: Array<{ messages: ChatMessage[]; step: AgentStep | Error }>,
): { adapter: ModelAdapter; seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = []
  const adapter: ModelAdapter = {
    async next(messages) {
      seen.push(messages)
      const entry = calls[seen.length - 1]!
      if (entry.step instanceof Error) {
        throw entry.step
      }
      return entry.step
    },
  }
  return { adapter, seen }
}

describe('requestWithPromptTooLongRecovery', () => {
  let messages: ChatMessage[]

  beforeEach(() => {
    messages = makeMessages(12)
  })

  afterEach(() => {})

  it('returns the step directly when the request succeeds', async () => {
    const { adapter, seen } = makeAdapter([
      { messages, step: okStep },
    ])
    const result = await requestWithPromptTooLongRecovery({
      model: adapter,
      modelName: 'test-model',
      messages,
    })
    assert.equal(result.step, okStep)
    assert.equal(seen.length, 1)
    assert.equal(result.messages, messages)
  })

  it('compacts and retries once on a prompt-too-long error', async () => {
    const ptl = new ModelRequestError('prompt is too long: 123 tokens > 100', 400)
    const { adapter, seen } = makeAdapter([
      { messages, step: ptl },
      { messages, step: okStep },
    ])
    const result = await requestWithPromptTooLongRecovery({
      model: adapter,
      modelName: 'test-model',
      messages,
    })
    assert.equal(seen.length, 2, 'should call the model twice')
    assert.equal(result.step, okStep)
    // second attempt must use compacted (different) messages
    assert.notEqual(result.messages, messages)
    assert.ok(result.messages.length < messages.length)
  })

  it('awaits the full snip callback before retrying', async () => {
    const ptl = new ModelRequestError('prompt is too long', 400)
    let calls = 0
    let callbackFinished = false
    const adapter: ModelAdapter = {
      async next() {
        calls += 1
        if (calls === 1) throw ptl
        assert.equal(callbackFinished, true)
        return okStep
      },
    }

    await requestWithPromptTooLongRecovery({
      model: adapter,
      modelName: 'test-model',
      messages,
      async onCompacted(result) {
        await Promise.resolve()
        assert.equal(result.didSnip, true)
        assert.ok(result.boundaryMessage)
        assert.ok(result.removedMessageIds.length > 0)
        callbackFinished = true
      },
    })

    assert.equal(calls, 2)
  })

  it('routes recovery snips through the agent-loop persistence callback', async () => {
    const ptl = new ModelRequestError('prompt is too long', 400)
    let calls = 0
    let persistedSnips = 0
    const adapter: ModelAdapter = {
      async next() {
        calls += 1
        if (calls === 1) throw ptl
        if (calls === 2) {
          assert.equal(persistedSnips, 1)
          return { type: 'assistant', content: 'still working', kind: 'progress' }
        }
        return { type: 'assistant', content: 'done', kind: 'final' }
      },
    }

    await runAgentTurn({
      model: adapter,
      tools: new ToolRegistry([]),
      messages,
      cwd: process.cwd(),
      permissions: {} as PermissionManager,
      modelName: '',
      maxSteps: 3,
      async onSnipCompact(result) {
        await Promise.resolve()
        assert.equal(result.didSnip, true)
        assert.ok(result.boundaryMessage)
        persistedSnips += 1
      },
    })

    assert.equal(calls, 3)
    assert.equal(persistedSnips, 1)
  })

  it('rethrows non-prompt-too-long errors without retrying', async () => {
    const err = new ModelRequestError('server exploded', 500)
    const { adapter, seen } = makeAdapter([
      { messages, step: err },
    ])
    await assert.rejects(
      requestWithPromptTooLongRecovery({
        model: adapter,
        modelName: 'test-model',
        messages,
      }),
      (e: unknown) => e === err,
    )
    assert.equal(seen.length, 1)
  })

  it('rethrows when a retried request still fails and nothing more can be freed', async () => {
    const ptl = new ModelRequestError('prompt is too long', 400)
    const { adapter, seen } = makeAdapter([
      { messages, step: ptl },
      { messages, step: ptl },
    ])
    await assert.rejects(
      requestWithPromptTooLongRecovery({
        model: adapter,
        modelName: 'test-model',
        messages,
      }),
      (e: unknown) => e === ptl,
    )
    // 1 initial attempt + 1 compacted retry; after the first compaction the
    // transcript drops below the snip threshold, so no further retry happens.
    assert.equal(seen.length, 2)
  })

  it('rethrows the original error when compaction cannot free anything', async () => {
    // A tiny transcript that snip-compact leaves untouched
    const tiny: ChatMessage[] = [
      { role: 'system', content: 'hi' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]
    const ptl = new ModelRequestError('prompt is too long', 400)
    const { adapter, seen } = makeAdapter([
      { messages: tiny, step: ptl },
    ])
    await assert.rejects(
      requestWithPromptTooLongRecovery({
        model: adapter,
        modelName: 'test-model',
        messages: tiny,
      }),
      (e: unknown) => e === ptl,
    )
    assert.equal(seen.length, 1, 'no retry when nothing can be freed')
  })
})
