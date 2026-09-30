import type { AgentStep, ChatMessage, ModelAdapter, ModelRequestOptions } from './types.js'
import { isPromptTooLongError } from './utils/errors.js'
import { LIMITS } from './compact/constants.js'
import {
  snipCompactConversation,
  type SnipCompactResult,
} from './compact/snipCompact.js'
import { computeContextStats } from './utils/token-estimator.js'

export type PromptTooLongRecoveryResult = {
  step: AgentStep
  messages: ChatMessage[]
}

export type PromptTooLongRecoveryArgs = {
  model: ModelAdapter
  modelName: string
  messages: ChatMessage[]
  options?: ModelRequestOptions
  onCompacted?: (result: SnipCompactResult) => void | Promise<void>
}

/**
 * Call `model.next` and recover from "prompt too long" 400 errors by
 * deterministically compacting the transcript (snip compact, no extra model
 * call) and retrying, up to `LIMITS.PTL_MAX_RETRIES` times.
 *
 * Returns the final step together with the messages that were actually sent,
 * so the caller can keep its transcript in sync. Non-prompt-too-long errors
 * and errors where nothing can be freed are rethrown untouched.
 */
export async function requestWithPromptTooLongRecovery(
  args: PromptTooLongRecoveryArgs,
): Promise<PromptTooLongRecoveryResult> {
  let messages = args.messages

  for (let attempt = 0; ; attempt += 1) {
    try {
      const step = await args.model.next(messages, args.options)
      return { step, messages }
    } catch (error) {
      if (!isPromptTooLongError(error) || attempt >= LIMITS.PTL_MAX_RETRIES) {
        throw error
      }

      const stats = computeContextStats(messages, args.modelName)
      const snip = await snipCompactConversation({
        messages,
        contextStats: stats,
        modelContextWindow: stats.effectiveInput,
      })

      if (!snip.didSnip || snip.messages === messages) {
        // Nothing left to free deterministically — surface the original error.
        throw error
      }

      messages = snip.messages
      await args.onCompacted?.(snip)
    }
  }
}
