type ModelMaxOutputTokens = {
  default: number
  upperLimit: number
}

type ModelMaxOutputTokenRule = {
  patterns: string[]
  limits: ModelMaxOutputTokens
}

const UNKNOWN_MODEL_MAX_OUTPUT_TOKENS: ModelMaxOutputTokens = {
  default: 32_000,
  upperLimit: 64_000,
}

const MODEL_MAX_OUTPUT_TOKEN_RULES: ModelMaxOutputTokenRule[] = [
  {
    patterns: ['claude-opus-4-6', 'claude opus 4.6', 'opus-4-6'],
    limits: { default: 128_000, upperLimit: 128_000 },
  },
  {
    patterns: ['claude-sonnet-4-6', 'claude sonnet 4.6', 'sonnet-4-6'],
    limits: { default: 64_000, upperLimit: 64_000 },
  },
  {
    patterns: ['claude-haiku-4-5', 'claude haiku 4.5', 'haiku-4-5'],
    limits: { default: 64_000, upperLimit: 64_000 },
  },
  {
    patterns: ['claude-opus-4-1', 'claude opus 4.1', 'opus-4-1', 'claude-opus-4', 'claude opus 4', 'opus-4'],
    limits: { default: 32_000, upperLimit: 32_000 },
  },
  {
    patterns: ['claude-sonnet-4', 'claude sonnet 4', 'sonnet-4'],
    limits: { default: 64_000, upperLimit: 64_000 },
  },
  {
    patterns: ['claude-3-7-sonnet', 'claude 3.7 sonnet', '3-7-sonnet'],
    limits: { default: 8_192, upperLimit: 8_192 },
  },
  {
    patterns: ['claude-3-5-sonnet', 'claude 3.5 sonnet', '3-5-sonnet', 'claude-3-sonnet'],
    limits: { default: 8_192, upperLimit: 8_192 },
  },
  {
    patterns: ['claude-3-5-haiku', 'claude 3.5 haiku', '3-5-haiku'],
    limits: { default: 8_192, upperLimit: 8_192 },
  },
  {
    patterns: ['claude-3-opus', 'claude 3 opus'],
    limits: { default: 4_096, upperLimit: 4_096 },
  },
  {
    patterns: ['claude-3-haiku', 'claude 3 haiku'],
    limits: { default: 4_096, upperLimit: 4_096 },
  },
  {
    patterns: ['gpt-5-codex', 'gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5'],
    limits: { default: 128_000, upperLimit: 128_000 },
  },
  {
    patterns: ['o4-mini', 'o3', 'o1-pro', 'o1'],
    limits: { default: 100_000, upperLimit: 100_000 },
  },
  {
    patterns: ['gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4.1'],
    limits: { default: 32_768, upperLimit: 32_768 },
  },
  {
    patterns: ['gpt-4o-mini', 'gpt-4o'],
    limits: { default: 16_384, upperLimit: 16_384 },
  },
  {
    patterns: ['gpt-4'],
    limits: { default: 8_192, upperLimit: 8_192 },
  },
  {
    patterns: ['gemini-2.5-pro', 'gemini 2.5 pro', 'gemini-2.5-flash-lite', 'gemini 2.5 flash-lite', 'gemini-2.5-flash', 'gemini 2.5 flash'],
    limits: { default: 65_536, upperLimit: 65_536 },
  },
  {
    patterns: ['deepseek-reasoner'],
    limits: { default: 32_000, upperLimit: 64_000 },
  },
  {
    patterns: ['deepseek-chat'],
    limits: { default: 4_000, upperLimit: 8_000 },
  },
]

export function getModelMaxOutputTokens(model: string, baseUrl?: string): ModelMaxOutputTokens {
  const normalized = model.trim().toLowerCase()
  if (
    (normalized === 'minimax-m3.1-flash' || normalized === 'minimax-m3') &&
    /^https:\/\/api\.(minimax\.io|minimaxi\.com)\/anthropic\/?$/.test(baseUrl ?? '')
  ) {
    return { default: 32_000, upperLimit: 524_288 }
  }
  for (const rule of MODEL_MAX_OUTPUT_TOKEN_RULES) {
    if (rule.patterns.some(pattern => normalized.includes(pattern))) {
      return rule.limits
    }
  }

  return UNKNOWN_MODEL_MAX_OUTPUT_TOKENS
}

export function resolveMaxOutputTokens(
  model: string,
  configuredMaxOutputTokens?: number,
  baseUrl?: string,
): number {
  const limits = getModelMaxOutputTokens(model, baseUrl)
  if (
    configuredMaxOutputTokens !== undefined &&
    Number.isFinite(configuredMaxOutputTokens) &&
    configuredMaxOutputTokens > 0
  ) {
    return Math.min(Math.floor(configuredMaxOutputTokens), limits.upperLimit)
  }

  return limits.default
}

export const COMPACTABLE_TOOLS = new Set([
  'read_file',
  'run_command',
  'search_files',
  'list_files',
  'web_fetch',
])
