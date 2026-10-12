import type { ChatMessage, ProviderUsage } from '../types.js'
import { getModelContextWindow } from './model-context.js'

export type TokenAccountingSource =
  | 'provider_usage'
  | 'provider_usage_plus_estimate'
  | 'estimate_only'

export type TokenAccountingResult = {
  totalTokens: number
  providerUsageTokens: number
  estimatedTokens: number
  source: TokenAccountingSource
  isExact: boolean
  usageBoundary?: {
    messageIndex: number
    messageId?: string
  }
  stale?: boolean
  reason?: string
}

export type ContextStats = {
  estimatedTokens: number
  totalTokens: number
  providerUsageTokens: number
  contextWindow: number
  effectiveInput: number
  remainingTokens: number
  utilization: number
  warningLevel: 'normal' | 'warning' | 'critical' | 'blocked'
  accounting: TokenAccountingResult
}

const CHARS_PER_TOKEN: Record<string, number> = {
  system: 3.5,
  user: 3.0,
  assistant_thinking: 3.0,
  assistant: 3.5,
  assistant_progress: 3.5,
  assistant_tool_call: 2.5,
  tool_result: 2.0,
  context_summary: 3.5,
  snip_boundary: 3.5,
}

const CLEAR_MARKER = '[Output cleared for context space]'

function messageContentLength(message: ChatMessage): number {
  switch (message.role) {
    case 'system':
    case 'user':
    case 'assistant':
    case 'assistant_progress':
      return message.content.length
    case 'assistant_thinking':
      try {
        return JSON.stringify(message.blocks).length
      } catch {
        return 0
      }
    case 'assistant_tool_call':
      try {
        return JSON.stringify(message.input).length
      } catch {
        return 0
      }
    case 'tool_result':
      return message.content.length
    case 'context_summary':
      return message.content.length
    case 'snip_boundary':
      return message.content.length
    default:
      return 0
  }
}

export function estimateMessageTokens(message: ChatMessage): number {
  const ratio = CHARS_PER_TOKEN[message.role] ?? 3.0
  const length = messageContentLength(message)
  return Math.ceil(length / ratio)
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const message of messages) {
    total += estimateMessageTokens(message)
  }
  return total
}

function messageProviderUsage(message: ChatMessage): ProviderUsage | undefined {
  if (
    (message.role === 'assistant' ||
      message.role === 'assistant_progress' ||
      message.role === 'assistant_tool_call') &&
    message.providerUsage &&
    !message.usageStale
  ) {
    return message.providerUsage
  }
  return undefined
}

function staleUsageReason(messages: ChatMessage[]): string | undefined {
  for (const message of messages) {
    if (
      (message.role === 'assistant' ||
        message.role === 'assistant_progress' ||
        message.role === 'assistant_tool_call') &&
      message.providerUsage &&
      message.usageStale
    ) {
      return message.usageStaleReason ?? 'provider usage was marked stale'
    }
  }
  return undefined
}

function messageBoundaryId(message: ChatMessage): string | undefined {
  if (message.role === 'assistant_tool_call') return message.toolUseId
  return undefined
}

export function tokenCountWithEstimation(messages: ChatMessage[]): TokenAccountingResult {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = messageProviderUsage(messages[i])
    if (!usage) continue

    const tailMessages = messages.slice(i + 1)
    const estimatedTokens = estimateMessagesTokens(tailMessages)
    return {
      totalTokens: usage.totalTokens + estimatedTokens,
      providerUsageTokens: usage.totalTokens,
      estimatedTokens,
      source: estimatedTokens > 0 ? 'provider_usage_plus_estimate' : 'provider_usage',
      isExact: estimatedTokens === 0,
      usageBoundary: {
        messageIndex: i,
        messageId: messageBoundaryId(messages[i]),
      },
    }
  }

  const reason = staleUsageReason(messages)
  const estimatedTokens = estimateMessagesTokens(messages)
  return {
    totalTokens: estimatedTokens,
    providerUsageTokens: 0,
    estimatedTokens,
    source: 'estimate_only',
    isExact: false,
    stale: Boolean(reason),
    reason: reason ?? 'no provider usage available',
  }
}

export function markProviderUsageStale(
  message: ChatMessage,
  reason: string,
): ChatMessage {
  if (
    (message.role === 'assistant' ||
      message.role === 'assistant_progress' ||
      message.role === 'assistant_tool_call') &&
    message.providerUsage
  ) {
    return {
      ...message,
      usageStale: true,
      usageStaleReason: reason,
    }
  }
  return message
}

export function computeContextStats(
  messages: ChatMessage[],
  model: string,
): ContextStats {
  const window = getModelContextWindow(model)
  const accounting = tokenCountWithEstimation(messages)
  const utilization = Math.min(1, accounting.totalTokens / window.effectiveInput)
  const remainingTokens = Math.max(0, window.effectiveInput - accounting.totalTokens)

  let warningLevel: ContextStats['warningLevel']
  if (utilization >= 0.95) {
    warningLevel = 'blocked'
  } else if (utilization >= 0.85) {
    warningLevel = 'critical'
  } else if (utilization >= 0.50) {
    warningLevel = 'warning'
  } else {
    warningLevel = 'normal'
  }

  return {
    estimatedTokens: accounting.estimatedTokens,
    totalTokens: accounting.totalTokens,
    providerUsageTokens: accounting.providerUsageTokens,
    contextWindow: window.contextWindow,
    effectiveInput: window.effectiveInput,
    remainingTokens,
    utilization,
    warningLevel,
    accounting,
  }
}

export { CLEAR_MARKER }
