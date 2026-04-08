type ModelMaxOutputTokens = {
  default: number
  upperLimit: number
}

const UNKNOWN_MODEL_MAX_OUTPUT_TOKENS: ModelMaxOutputTokens = {
  default: 32_000,
  upperLimit: 64_000,
}

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some(pattern => value.includes(pattern))
}

export function getModelMaxOutputTokens(model: string): ModelMaxOutputTokens {
  const normalized = model.trim().toLowerCase()

  if (normalized.includes('opus-4-6')) {
    return { default: 64_000, upperLimit: 128_000 }
  }

  if (normalized.includes('sonnet-4-6')) {
    return { default: 32_000, upperLimit: 128_000 }
  }

  if (includesAny(normalized, ['opus-4-5', 'sonnet-4', 'haiku-4'])) {
    return { default: 32_000, upperLimit: 64_000 }
  }

  if (includesAny(normalized, ['opus-4-1', 'opus-4'])) {
    return { default: 32_000, upperLimit: 32_000 }
  }

  if (
    includesAny(normalized, [
      'claude-3-sonnet',
      '3-5-sonnet',
      '3-5-haiku',
    ])
  ) {
    return { default: 8_192, upperLimit: 8_192 }
  }

  if (includesAny(normalized, ['claude-3-opus', 'claude-3-haiku'])) {
    return { default: 4_096, upperLimit: 4_096 }
  }

  return UNKNOWN_MODEL_MAX_OUTPUT_TOKENS
}

export function resolveMaxOutputTokens(
  model: string,
  configuredMaxOutputTokens?: number,
): number {
  const limits = getModelMaxOutputTokens(model)
  if (
    configuredMaxOutputTokens !== undefined &&
    Number.isFinite(configuredMaxOutputTokens) &&
    configuredMaxOutputTokens > 0
  ) {
    return Math.min(Math.floor(configuredMaxOutputTokens), limits.upperLimit)
  }

  return limits.default
}
