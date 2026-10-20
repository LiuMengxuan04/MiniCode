export type ModelContextWindow = {
  contextWindow: number
  outputReserve: number
  effectiveInput: number
}

type ModelContextRule = {
  patterns: string[]
  contextWindow: number
  outputReserve: number
}

const UNKNOWN_MODEL_CONTEXT: ModelContextRule = {
  patterns: [],
  contextWindow: 128_000,
  outputReserve: 8_000,
}

const MODEL_CONTEXT_RULES: ModelContextRule[] = [
  {
    patterns: ['claude-opus-4-6', 'claude opus 4.6', 'opus-4-6'],
    contextWindow: 200_000,
    outputReserve: 16_000,
  },
  {
    patterns: ['claude-sonnet-4-6', 'claude sonnet 4.6', 'sonnet-4-6'],
    contextWindow: 200_000,
    outputReserve: 16_000,
  },
  {
    patterns: ['claude-haiku-4-5', 'claude haiku 4.5', 'haiku-4-5'],
    contextWindow: 200_000,
    outputReserve: 16_000,
  },
  {
    patterns: ['claude-opus-4-1', 'claude opus 4.1', 'opus-4-1', 'claude-opus-4', 'claude opus 4', 'opus-4'],
    contextWindow: 200_000,
    outputReserve: 16_000,
  },
  {
    patterns: ['claude-sonnet-4', 'claude sonnet 4', 'sonnet-4'],
    contextWindow: 200_000,
    outputReserve: 16_000,
  },
  {
    patterns: ['claude-3-7-sonnet', 'claude 3.7 sonnet', '3-7-sonnet'],
    contextWindow: 200_000,
    outputReserve: 8_192,
  },
  {
    patterns: ['claude-3-5-sonnet', 'claude 3.5 sonnet', '3-5-sonnet', 'claude-3-sonnet'],
    contextWindow: 200_000,
    outputReserve: 8_192,
  },
  {
    patterns: ['claude-3-5-haiku', 'claude 3.5 haiku', '3-5-haiku'],
    contextWindow: 200_000,
    outputReserve: 8_192,
  },
  {
    patterns: ['claude-3-opus', 'claude 3 opus'],
    contextWindow: 200_000,
    outputReserve: 4_096,
  },
  {
    patterns: ['claude-3-haiku', 'claude 3 haiku'],
    contextWindow: 200_000,
    outputReserve: 4_096,
  },
  {
    patterns: ['gpt-5-codex', 'gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5'],
    contextWindow: 128_000,
    outputReserve: 16_000,
  },
  {
    patterns: ['o4-mini', 'o3', 'o1-pro', 'o1'],
    contextWindow: 200_000,
    outputReserve: 16_000,
  },
  {
    patterns: ['gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4.1'],
    contextWindow: 1_047_576,
    outputReserve: 16_000,
  },
  {
    patterns: ['gpt-4o-mini', 'gpt-4o'],
    contextWindow: 128_000,
    outputReserve: 16_384,
  },
  {
    patterns: ['gpt-4'],
    contextWindow: 128_000,
    outputReserve: 8_192,
  },
  {
    patterns: ['gemini-2.5-pro', 'gemini 2.5 pro'],
    contextWindow: 1_048_576,
    outputReserve: 16_000,
  },
  {
    patterns: ['gemini-2.5-flash-lite', 'gemini 2.5 flash-lite'],
    contextWindow: 1_048_576,
    outputReserve: 16_000,
  },
  {
    patterns: ['gemini-2.5-flash', 'gemini 2.5 flash'],
    contextWindow: 1_048_576,
    outputReserve: 16_000,
  },
  {
    patterns: ['deepseek-reasoner'],
    contextWindow: 128_000,
    outputReserve: 16_000,
  },
  {
    patterns: ['deepseek-chat'],
    contextWindow: 128_000,
    outputReserve: 4_000,
  },
  {
    patterns: ['minimax-m3.1-flash', 'minimax-m3'],
    contextWindow: 1_000_000,
    outputReserve: 16_000,
  },
  {
    patterns: ['minimax-m2.7'],
    contextWindow: 204_800,
    outputReserve: 16_000,
  },
]

export function getModelContextWindow(model: string): ModelContextWindow {
  const normalized = model.trim().toLowerCase()
  for (const rule of MODEL_CONTEXT_RULES) {
    if (rule.patterns.some(pattern => normalized.includes(pattern))) {
      return {
        contextWindow: rule.contextWindow,
        outputReserve: rule.outputReserve,
        effectiveInput: rule.contextWindow - rule.outputReserve,
      }
    }
  }

  return {
    contextWindow: UNKNOWN_MODEL_CONTEXT.contextWindow,
    outputReserve: UNKNOWN_MODEL_CONTEXT.outputReserve,
    effectiveInput: UNKNOWN_MODEL_CONTEXT.contextWindow - UNKNOWN_MODEL_CONTEXT.outputReserve,
  }
}
