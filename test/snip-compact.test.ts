import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentStep, ChatMessage, ModelAdapter } from '../src/types.js'
import type { ContextStats } from '../src/utils/token-estimator.js'
import { snipCompactConversation } from '../src/compact/snipCompact.js'
import {
  SNIP_KEEP_RECENT_MESSAGES,
  SNIP_MIN_MESSAGES_TO_REMOVE,
} from '../src/compact/constants.js'
import {
  estimateMessagesTokens,
  tokenCountWithEstimation,
} from '../src/utils/token-estimator.js'
import { runAgentTurn } from '../src/agent-loop.js'
import { ToolRegistry } from '../src/tool.js'
import { microcompact } from '../src/compact/microcompact.js'

function contextStats(messages: ChatMessage[], effectiveInput = 20_000): ContextStats {
  const totalTokens = tokenCountWithEstimation(messages).totalTokens
  const utilization = totalTokens / effectiveInput
  return {
    estimatedTokens: estimateMessagesTokens(messages),
    totalTokens,
    providerUsageTokens: 0,
    contextWindow: effectiveInput,
    effectiveInput,
    remainingTokens: Math.max(0, effectiveInput - totalTokens),
    utilization,
    warningLevel:
      utilization >= 0.95
        ? 'blocked'
        : utilization >= 0.85
          ? 'critical'
          : utilization >= 0.50
            ? 'warning'
            : 'normal',
    accounting: tokenCountWithEstimation(messages),
  }
}

function withIds(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message, index) => ({
    ...message,
    id: `m-${index}`,
  }) as ChatMessage)
}

function makeSnippableConversation(options: {
  oldPairs?: number
  oldSize?: number
  recentCount?: number
} = {}): ChatMessage[] {
  const oldPairs = options.oldPairs ?? 12
  const oldSize = options.oldSize ?? 2_000
  const recentCount = options.recentCount ?? SNIP_KEEP_RECENT_MESSAGES
  const messages: ChatMessage[] = [
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: 'Opening request' },
  ]

  for (let i = 0; i < oldPairs; i++) {
    messages.push(
      { role: 'assistant', content: `Old explanation ${i}: ${'a'.repeat(oldSize)}` },
      { role: 'user', content: `Old follow-up ${i}: ${'b'.repeat(oldSize)}` },
    )
  }

  for (let i = 0; i < recentCount - 1; i++) {
    messages.push({ role: i % 2 === 0 ? 'assistant' : 'user', content: `Recent ${i}` } as ChatMessage)
  }
  messages.push({ role: 'user', content: 'Current active task' })

  return withIds(messages)
}

function assertNoToolOrphans(messages: ChatMessage[]): void {
  const calls = new Set(
    messages
      .filter((message): message is Extract<ChatMessage, { role: 'assistant_tool_call' }> => (
        message.role === 'assistant_tool_call'
      ))
      .map(message => message.toolUseId),
  )
  const results = new Set(
    messages
      .filter((message): message is Extract<ChatMessage, { role: 'tool_result' }> => (
        message.role === 'tool_result'
      ))
      .map(message => message.toolUseId),
  )

  for (const id of calls) {
    assert.ok(results.has(id), `tool call ${id} should keep its result`)
  }
  for (const id of results) {
    assert.ok(calls.has(id), `tool result ${id} should keep its call`)
  }
}

