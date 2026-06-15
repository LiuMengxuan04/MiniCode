import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  TOOL_RESULTS_SUBDIR,
  sessionToolResultPath,
  sessionToolResultsDir,
} from '../session-paths.js'
import type { ChatMessage } from '../types.js'

export { TOOL_RESULTS_SUBDIR }

export const PERSISTED_OUTPUT_TAG = '<persisted-output>'
export const PERSISTED_OUTPUT_CLOSING_TAG = '</persisted-output>'

export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000
export const MAX_TOOL_RESULTS_PER_BATCH_CHARS = 200_000
/** Default preview length for most tools. */
export const PREVIEW_SIZE_CHARS = 2_000
/**
 * Larger preview for shell/command tools whose output tends to be long and
 * structured (e.g. build output, test runners, grep results).
 */
export const SHELL_PREVIEW_SIZE_CHARS = 5_000

/**
 * Tool names whose output is expected to be long and command-like.
 * These receive a larger in-context preview when their result is persisted.
 */
export const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'run_command',
  'bash',
  'local_bash',
])

export type ToolResultStorageContext = {
  cwd: string
  sessionId: string
}

export type ContentReplacementState = {
  seenIds: Set<string>
  replacements: Map<string, string>
  storageContext: ToolResultStorageContext
}

export type ToolResultReplacementRecord = {
  kind: 'tool-result'
  toolUseId: string
  replacement: string
}

export type PendingToolResult = Extract<ChatMessage, { role: 'tool_result' }>

type ReplacementCandidate = {
  toolUseId: string
  content: string
  size: number
}

const fallbackSessionId = `ephemeral-${randomUUID()}`

function resolveStorageContext(
  storageContext?: Partial<ToolResultStorageContext>,
): ToolResultStorageContext {
  return {
    cwd: storageContext?.cwd ?? process.cwd(),
    sessionId: storageContext?.sessionId?.trim() || fallbackSessionId,
  }
}

export function createContentReplacementState(
  storageContext?: Partial<ToolResultStorageContext>,
): ContentReplacementState {
  return {
    seenIds: new Set(),
    replacements: new Map(),
    storageContext: resolveStorageContext(storageContext),
  }
}

export function getToolResultsDir(
  storageContext?: Partial<ToolResultStorageContext>,
): string {
  const resolved = resolveStorageContext(storageContext)
  return sessionToolResultsDir(resolved.cwd, resolved.sessionId)
}

function getToolResultPath(
  toolUseId: string,
  storageContext?: Partial<ToolResultStorageContext>,
  ext: 'txt' | 'json' = 'txt',
): string {
  const resolved = resolveStorageContext(storageContext)
  return sessionToolResultPath(resolved.cwd, resolved.sessionId, toolUseId, ext)
}

function isAlreadyPersistedOutput(content: string): boolean {
  return content.startsWith(PERSISTED_OUTPUT_TAG)
}

function generatePreview(
  content: string,
  previewSize = PREVIEW_SIZE_CHARS,
): { preview: string; hasMore: boolean } {
  if (content.length <= previewSize) {
    return { preview: content, hasMore: false }
  }

  const truncated = content.slice(0, previewSize)
  const lastNewline = truncated.lastIndexOf('\n')
  const cutPoint = lastNewline > previewSize * 0.5
    ? lastNewline
    : previewSize

  return {
    preview: content.slice(0, cutPoint),
    hasMore: true,
  }
}

