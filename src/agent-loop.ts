import type { ToolRegistry } from './tool.js'
import type {
  ChatMessage,
  CompressionResult,
  ModelAdapter,
  ProviderThinkingBlock,
  ProviderUsage,
} from './types.js'
import type { PermissionManager } from './permissions.js'
import { microcompact } from './compact/microcompact.js'
import { autoCompact } from './compact/auto-compact.js'
import {
  applyContextCollapseIfNeeded,
  createContextCollapseState,
  type ContextCollapseResult,
  type ContextCollapseState,
} from './compact/context-collapse.js'
import {
  snipCompactConversation,
  type SnipCompactResult,
} from './compact/snipCompact.js'
import { computeContextStats } from './utils/token-estimator.js'
import {
  applyToolResultBudget,
  createContentReplacementState,
  replaceLargeToolResult,
  type ContentReplacementState,
  type PendingToolResult,
} from './utils/tool-result-storage.js'

function isEmptyAssistantResponse(content: string): boolean {
  return content.trim().length === 0
}

function withProviderUsage<T extends ChatMessage>(
  message: T,
  usage: ProviderUsage | undefined,
): T {
  if (!usage) return message
  if (
    message.role === 'assistant' ||
    message.role === 'assistant_progress' ||
    message.role === 'assistant_tool_call'
  ) {
    return { ...message, providerUsage: usage } as T
  }
  return message
}

function shouldTreatAssistantAsProgress(args: {
  kind?: 'final' | 'progress'
  content: string
  sawToolResultThisTurn: boolean
}): boolean {
  if (args.kind === 'progress') {
    return true
  }

  if (args.kind === 'final') {
    return false
  }

  if (!args.sawToolResultThisTurn) {
    return false
  }

  return false
}

function formatDiagnostics(args: {
  stopReason?: string
  blockTypes?: string[]
  ignoredBlockTypes?: string[]
}): string {
  const parts: string[] = []

  if (args.stopReason) {
    parts.push(`stop_reason=${args.stopReason}`)
  }

  if ((args.blockTypes?.length ?? 0) > 0) {
    parts.push(`blocks=${args.blockTypes!.join(',')}`)
  }

  if ((args.ignoredBlockTypes?.length ?? 0) > 0) {
    parts.push(`ignored=${args.ignoredBlockTypes!.join(',')}`)
  }

  return parts.length > 0 ? ` 诊断信息: ${parts.join('; ')}。` : ''
}

function isRecoverableThinkingStop(args: {
  isEmpty: boolean
  stopReason?: string
  blockTypes?: string[]
  ignoredBlockTypes?: string[]
}): boolean {
  if (!args.isEmpty) {
    return false
  }

  if (args.stopReason !== 'pause_turn' && args.stopReason !== 'max_tokens') {
    return false
  }

  return (
    (args.blockTypes ?? []).includes('thinking') ||
    (args.ignoredBlockTypes ?? []).includes('thinking')
  )
}