describe('snipCompactConversation', () => {
  it('does not delete system messages', async () => {
    const messages = makeSnippableConversation()
    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages, 10_000),
      modelContextWindow: 10_000,
    })

    assert.equal(result.didSnip, true)
    assert.equal(result.messages[0]!.role, 'system')
    assert.equal(result.messages[0]!.content, 'System prompt')
  })

  it('does not delete context_summary messages', async () => {
    const messages = withIds([
      { role: 'system', content: 'System' },
      { role: 'context_summary', content: 'Important summary', compressedCount: 12, timestamp: 1 },
      ...makeSnippableConversation({ oldPairs: 14 }).slice(1),
    ])

    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages, 8_000),
      modelContextWindow: 8_000,
    })

    assert.equal(result.didSnip, true)
    assert.ok(result.messages.some(message => (
      message.role === 'context_summary' && message.content === 'Important summary'
    )))
  })

  it('does not delete the most recent kept messages', async () => {
    const messages = makeSnippableConversation()
    const recentIds = messages
      .slice(-SNIP_KEEP_RECENT_MESSAGES)
      .map((message, index) => message.id ?? `recent-${index}`)

    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages, 10_000),
      modelContextWindow: 10_000,
    })

    assert.equal(result.didSnip, true)
    const remainingIds = new Set(result.messages.map(message => message.id))
    for (const id of recentIds) {
      assert.ok(remainingIds.has(id), `recent message ${id} should be preserved`)
    }
  })

  it('does not delete the latest user message or messages after it', async () => {
    const messages = withIds([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Opening request' },
      ...Array.from({ length: 16 }, (_, i) => (
        { role: i % 2 === 0 ? 'assistant' : 'user', content: `Old ${i}: ${'x'.repeat(2_000)}` } as ChatMessage
      )),
      { role: 'user', content: 'Latest active user request' },
      ...Array.from({ length: SNIP_KEEP_RECENT_MESSAGES + 3 }, (_, i) => (
        { role: 'assistant', content: `After latest user ${i}` } as ChatMessage
      )),
    ])
    const protectedIds = messages
      .slice(messages.findIndex(message => message.content === 'Latest active user request'))
      .map(message => message.id)

    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages, 10_000),
      modelContextWindow: 10_000,
    })

    assert.equal(result.didSnip, true)
    const remainingIds = new Set(result.messages.map(message => message.id))
    for (const id of protectedIds) {
      assert.ok(remainingIds.has(id), `message after latest user should be preserved: ${id}`)
    }
  })

  it('does not split tool_call and tool_result pairs', async () => {
    const messages = withIds([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Start' },
      { role: 'assistant', content: 'Old text ' + 'x'.repeat(3_000) },
      { role: 'assistant_tool_call', toolUseId: 'read-1', toolName: 'read_file', input: { path: 'a.ts' } },
      { role: 'tool_result', toolUseId: 'read-1', toolName: 'read_file', content: 'file\n'.repeat(2_000), isError: false },
      { role: 'assistant', content: 'More old text ' + 'y'.repeat(3_000) },
      { role: 'user', content: 'Another old follow-up ' + 'z'.repeat(3_000) },
      { role: 'assistant', content: 'Another old answer ' + 'q'.repeat(3_000) },
      ...Array.from({ length: SNIP_KEEP_RECENT_MESSAGES - 1 }, (_, i) => (
        { role: i % 2 === 0 ? 'assistant' : 'user', content: `Recent ${i}` } as ChatMessage
      )),
      { role: 'user', content: 'Current task' },
    ])

    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages, 10_000),
      modelContextWindow: 10_000,
    })

    assert.equal(result.didSnip, true)
    assertNoToolOrphans(result.messages)
    const removed = new Set(result.removedMessageIds)
    assert.equal(removed.has('m-3'), removed.has('m-4'))
  })

  it('does not delete unclosed tool calls', async () => {
    const messages = withIds([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Start' },
      ...Array.from({ length: 10 }, (_, i) => (
        { role: i % 2 === 0 ? 'assistant' : 'user', content: `Old safe ${i}: ${'x'.repeat(2_000)}` } as ChatMessage
      )),
      { role: 'assistant_tool_call', toolUseId: 'open-call', toolName: 'read_file', input: { path: 'unfinished.ts' } },
      { role: 'assistant', content: 'Important after unclosed call' },
      ...Array.from({ length: SNIP_KEEP_RECENT_MESSAGES - 1 }, (_, i) => (
        { role: i % 2 === 0 ? 'assistant' : 'user', content: `Recent ${i}` } as ChatMessage
      )),
      { role: 'user', content: 'Current task' },
    ])

    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages, 8_000),
      modelContextWindow: 8_000,
    })

    assert.equal(result.didSnip, true)
    assert.ok(result.messages.some(message => (
      message.role === 'assistant_tool_call' && message.toolUseId === 'open-call'
    )))
  })

  it('protects patch/edit tool groups and their neighboring messages', async () => {
    const messages = withIds([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Start' },
      ...Array.from({ length: 12 }, (_, i) => (
        { role: i % 2 === 0 ? 'assistant' : 'user', content: `Old safe ${i}: ${'x'.repeat(2_000)}` } as ChatMessage
      )),
      { role: 'assistant', content: 'Keep before patch' },
      { role: 'assistant_tool_call', toolUseId: 'patch-1', toolName: 'patch_file', input: { path: 'a.ts' } },
      { role: 'tool_result', toolUseId: 'patch-1', toolName: 'patch_file', content: 'patched', isError: false },
      { role: 'assistant', content: 'Keep after patch' },
      ...Array.from({ length: SNIP_KEEP_RECENT_MESSAGES - 1 }, (_, i) => (
        { role: i % 2 === 0 ? 'assistant' : 'user', content: `Recent ${i}` } as ChatMessage
      )),
      { role: 'user', content: 'Current task' },
    ])
    const protectedContents = new Set(['Keep before patch', 'Keep after patch'])

    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages, 10_000),
      modelContextWindow: 10_000,
    })

    assert.equal(result.didSnip, true)
    assert.ok(result.messages.some(message => (
      message.role === 'assistant_tool_call' && message.toolUseId === 'patch-1'
    )))
    assert.ok(result.messages.some(message => (
      message.role === 'tool_result' && message.toolUseId === 'patch-1'
    )))
    for (const content of protectedContents) {
      assert.ok(result.messages.some(message => (
        'content' in message && message.content === content
      )), `${content} should be preserved`)
    }
  })

  it('protects important error tool results and their neighboring messages', async () => {
    const messages = withIds([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Start' },
      ...Array.from({ length: 12 }, (_, i) => (
        { role: i % 2 === 0 ? 'assistant' : 'user', content: `Old safe ${i}: ${'x'.repeat(2_000)}` } as ChatMessage
      )),
      { role: 'assistant', content: 'Keep before error' },
      { role: 'assistant_tool_call', toolUseId: 'run-1', toolName: 'run_command', input: { command: 'npm test' } },
      { role: 'tool_result', toolUseId: 'run-1', toolName: 'run_command', content: 'Traceback: exception failed', isError: false },
      { role: 'assistant', content: 'Keep after error' },
      ...Array.from({ length: SNIP_KEEP_RECENT_MESSAGES - 1 }, (_, i) => (
        { role: i % 2 === 0 ? 'assistant' : 'user', content: `Recent ${i}` } as ChatMessage
      )),
      { role: 'user', content: 'Current task' },
    ])

    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages, 10_000),
      modelContextWindow: 10_000,
    })

    assert.equal(result.didSnip, true)
    assert.ok(result.messages.some(message => (
      message.role === 'tool_result' && message.toolUseId === 'run-1'
    )))
    assert.ok(result.messages.some(message => (
      'content' in message && message.content === 'Keep before error'
    )))
    assert.ok(result.messages.some(message => (
      'content' in message && message.content === 'Keep after error'
    )))
  })

  it('protects ordinary messages with important error markers and their neighbors', async () => {
    const messages = withIds([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Start' },
      ...Array.from({ length: 12 }, (_, i) => (
        { role: i % 2 === 0 ? 'assistant' : 'user', content: `Old safe ${i}: ${'x'.repeat(2_000)}` } as ChatMessage
      )),
      { role: 'assistant', content: 'Keep before traceback note' },
      { role: 'assistant', content: 'Traceback analysis: exception failed in prior command' },
      { role: 'assistant', content: 'Keep after traceback note' },
      ...Array.from({ length: SNIP_KEEP_RECENT_MESSAGES - 1 }, (_, i) => (
        { role: i % 2 === 0 ? 'assistant' : 'user', content: `Recent ${i}` } as ChatMessage
      )),
      { role: 'user', content: 'Current task' },
    ])

    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages, 10_000),
      modelContextWindow: 10_000,
    })

    assert.equal(result.didSnip, true)
    assert.ok(result.messages.some(message => (
      'content' in message && message.content === 'Keep before traceback note'
    )))
    assert.ok(result.messages.some(message => (
      'content' in message && message.content === 'Traceback analysis: exception failed in prior command'
    )))
    assert.ok(result.messages.some(message => (
      'content' in message && message.content === 'Keep after traceback note'
    )))
  })

  it('deletes an old ordinary contiguous interval and inserts a boundary', async () => {
    const messages = makeSnippableConversation()
    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages),
      modelContextWindow: 20_000,
    })

    assert.equal(result.didSnip, true)
    assert.ok(result.removedMessageIds.length >= SNIP_MIN_MESSAGES_TO_REMOVE)
    assert.ok(result.boundaryMessage)
    assert.equal(result.boundaryMessage!.role, 'snip_boundary')
    assert.equal(
      result.messages.filter(message => message.role === 'snip_boundary').length,
      1,
    )
    const removedIndexes = result.removedMessageIds.map(id => Number(id.slice('m-'.length)))
    for (let i = 1; i < removedIndexes.length; i++) {
      assert.equal(removedIndexes[i], removedIndexes[i - 1]! + 1)
    }
  })

  it('reduces token count after snipping', async () => {
    const messages = makeSnippableConversation()
    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages),
      modelContextWindow: 20_000,
    })

    assert.equal(result.didSnip, true)
    assert.ok(result.tokensAfter < result.tokensBefore)
  })

  it('returns didSnip=false when there are too few messages', async () => {
    const messages = withIds([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'x'.repeat(30_000) },
    ])
    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages, 10_000),
      modelContextWindow: 10_000,
    })

    assert.equal(result.didSnip, false)
  })

  it('returns didSnip=false when there is no safe interval', async () => {
    const messages: ChatMessage[] = withIds([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Start' },
      ...Array.from({ length: 8 }, (_, i) => ([
        { role: 'assistant_tool_call' as const, toolUseId: `edit-${i}`, toolName: 'edit_file', input: { path: `f${i}.ts` } },
        { role: 'tool_result' as const, toolUseId: `edit-${i}`, toolName: 'edit_file', content: 'edited\n'.repeat(2_000), isError: false },
      ])).flat(),
      ...Array.from({ length: SNIP_KEEP_RECENT_MESSAGES - 1 }, (_, i) => (
        { role: i % 2 === 0 ? 'assistant' : 'user', content: `Recent ${i}` } as ChatMessage
      )),
      { role: 'user', content: 'Current task' },
    ])

    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages, 18_000),
      modelContextWindow: 18_000,
    })

    assert.equal(result.didSnip, false)
  })

  it('does not delete an existing snip_boundary', async () => {
    const previousBoundary: ChatMessage = {
      id: 'existing-snip',
      role: 'snip_boundary',
      content: '[Snipped earlier conversation segment]',
      removedMessageIds: ['old-a'],
      removedCount: 1,
      tokensFreed: 2_000,
      timestamp: 1,
    }
    const messages = withIds([
      { role: 'system', content: 'System' },
      previousBoundary,
      ...makeSnippableConversation({ oldPairs: 14 }).slice(1),
    ])
    messages[1] = previousBoundary

    const result = await snipCompactConversation({
      messages,
      contextStats: contextStats(messages),
      modelContextWindow: 20_000,
    })

    assert.equal(result.didSnip, true)
    assert.ok(result.messages.some(message => message.id === 'existing-snip'))
  })

  it('microcompact does not clear snip_boundary messages', () => {
    const boundary: ChatMessage = {
      id: 'snip-boundary',
      role: 'snip_boundary',
      content: '[Snipped earlier conversation segment]',
      removedMessageIds: ['old-1'],
      removedCount: 1,
      tokensFreed: 2_000,
      timestamp: 1,
    }
    const bigContent = 'x'.repeat(80_000)
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System' },
      boundary,
      { role: 'assistant_tool_call', toolUseId: 'id-1', toolName: 'read_file', input: {} },
      { role: 'tool_result', toolUseId: 'id-1', toolName: 'read_file', content: bigContent, isError: false },
      { role: 'assistant_tool_call', toolUseId: 'id-2', toolName: 'read_file', input: {} },
      { role: 'tool_result', toolUseId: 'id-2', toolName: 'read_file', content: bigContent, isError: false },
      { role: 'assistant_tool_call', toolUseId: 'id-3', toolName: 'read_file', input: {} },
      { role: 'tool_result', toolUseId: 'id-3', toolName: 'read_file', content: bigContent, isError: false },
      { role: 'assistant_tool_call', toolUseId: 'id-4', toolName: 'read_file', input: {} },
      { role: 'tool_result', toolUseId: 'id-4', toolName: 'read_file', content: bigContent, isError: false },
      { role: 'user', content: 'Continue' },
    ]

    const result = microcompact(messages, 'deepseek-chat')

    assert.ok(result.some(message => (
      message.role === 'snip_boundary' &&
      message.content === '[Snipped earlier conversation segment]'
    )))
  })

  it('autoCompact uses post-snip stats instead of stale pre-snip usage', async () => {
    const messages = makeSnippableConversation({
      oldPairs: 60,
      oldSize: 5_000,
      recentCount: SNIP_KEEP_RECENT_MESSAGES,
    })
    let modelCalls = 0
    let didSnip = false
    const adapter: ModelAdapter = {
      async next(): Promise<AgentStep> {
        modelCalls += 1
        return { type: 'assistant', content: 'Done' }
      },
    }

    const result = await runAgentTurn({
      model: adapter,
      tools: new ToolRegistry([]),
      messages,
      cwd: process.cwd(),
      modelName: 'deepseek-chat',
      maxSteps: 1,
      onSnipCompact() {
        didSnip = true
      },
    })

    assert.equal(didSnip, true)
    assert.equal(modelCalls, 1, 'autoCompact would have made an extra model call')
    assert.equal(result.at(-1)?.role, 'assistant')
  })
})
