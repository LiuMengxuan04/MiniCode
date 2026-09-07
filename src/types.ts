export type ProviderUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  source: string
}

export type ProviderUsageMetadata = {
  providerUsage?: ProviderUsage
  usageStale?: boolean
  usageStaleReason?: string
}

export type ProviderThinkingBlock = {
  type: 'thinking' | 'redacted_thinking'
  [key: string]: unknown
}

export type MessageIdentity = {
  id?: string
}

export type ChatMessage =
  | ({ role: 'system'; content: string } & MessageIdentity)
  | ({ role: 'user'; content: string; internal?: 'goal' | 'loop' | 'continuation' } & MessageIdentity)
  | ({ role: 'assistant_thinking'; blocks: ProviderThinkingBlock[] } & MessageIdentity)
  | ({ role: 'assistant'; content: string } & ProviderUsageMetadata & MessageIdentity)
  | ({ role: 'assistant_progress'; content: string } & ProviderUsageMetadata & MessageIdentity)
  | ({
      role: 'assistant_tool_call'
      toolUseId: string
      toolName: string
      input: unknown
    } & ProviderUsageMetadata & MessageIdentity)
  | ({
      role: 'tool_result'
      toolUseId: string
      toolName: string
      content: string
      isError: boolean
    } & MessageIdentity)
  | ({
      role: 'context_summary'
      content: string
      compressedCount: number
      timestamp: number
    } & MessageIdentity)
  | ({
      role: 'snip_boundary'
      content: string
      removedMessageIds: string[]
      removedCount: number
      tokensFreed: number
      timestamp: number
    } & MessageIdentity)

export type ToolCall = {
  id: string
  toolName: string
  input: unknown
}

export type AgentTurnOutcome = 'final' | 'awaiting_user' | 'aborted' | 'max_steps' | 'failed' | 'controlled_stop'

export type AgentTurnResult = {
  messages: ChatMessage[]
  outcome: AgentTurnOutcome
  toolCalls: number
  error?: string
}

export type StepDiagnostics = {
  stopReason?: string
  blockTypes?: string[]
  ignoredBlockTypes?: string[]
}

export type AgentStep =
  | {
      type: 'assistant'
      content: string
      kind?: 'final' | 'progress'
      thinkingBlocks?: ProviderThinkingBlock[]
      diagnostics?: StepDiagnostics
      usage?: ProviderUsage
    }
  | {
      type: 'tool_calls'
      calls: ToolCall[]
      content?: string
      contentKind?: 'progress'
      thinkingBlocks?: ProviderThinkingBlock[]
      diagnostics?: StepDiagnostics
      usage?: ProviderUsage
    }

export type ModelToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type ModelRequestOptions = {
  tools?: ModelToolDefinition[]
  signal?: AbortSignal
}

export interface ModelAdapter {
  next(
    messages: ChatMessage[],
    options?: ModelRequestOptions,
  ): Promise<AgentStep>
}

export type CompressionResult = {
  messages: ChatMessage[]
  summary: Extract<ChatMessage, { role: 'context_summary' }>
  removedCount: number
  tokensBefore: number
  tokensAfter: number
}