export async function runAgentTurn(args: {
  model: ModelAdapter
  tools: ToolRegistry
  messages: ChatMessage[]
  cwd: string
  permissions?: PermissionManager
  maxSteps?: number
  modelName?: string
  onToolStart?: (toolName: string, input: unknown) => void
  onToolResult?: (toolName: string, output: string, isError: boolean, toolInput?: unknown) => void
  onAssistantMessage?: (content: string) => void
  onProgressMessage?: (content: string) => void
  onAutoCompact?: (result: CompressionResult) => void | Promise<void>
  onSnipCompact?: (result: SnipCompactResult) => void | Promise<void>
  onContextCollapse?: (result: ContextCollapseResult) => void | Promise<void>
  onContextStats?: (stats: import('./utils/token-estimator.js').ContextStats) => void
  contentReplacementState?: ContentReplacementState
  contextCollapseState?: ContextCollapseState
}): Promise<ChatMessage[]> {
  const maxSteps = args.maxSteps
  const modelName = args.modelName ?? ''
  let messages = args.messages
  let emptyResponseRetryCount = 0
  let recoverableThinkingRetryCount = 0
  let toolErrorCount = 0
  let sawToolResultThisTurn = false
  let snippedThisTurn = false
  const contentReplacementState =
    args.contentReplacementState ?? createContentReplacementState()
  let contextCollapseState =
    args.contextCollapseState ?? createContextCollapseState()

  const replaceContextCollapseState = (nextState: ContextCollapseState) => {
    contextCollapseState = nextState
    if (args.contextCollapseState) {
      args.contextCollapseState.spans = [...nextState.spans]
      args.contextCollapseState.enabled = nextState.enabled
      args.contextCollapseState.consecutiveFailures = nextState.consecutiveFailures
    }
  }

  const pushContinuationPrompt = (content: string) => {
    messages = [
      ...messages,
      {
        role: 'user',
        content,
      },
    ]
  }

  const appendThinkingBlocks = (blocks: ProviderThinkingBlock[] | undefined) => {
    if (!blocks || blocks.length === 0) return
    messages = [
      ...messages,
      {
        role: 'assistant_thinking',
        blocks,
      },
    ]
  }

  for (let step = 0; maxSteps == null || step < maxSteps; step++) {
    let latestStats: import('./utils/token-estimator.js').ContextStats | null = null
    let modelMessages = messages

    if (modelName) {
      latestStats = computeContextStats(messages, modelName)

      if (!snippedThisTurn) {
        const snipResult = await snipCompactConversation({
          messages,
          contextStats: latestStats,
          modelContextWindow: latestStats.effectiveInput,
        })
        if (snipResult.didSnip) {
          messages = snipResult.messages
          snippedThisTurn = true
          await args.onSnipCompact?.(snipResult)
          latestStats = computeContextStats(messages, modelName)
          args.onContextStats?.(latestStats)
        }
      }

      const beforeMicrocompact = messages
      messages = microcompact(messages, modelName)
      if (messages !== beforeMicrocompact) {
        latestStats = computeContextStats(messages, modelName)
        args.onContextStats?.(latestStats)
      }

      const collapseResult = await applyContextCollapseIfNeeded(
        messages,
        modelName,
        args.model,
        contextCollapseState,
      )
      replaceContextCollapseState(collapseResult.state)
      modelMessages = collapseResult.messages
      if (collapseResult.collapsed) {
        await args.onContextCollapse?.(collapseResult)
        latestStats = computeContextStats(modelMessages, modelName)
        args.onContextStats?.(latestStats)
      } else if (modelMessages !== messages) {
        latestStats = computeContextStats(modelMessages, modelName)
        args.onContextStats?.(latestStats)
      }
    }

    // AutoCompact: LLM-based compression when context is critical (first step only)
    if (step === 0 && modelName) {
      latestStats = latestStats ?? computeContextStats(modelMessages, modelName)
      args.onContextStats?.(latestStats)
      if (latestStats.warningLevel === 'critical' || latestStats.warningLevel === 'blocked') {
        const result = await autoCompact(modelMessages, modelName, args.model)
        if (result) {
          messages = result.messages
          modelMessages = messages
          replaceContextCollapseState(createContextCollapseState())
          await args.onAutoCompact?.(result)
          latestStats = computeContextStats(messages, modelName)
          args.onContextStats?.(latestStats)
        }
      }
    }

    const next = await args.model.next(modelMessages)

    if (next.type === 'assistant') {
      const isEmpty = isEmptyAssistantResponse(next.content)
      if (
        !isEmpty &&
        shouldTreatAssistantAsProgress({
          kind: next.kind,
          content: next.content,
          sawToolResultThisTurn,
        })
      ) {
        args.onProgressMessage?.(next.content)
        appendThinkingBlocks(next.thinkingBlocks)
        messages = [
          ...messages,
          { role: 'assistant_progress', content: next.content },
        ]
        pushContinuationPrompt(
          sawToolResultThisTurn && next.kind !== 'progress'
            ? 'Continue from your progress update. You have already used tools in this turn, so treat plain status text as progress, not a final answer. Respond with the next concrete tool call, code change, or an explicit <final> answer only if the task is truly complete.'
            : 'Continue immediately from your <progress> update with concrete tool calls, code changes, or an explicit <final> answer only if the task is complete.',
        )
        continue
      }

      if (
        isRecoverableThinkingStop({
          isEmpty,
          stopReason: next.diagnostics?.stopReason,
          blockTypes: next.diagnostics?.blockTypes,
          ignoredBlockTypes: next.diagnostics?.ignoredBlockTypes,
        }) &&
        recoverableThinkingRetryCount < 3
      ) {
        recoverableThinkingRetryCount += 1
        const stopReason = next.diagnostics?.stopReason
        const progressContent =
          stopReason === 'max_tokens'
            ? '模型在 thinking 阶段触发 max_tokens，正在继续请求后续步骤...'
            : '模型返回 pause_turn，正在继续请求后续步骤...'
        args.onProgressMessage?.(progressContent)
        messages = [
          ...messages,
          { role: 'assistant_progress', content: progressContent },
        ]
        pushContinuationPrompt(
          stopReason === 'max_tokens'
            ? 'Your previous response hit max_tokens during thinking before producing the next actionable step. Resume immediately and continue with the next concrete tool call, code change, or an explicit <final> answer only if the task is complete. Do not repeat the earlier plan.'
            : 'Resume from the previous pause_turn and continue the task immediately. Produce the next concrete tool call, code change, or an explicit <final> answer only if the task is complete.',
        )
        continue
      }

      if (isEmpty && emptyResponseRetryCount < 2) {
        emptyResponseRetryCount += 1
        pushContinuationPrompt(
          sawToolResultThisTurn
            ? 'Your last response was empty after recent tool results. Continue immediately by trying the next concrete step, adapting to any tool errors, or giving an explicit <final> answer only if the task is complete.'
            : 'Your last response was empty. Continue immediately with concrete tool calls, code changes, or an explicit <final> answer only if the task is complete.',
        )
        continue
      }

      if (isEmpty) {
        const diagnosticsSuffix = formatDiagnostics({
          stopReason: next.diagnostics?.stopReason,
          blockTypes: next.diagnostics?.blockTypes,
          ignoredBlockTypes: next.diagnostics?.ignoredBlockTypes,
        })
        const fallbackContent =
          sawToolResultThisTurn
            ? toolErrorCount > 0
              ? `工具执行后模型返回空响应，已停止当前回合。最近有 ${toolErrorCount} 个工具报错；请重试、调整命令，或让模型改用其他方案。${diagnosticsSuffix}`
              : `工具执行后模型返回空响应，已停止当前回合。请重试，或要求模型继续完成剩余步骤。${diagnosticsSuffix}`
            : `模型返回空响应，已停止当前回合。请重试，或要求模型继续。${diagnosticsSuffix}`

        args.onAssistantMessage?.(fallbackContent)
        appendThinkingBlocks(next.thinkingBlocks)
        return [
          ...messages,
          {
            role: 'assistant',
            content: fallbackContent,
          },
        ]
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: next.content,
      }
      appendThinkingBlocks(next.thinkingBlocks)
      const withAssistant: ChatMessage[] = [
        ...messages,
        withProviderUsage(assistantMessage, next.usage),
      ]

      if (!isEmpty) {
        args.onAssistantMessage?.(next.content)
      }

      return withAssistant
    }

    appendThinkingBlocks(next.thinkingBlocks)

    if (next.content) {
      if (next.contentKind === 'progress') {
        args.onProgressMessage?.(next.content)
        messages = [
          ...messages,
          withProviderUsage({ role: 'assistant_progress', content: next.content }, next.usage),
        ]
        pushContinuationPrompt(
          'Continue immediately from your <progress> update with concrete tool calls, code changes, or an explicit <final> answer only if the task is complete.',
        )
      } else {
        args.onAssistantMessage?.(next.content)
        messages = [
          ...messages,
          withProviderUsage(
            { role: 'assistant', content: next.content },
            (next.calls?.length ?? 0) > 0 ? undefined : next.usage,
          ),
        ]
      }
    }

    if ((next.calls?.length ?? 0) === 0 && next.content && next.contentKind !== 'progress') {
      return messages
    }

    const executedToolResults: Array<{
      call: (typeof next.calls)[number]
      result: Awaited<ReturnType<ToolRegistry['execute']>>
      toolResult: PendingToolResult
    }> = []

    for (const call of next.calls) {
      args.onToolStart?.(call.toolName, call.input)
      const result = await args.tools.execute(
        call.toolName,
        call.input,
        { cwd: args.cwd, permissions: args.permissions },
      )
      sawToolResultThisTurn = true
      if (!result.ok) {
        toolErrorCount += 1
      }
      args.onToolResult?.(call.toolName, result.output, !result.ok, call.input)

      const toolResult = await replaceLargeToolResult({
        role: 'tool_result',
        toolUseId: call.id,
        toolName: call.toolName,
        content: result.output,
        isError: !result.ok,
      }, contentReplacementState)

      executedToolResults.push({
        call,
        result,
        toolResult,
      })
    }

    const budgetedResults = await applyToolResultBudget(
      executedToolResults.map(entry => entry.toolResult),
      contentReplacementState,
    )
    const toolResultById = new Map(
      budgetedResults.results.map(result => [result.toolUseId, result]),
    )

    const toolCallMessages = executedToolResults.map((entry, i) => {
      const toolCallMessage: ChatMessage = {
        role: 'assistant_tool_call',
        toolUseId: entry.call.id,
        toolName: entry.call.toolName,
        input: entry.call.input,
      }

      return withProviderUsage(
        toolCallMessage,
        i === executedToolResults.length - 1 ? next.usage : undefined,
      )
    })
    const toolResults = executedToolResults.map(entry =>
      toolResultById.get(entry.call.id) ?? entry.toolResult,
    )

    messages = [
      ...messages,
      ...toolCallMessages,
      ...toolResults,
    ]

    const awaitUserEntry = executedToolResults.find(entry => entry.result.awaitUser)
    if (awaitUserEntry) {
      const question = awaitUserEntry.result.output.trim()
        if (question.length > 0) {
          args.onAssistantMessage?.(question)
          messages = [
            ...messages,
            {
              role: 'assistant',
              content: question,
            },
          ]
        }
        return messages
    }
  }

  const maxStepContent = `达到最大工具步数限制，已停止当前回合。`
  args.onAssistantMessage?.(maxStepContent)
  return [
    ...messages,
    {
      role: 'assistant',
      content: maxStepContent,
    },
  ]
}
