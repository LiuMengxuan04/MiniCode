import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatMessage } from '../src/types.js'
import {
  estimateMessageTokens,
  estimateMessagesTokens,
  computeContextStats,
  tokenCountWithEstimation,
} from '../src/utils/token-estimator.js'

describe('estimateMessageTokens', () => {
  it('estimates tokens for a system message', () => {
    const msg: ChatMessage = { role: 'system', content: 'You are a helpful assistant.' }
    const tokens = estimateMessageTokens(msg)
    assert.ok(tokens > 0)
    assert.ok(tokens < 100, `system message should be small, got ${tokens}`)
  })

  it('estimates tokens for a user message', () => {
    const msg: ChatMessage = { role: 'user', content: 'Hello, how are you?' }
    const tokens = estimateMessageTokens(msg)
    assert.ok(tokens > 0)
  })

  it('estimates more tokens for tool_result (higher density)', () => {
    const content = 'a'.repeat(100)
    const toolResult: ChatMessage = {
      role: 'tool_result',
      toolUseId: '1',
      toolName: 'read_file',
      content,
      isError: false,
    }
    const assistant: ChatMessage = {
      role: 'assistant',
      content,
    }
    const toolTokens = estimateMessageTokens(toolResult)
    const assistantTokens = estimateMessageTokens(assistant)
    assert.ok(toolTokens > assistantTokens, 'tool_result should estimate more tokens than assistant for same content length')
  })

  it('estimates tokens for assistant_tool_call with JSON input', () => {
    const msg: ChatMessage = {
      role: 'assistant_tool_call',
      toolUseId: '1',
      toolName: 'read_file',
      input: { path: '/some/long/path/to/file.ts' },
    }
    const tokens = estimateMessageTokens(msg)
    assert.ok(tokens > 0)
  })

  it('estimates tokens for context_summary', () => {
    const msg: ChatMessage = {
      role: 'context_summary',
      content: 'Summary of conversation so far.',
      compressedCount: 5,
      timestamp: Date.now(),
    }
    const tokens = estimateMessageTokens(msg)
    assert.ok(tokens > 0)
  })

  it('returns 0 for empty content', () => {
    const msg: ChatMessage = { role: 'user', content: '' }
    assert.equal(estimateMessageTokens(msg), 0)
  })
})

describe('estimateMessagesTokens', () => {
  it('sums tokens across all messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System prompt here.' },
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
    ]
    const total = estimateMessagesTokens(messages)
    const sum = messages.reduce((acc, msg) => acc + estimateMessageTokens(msg), 0)
    assert.equal(total, sum)
  })

  it('returns 0 for empty array', () => {
    assert.equal(estimateMessagesTokens([]), 0)
  })
})

describe('computeContextStats', () => {
  it('computes normal warning level for small messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Hello' },
      { role: 'user', content: 'Test' },
    ]
    const stats = computeContextStats(messages, 'claude-sonnet-4-6')
    assert.equal(stats.warningLevel, 'normal')
    assert.ok(stats.utilization < 0.01, 'utilization should be very low')
    assert.ok(stats.estimatedTokens > 0)
    assert.equal(stats.contextWindow, 200_000)
    assert.equal(stats.effectiveInput, 184_000)
    assert.equal(stats.remainingTokens, stats.effectiveInput - stats.totalTokens)
  })

  it('computes blocked warning level for large messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'x'.repeat(600_000) },
    ]
    const stats = computeContextStats(messages, 'deepseek-chat')
    assert.ok(
      stats.warningLevel === 'blocked' || stats.warningLevel === 'critical',
      `expected blocked or critical, got ${stats.warningLevel}`,
    )
    assert.equal(stats.utilization, 1, 'utilization should be capped at 1')
    assert.equal(stats.remainingTokens, 0)
  })

  it('computes warning level for medium messages', () => {
    // effectiveInput for claude-sonnet-4-6 = 184000
    // 50% of 184000 = 92000 tokens
    // at ratio 3.5 for system, 92000 * 3.5 = 322000 chars
    const messages: ChatMessage[] = [
      { role: 'system', content: 'x'.repeat(160_000) },
      { role: 'user', content: 'x'.repeat(160_000) },
    ]
    const stats = computeContextStats(messages, 'claude-sonnet-4-6')
    assert.ok(
      stats.warningLevel === 'warning' || stats.warningLevel === 'critical',
      `expected warning or critical, got ${stats.warningLevel} (util: ${stats.utilization})`,
    )
    assert.ok(stats.utilization >= 0.5)
  })

  it('caps utilization at 1', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'x'.repeat(1_000_000) },
    ]
    const stats = computeContextStats(messages, 'deepseek-chat')
    assert.equal(stats.utilization, 1)
    assert.equal(stats.remainingTokens, 0)
  })
})

describe('tokenCountWithEstimation', () => {
  it('uses provider usage when the latest provider boundary matches current messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: 'Hi',
        providerUsage: {
          inputTokens: 100,
          outputTokens: 25,
          totalTokens: 125,
          source: 'test',
        },
      },
    ]

    const result = tokenCountWithEstimation(messages)
    assert.equal(result.source, 'provider_usage')
    assert.equal(result.providerUsageTokens, 125)
    assert.equal(result.estimatedTokens, 0)
    assert.equal(result.totalTokens, 125)
    assert.equal(result.isExact, true)
  })

  it('uses provider usage plus estimator only for messages after the usage boundary', () => {
    const tail: ChatMessage = { role: 'user', content: 'x'.repeat(300) }
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System' },
      {
        role: 'assistant',
        content: 'Previous answer',
        providerUsage: {
          inputTokens: 700,
          outputTokens: 100,
          totalTokens: 800,
          source: 'test',
        },
      },
      tail,
    ]

    const tailEstimate = estimateMessagesTokens([tail])
    const result = tokenCountWithEstimation(messages)
    assert.equal(result.source, 'provider_usage_plus_estimate')
    assert.equal(result.providerUsageTokens, 800)
    assert.equal(result.estimatedTokens, tailEstimate)
    assert.equal(result.totalTokens, 800 + tailEstimate)
    assert.equal(result.isExact, false)
  })

  it('falls back to estimate_only when no provider usage is available', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Hello' },
    ]

    const result = tokenCountWithEstimation(messages)
    assert.equal(result.source, 'estimate_only')
    assert.equal(result.providerUsageTokens, 0)
    assert.equal(result.estimatedTokens, estimateMessagesTokens(messages))
    assert.equal(result.totalTokens, estimateMessagesTokens(messages))
    assert.equal(result.isExact, false)
  })

  it('ignores stale provider usage after compact-style message transforms', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System' },
      {
        role: 'context_summary',
        content: 'Earlier conversation summary',
        compressedCount: 8,
        timestamp: Date.now(),
      },
      {
        role: 'assistant',
        content: 'Old retained answer',
        providerUsage: {
          inputTokens: 1000,
          outputTokens: 50,
          totalTokens: 1050,
          source: 'test',
        },
        usageStale: true,
        usageStaleReason: 'conversation was compacted after this provider usage was recorded',
      },
    ]

    const result = tokenCountWithEstimation(messages)
    assert.equal(result.source, 'estimate_only')
    assert.equal(result.stale, true)
    assert.match(result.reason ?? '', /compacted/)
    assert.notEqual(result.totalTokens, 1050)
  })
})
