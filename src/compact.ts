import type { ChatMessage, ModelAdapter } from './types.js'

const DEFAULT_AUTO_COMPACT_THRESHOLD_TOKENS = 24_000
const DEFAULT_AUTO_COMPACT_PRESERVE_MESSAGES = 12
const MAX_SUMMARY_CHARS = 8_000
const MAX_TOOL_RESULT_PREVIEW_CHARS = 1_200
const MAX_MESSAGE_PREVIEW_CHARS = 2_000

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function estimateMessageTokens(message: ChatMessage): number {
  switch (message.role) {
    case 'system':
    case 'user':
    case 'assistant':
    case 'assistant_progress':
    case 'context_summary':
      return estimateTokens(message.content)
    case 'assistant_tool_call':
      return estimateTokens(
        `${message.toolName}\n${JSON.stringify(message.input)}`,
      )
    case 'tool_result':
      return estimateTokens(message.content)
  }
}

function isContinuationPrompt(message: ChatMessage): boolean {
  return (
    message.role === 'user' &&
    (
      message.content.startsWith('Continue immediately from your <progress> update') ||
      message.content.startsWith('Continue from your progress update') ||
      message.content.startsWith('Resume from the previous pause_turn') ||
      message.content.startsWith('Your last response was empty') ||
      message.content.startsWith('Your previous response hit max_tokens during thinking')
    )
  )
}

function previewText(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) {
    return trimmed
  }

  return `${trimmed.slice(0, maxChars)}...`
}

function serializeMessageForSummary(message: ChatMessage): string | null {
  if (isContinuationPrompt(message)) {
    return null
  }

  switch (message.role) {
    case 'system':
      return null
    case 'user':
      return `[user]\n${previewText(message.content, MAX_MESSAGE_PREVIEW_CHARS)}`
    case 'assistant':
      return `[assistant]\n${previewText(message.content, MAX_MESSAGE_PREVIEW_CHARS)}`
    case 'assistant_progress':
      return `[assistant progress]\n${previewText(message.content, MAX_MESSAGE_PREVIEW_CHARS)}`
    case 'context_summary':
      return `[earlier summary]\n${previewText(message.content, MAX_MESSAGE_PREVIEW_CHARS)}`
    case 'assistant_tool_call':
      return `[tool call:${message.toolName}]\n${previewText(JSON.stringify(message.input), MAX_MESSAGE_PREVIEW_CHARS)}`
    case 'tool_result':
      return `[tool result:${message.toolName}${message.isError ? ' error' : ''}]\n${previewText(message.content, MAX_TOOL_RESULT_PREVIEW_CHARS)}`
  }
}

function capSummary(summary: string): string {
  const trimmed = summary.trim()
  if (trimmed.length <= MAX_SUMMARY_CHARS) {
    return trimmed
  }

  return `${trimmed.slice(0, MAX_SUMMARY_CHARS)}...`
}

async function fallbackSummary(messages: ChatMessage[]): Promise<string> {
  const lines = messages
    .map(serializeMessageForSummary)
    .filter((value): value is string => Boolean(value))

  const preview = previewText(lines.join('\n\n'), MAX_SUMMARY_CHARS)
  return [
    'Earlier conversation summary:',
    preview || 'No significant earlier context.',
  ].join('\n\n')
}

export async function maybeAutoCompactConversation(args: {
  model: ModelAdapter
  messages: ChatMessage[]
  thresholdTokens?: number
  preserveMessages?: number
  onCompact?: (summary: string) => void
}): Promise<ChatMessage[]> {
  const thresholdTokens =
    args.thresholdTokens ?? DEFAULT_AUTO_COMPACT_THRESHOLD_TOKENS
  const preserveMessages =
    args.preserveMessages ?? DEFAULT_AUTO_COMPACT_PRESERVE_MESSAGES

  const systemMessages = args.messages.filter(message => message.role === 'system')
  const nonSystemMessages = args.messages.filter(message => message.role !== 'system')

  const estimatedTokens = args.messages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0,
  )

  if (
    estimatedTokens < thresholdTokens ||
    nonSystemMessages.length <= preserveMessages + 1
  ) {
    return args.messages
  }

  const tail = nonSystemMessages.slice(-preserveMessages)
  const head = nonSystemMessages.slice(0, -preserveMessages)
  const headWithoutContinuationPrompts = head.filter(message => !isContinuationPrompt(message))

  if (headWithoutContinuationPrompts.length === 0) {
    return args.messages
  }

  let summary = ''
  if (args.model.summarizeConversation) {
    try {
      summary = capSummary(
        await args.model.summarizeConversation(headWithoutContinuationPrompts),
      )
    } catch {
      summary = ''
    }
  }

  if (!summary) {
    summary = await fallbackSummary(headWithoutContinuationPrompts)
  }

  args.onCompact?.(summary)

  return [
    ...systemMessages,
    { role: 'context_summary', content: summary },
    ...tail,
  ]
}

