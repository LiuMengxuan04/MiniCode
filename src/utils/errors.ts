export function getErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code
  }

  if (
    error instanceof Error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    typeof (error.cause as { code?: unknown }).code === 'string'
  ) {
    return (error.cause as { code: string }).code
  }

  return null
}

export function isEnoentError(error: unknown): boolean {
  return getErrorCode(error) === 'ENOENT'
}

/**
 * Error thrown by a model adapter when the upstream API responds with a
 * non-2xx status. Carries the HTTP status so callers can distinguish
 * recoverable conditions (e.g. prompt too long, 400) from hard failures.
 */
export class ModelRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ModelRequestError'
    this.status = status
  }
}

const PROMPT_TOO_LONG_PATTERNS = [
  /prompt is too long/i,
  /too long.*prompt/i,
  /maximum context length/i,
  /context.*exceeded/i,
  /input.*too long/i,
]

/**
 * Detect a "prompt too long" style error: a 400 from the model API whose
 * message matches the well-known wording used by Anthropic-compatible
 * endpoints. Used to trigger automatic compaction and retry.
 */
export function isPromptTooLongError(error: unknown): boolean {
  if (!(error instanceof ModelRequestError) || error.status !== 400) {
    return false
  }
  const message = error.message
  return PROMPT_TOO_LONG_PATTERNS.some(pattern => pattern.test(message))
}