function formatChars(chars: number): string {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)}M chars`
  if (chars >= 1_000) return `${Math.round(chars / 1_000)}K chars`
  return `${chars} chars`
}

/**
 * A structured content block as returned by the Anthropic API (or similar).
 * Blocks with `type === 'text'` contribute to the in-context preview;
 * others are preserved in the JSON file but not shown in the preview.
 */
type ContentBlock = { type: string; text?: string; [key: string]: unknown }

function isContentBlockArray(value: unknown): value is ContentBlock[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof (value as unknown[])[0] === 'object' &&
    (value as ContentBlock[])[0] !== null &&
    'type' in (value as ContentBlock[])[0]
  )
}

/**
 * Extracts plain text from a content-block array for preview / normalization.
 * Non-text blocks are represented as `[<type>]` placeholders.
 */
function textFromContentBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map(b => (typeof b.text === 'string' ? b.text : `[${b.type}]`))
    .join('\n')
}

export function normalizeToolResultContent(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (isContentBlockArray(content)) return textFromContentBlocks(content)
  return String(content)
}

async function persistToolResult(
  content: string,
  toolUseId: string,
  storageContext?: Partial<ToolResultStorageContext>,
  previewSize = PREVIEW_SIZE_CHARS,
): Promise<{ filepath: string; originalSize: number; preview: string; hasMore: boolean } | null> {
  const filepath = getToolResultPath(toolUseId, storageContext, 'txt')
  try {
    await mkdir(path.dirname(filepath), { recursive: true })
    await writeFile(filepath, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
    if (code !== 'EEXIST') {
      return null
    }
  }

  const { preview, hasMore } = generatePreview(content, previewSize)
  return {
    filepath,
    originalSize: content.length,
    preview,
    hasMore,
  }
}

/**
 * Persists a structured content-block array as JSON.
 * Returns the same shape as `persistToolResult` but uses the `.json` extension
 * and serializes the raw blocks alongside a text-based preview.
 */
async function persistStructuredToolResult(
  blocks: ContentBlock[],
  toolUseId: string,
  storageContext?: Partial<ToolResultStorageContext>,
  previewSize = PREVIEW_SIZE_CHARS,
): Promise<{ filepath: string; originalSize: number; preview: string; hasMore: boolean } | null> {
  const serialized = JSON.stringify(blocks, null, 2)
  const filepath = getToolResultPath(toolUseId, storageContext, 'json')
  try {
    await mkdir(path.dirname(filepath), { recursive: true })
    await writeFile(filepath, serialized, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
    if (code !== 'EEXIST') {
      return null
    }
  }

  const textContent = textFromContentBlocks(blocks)
  const { preview, hasMore } = generatePreview(textContent, previewSize)
  return {
    filepath,
    originalSize: serialized.length,
    preview,
    hasMore,
  }
}

function buildPersistedToolResultMessage(result: {
  filepath: string
  originalSize: number
  preview: string
  hasMore: boolean
}): string {
  const parts = [
    PERSISTED_OUTPUT_TAG,
    `Output too large (${formatChars(result.originalSize)}). Full output saved to: ${result.filepath}`,
    '',
    `Preview (first ${formatChars(PREVIEW_SIZE_CHARS)}):`,
    result.preview,
  ]

  if (result.hasMore) {
    parts.push('...')
  }

  parts.push(PERSISTED_OUTPUT_CLOSING_TAG)
  return parts.join('\n')
}

export async function replaceLargeToolResult(
  result: Omit<PendingToolResult, 'content'> & { content: unknown },
  stateOrThreshold?: ContentReplacementState | number,
  maybeThreshold = DEFAULT_MAX_RESULT_SIZE_CHARS,
): Promise<PendingToolResult> {
  const state =
    typeof stateOrThreshold === 'number' ? undefined : stateOrThreshold
  const threshold =
    typeof stateOrThreshold === 'number' ? stateOrThreshold : maybeThreshold

  // Detect structured (content-block array) before string normalization
  const isStructured = isContentBlockArray(result.content)
  const content = normalizeToolResultContent(result.content)
  const normalizedResult: PendingToolResult = {
    ...result,
    content,
  }

  const previousReplacement = state?.replacements.get(result.toolUseId)
  if (previousReplacement !== undefined) {
    return {
      ...normalizedResult,
      content: previousReplacement,
    }
  }

  if (content.trim().length === 0) {
    state?.seenIds.add(result.toolUseId)
    return {
      ...normalizedResult,
      content: `(${result.toolName} completed with no output)`,
    }
  }

  if (isAlreadyPersistedOutput(content)) {
    state?.seenIds.add(result.toolUseId)
    state?.replacements.set(result.toolUseId, content)
    return normalizedResult
  }

  if (!Number.isFinite(threshold) || content.length <= threshold) {
    return normalizedResult
  }

  const previewSize = SHELL_TOOL_NAMES.has(result.toolName)
    ? SHELL_PREVIEW_SIZE_CHARS
    : PREVIEW_SIZE_CHARS

  const persisted = isStructured
    ? await persistStructuredToolResult(
        result.content as ContentBlock[],
        result.toolUseId,
        state?.storageContext,
        previewSize,
      )
    : await persistToolResult(
        content,
        result.toolUseId,
        state?.storageContext,
        previewSize,
      )

  if (!persisted) {
    return normalizedResult
  }

  const replacement = buildPersistedToolResultMessage(persisted)
  state?.seenIds.add(result.toolUseId)
  state?.replacements.set(result.toolUseId, replacement)

  return {
    ...normalizedResult,
    content: replacement,
  }
}

export function reconstructContentReplacementState(
  messages: ChatMessage[],
  storageContext?: Partial<ToolResultStorageContext>,
): ContentReplacementState {
  const state = createContentReplacementState(storageContext)

  for (const message of messages) {
    if (message.role !== 'tool_result') continue
    state.seenIds.add(message.toolUseId)
    if (isAlreadyPersistedOutput(message.content)) {
      state.replacements.set(message.toolUseId, message.content)
    }
  }

  return state
}

export async function applyToolResultBudget(
  results: PendingToolResult[],
  state: ContentReplacementState,
  limit = MAX_TOOL_RESULTS_PER_BATCH_CHARS,
  skipToolNames: ReadonlySet<string> = new Set(),
): Promise<{
  results: PendingToolResult[]
  newlyReplaced: ToolResultReplacementRecord[]
}> {
  if (results.length === 0) {
    return { results, newlyReplaced: [] }
  }

  const replacementMap = new Map<string, string>()
  const freshCandidates: ReplacementCandidate[] = []
  let visibleSize = 0

  for (const result of results) {
    const content = normalizeToolResultContent(result.content)
    const previousReplacement = state.replacements.get(result.toolUseId)
    if (previousReplacement !== undefined) {
      replacementMap.set(result.toolUseId, previousReplacement)
      visibleSize += previousReplacement.length
      continue
    }

    if (state.seenIds.has(result.toolUseId)) {
      visibleSize += content.length
      continue
    }

    if (skipToolNames.has(result.toolName)) {
      state.seenIds.add(result.toolUseId)
      visibleSize += content.length
      continue
    }

    if (content.trim().length === 0) {
      state.seenIds.add(result.toolUseId)
      continue
    }

    if (isAlreadyPersistedOutput(content)) {
      state.seenIds.add(result.toolUseId)
      state.replacements.set(result.toolUseId, content)
      replacementMap.set(result.toolUseId, content)
      visibleSize += content.length
      continue
    }

    visibleSize += content.length
    freshCandidates.push({
      toolUseId: result.toolUseId,
      content,
      size: content.length,
    })
  }

  const newlyReplaced: ToolResultReplacementRecord[] = []
  const sortedFreshCandidates = [...freshCandidates].sort((a, b) => {
    const sizeDelta = b.size - a.size
    return sizeDelta !== 0 ? sizeDelta : a.toolUseId.localeCompare(b.toolUseId)
  })

  for (const candidate of sortedFreshCandidates) {
    if (visibleSize <= limit) break

    const persisted = await persistToolResult(
      candidate.content,
      candidate.toolUseId,
      state.storageContext,
    )
    state.seenIds.add(candidate.toolUseId)
    if (!persisted) {
      continue
    }

    const replacement = buildPersistedToolResultMessage(persisted)
    replacementMap.set(candidate.toolUseId, replacement)
    state.replacements.set(candidate.toolUseId, replacement)
    visibleSize = visibleSize - candidate.size + replacement.length
    newlyReplaced.push({
      kind: 'tool-result',
      toolUseId: candidate.toolUseId,
      replacement,
    })
  }

  for (const candidate of freshCandidates) {
    state.seenIds.add(candidate.toolUseId)
  }

  if (replacementMap.size === 0) {
    return { results, newlyReplaced }
  }

  return {
    results: results.map(result => {
      const replacement = replacementMap.get(result.toolUseId)
      return replacement === undefined
        ? result
        : { ...result, content: replacement }
    }),
    newlyReplaced,
  }
}
