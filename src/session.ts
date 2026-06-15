import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { MINI_CODE_PROJECTS_DIR } from './config.js'
import {
  projectDir,
  sessionArtifactsDir,
  sessionFilePath,
} from './session-paths.js'
import type { ChatMessage } from './types.js'
import {
  createContextCollapseState,
  type CollapseSpan,
  type ContextCollapseState,
} from './compact/context-collapse.js'
import {
  reconstructContentReplacementState,
  type ContentReplacementState,
} from './utils/tool-result-storage.js'

const MAX_TITLE_LENGTH = 60

type EventType = 'system' | 'user' | 'assistant' | 'thinking' | 'progress' | 'tool_call' | 'tool_result' | 'summary' | 'compact_boundary' | 'snip_boundary' | 'context_collapse' | 'rename'

export type SnipBoundaryMetadata = {
  type: 'snip_boundary'
  removedMessageIds: string[]
  removedCount: number
  tokensFreed: number
  timestamp: string
  createdAt: string
}

type SessionEvent = {
  type: EventType
  message?: ChatMessage
  uuid: string
  timestamp: string
  sessionId: string
  cwd: string
  parentUuid: string | null
  logicalParentUuid?: string | null
  subtype?: string
  compactMetadata?: { trigger: string; preTokens: number; postTokens: number }
  snipMetadata?: SnipBoundaryMetadata
  contextCollapseSpan?: CollapseSpan
  title?: string
}

type SessionEventDraft = Omit<SessionEvent, 'timestamp' | 'sessionId' | 'cwd'>

function roleToType(role: string): EventType {
  switch (role) {
    case 'system': return 'system'
    case 'user': return 'user'
    case 'assistant': return 'assistant'
    case 'assistant_thinking': return 'thinking'
    case 'assistant_progress': return 'progress'
    case 'assistant_tool_call': return 'tool_call'
    case 'tool_result': return 'tool_result'
    case 'context_summary': return 'summary'
    case 'snip_boundary': return 'snip_boundary'
    default: return 'user'
  }
}

function ensureMessageId(message: ChatMessage): string {
  if (message.id) return message.id
  message.id = randomUUID()
  return message.id
}

function buildSessionEvent(
  draft: SessionEventDraft,
  sessionId: string,
  cwd: string,
  timestamp: string,
  parentUuid: string | null,
  logicalParentUuid?: string | null,
): SessionEvent {
  return {
    ...draft,
    timestamp,
    sessionId,
    cwd,
    parentUuid,
    logicalParentUuid,
  }
}

function buildMessageEvent(
  message: ChatMessage,
  sessionId: string,
  cwd: string,
  parentUuid: string | null,
  timestamp = new Date().toISOString(),
): SessionEvent {
  const uuid = ensureMessageId(message)
  const event = buildSessionEvent({
    type: roleToType(message.role),
    message,
    uuid,
    parentUuid,
  }, sessionId, cwd, timestamp, parentUuid)
  if (message.role === 'snip_boundary') {
    event.snipMetadata = {
      type: 'snip_boundary',
      removedMessageIds: message.removedMessageIds,
      removedCount: message.removedCount,
      tokensFreed: message.tokensFreed,
      timestamp: event.timestamp,
      createdAt: event.timestamp,
    }
  }
  return event
}

function serializeSessionEvent(event: SessionEvent): string {
  return JSON.stringify(event)
}

function parseEvent(line: string): SessionEvent | null {
  try {
    return JSON.parse(line) as SessionEvent
  } catch {
    return null
  }
}

function unwrapMessage(event: SessionEvent): ChatMessage | null {
  if (event.message) {
    return {
      ...event.message,
      id: event.uuid,
    } as ChatMessage
  }
  return null
}

function reconstructSnippedEvents(events: SessionEvent[]): SessionEvent[] {
  const snipEvents = events.filter(event => (
    event.type === 'snip_boundary' &&
    event.snipMetadata &&
    event.snipMetadata.removedMessageIds.length > 0
  ))

  if (snipEvents.length === 0) {
    return events
  }

  const removedIdToSnips = new Map<string, SessionEvent[]>()
  for (const snip of snipEvents) {
    for (const removedId of snip.snipMetadata!.removedMessageIds) {
      const existing = removedIdToSnips.get(removedId) ?? []
      existing.push(snip)
      removedIdToSnips.set(removedId, existing)
    }
  }

  const insertedSnips = new Set<string>()
  const result: SessionEvent[] = []

  for (const event of events) {
    if (event.type === 'snip_boundary') {
      continue
    }

    const snipsForRemovedEvent = removedIdToSnips.get(event.uuid) ?? []
    if (snipsForRemovedEvent.length > 0) {
      for (const snip of snipsForRemovedEvent) {
        if (!insertedSnips.has(snip.uuid)) {
          result.push(snip)
          insertedSnips.add(snip.uuid)
        }
      }
      continue
    }

    result.push(event)
  }

  return result
}

function extractTitleFromEvents(lines: string[]): string | undefined {
  let renameTitle: string | undefined
  for (const line of lines) {
    const event = parseEvent(line)
    if (event?.type === 'rename' && typeof event.title === 'string') {
      renameTitle = event.title
    }
  }
  if (renameTitle) return renameTitle

  for (const line of lines) {
    const event = parseEvent(line)
    if (!event || event.type !== 'user') continue
    const content = (event.message as { content?: unknown } | null)?.content
    if (typeof content !== 'string' || !content.trim()) continue
    const text = content.trim()
    return text.length > MAX_TITLE_LENGTH ? text.slice(0, MAX_TITLE_LENGTH) + '...' : text
  }
  return undefined
}

async function readLastEventUuid(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    if (lines.length === 0) return null
    const event = parseEvent(lines[lines.length - 1]!)
    return event?.uuid ?? null
  } catch {
    return null
  }
}

/**
 * Reads the session file once and returns both the set of known event UUIDs
 * and the UUID of the last event.  Used by `saveSession` to avoid reading the
 * file twice (once to check for duplicates, once to get the parent UUID).
 */
async function readSessionFileMeta(filePath: string): Promise<{
  existingIds: Set<string>
  lastUuid: string | null
}> {
  try {
    const content = await readFile(filePath, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    const existingIds = new Set<string>()
    let lastUuid: string | null = null
    for (const line of lines) {
      const event = parseEvent(line)
      if (event?.uuid) {
        existingIds.add(event.uuid)
        lastUuid = event.uuid
      }
    }
    return { existingIds, lastUuid }
  } catch {
    return { existingIds: new Set(), lastUuid: null }
  }
}

/**
 * Reads the raw JSONL lines for a session file.
 * Returns null if the file does not exist or cannot be read.
 */
async function readSessionLines(cwd: string, sessionId: string): Promise<string[] | null> {
  try {
    const content = await readFile(sessionFilePath(cwd, sessionId), 'utf8')
    return content.trim().split('\n').filter(Boolean)
  } catch {
    return null
  }
}

/**
 * Scans backward to find the index of the last compact_boundary event.
 * Returns -1 when no boundary exists (i.e., the full file is active).
 */
function findLastCompactBoundaryIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (parseEvent(lines[i]!)?.type === 'compact_boundary') return i
  }
  return -1
}

/**
 * Returns parsed events that are active after the last compact boundary.
 * When no boundary exists the entire file is considered active.
 */
function activeEventsFromLines(lines: string[]): SessionEvent[] {
  const startLine = findLastCompactBoundaryIndex(lines) + 1 // +1 on -1 gives 0
  const events: SessionEvent[] = []
  for (let i = startLine; i < lines.length; i++) {
    const event = parseEvent(lines[i]!)
    if (event) events.push(event)
  }
  return events
}

/**
 * Ensures the project directory exists and returns the session file path.
 * Used as the common preamble for all append operations.
 */
async function ensureSessionDir(cwd: string, sessionId: string): Promise<string> {
  const filePath = sessionFilePath(cwd, sessionId)
  await mkdir(projectDir(cwd), { recursive: true })
  return filePath
}

/**
 * Ensures the session directory exists, then reads the UUID of the last
 * persisted event.  Returns the file path alongside the UUID so callers
 * can append without a second round-trip.
 */
async function prepareAppend(
  cwd: string,
  sessionId: string,
): Promise<{ filePath: string; lastUuid: string | null }> {
  const filePath = await ensureSessionDir(cwd, sessionId)
  const lastUuid = await readLastEventUuid(filePath)
  return { filePath, lastUuid }
}

async function appendSessionEvents(
  cwd: string,
  sessionId: string,
  drafts: SessionEventDraft[],
  timestamp = new Date().toISOString(),
): Promise<void> {
  const { filePath, lastUuid } = await prepareAppend(cwd, sessionId)
  let previousUuid = lastUuid
  const lines: string[] = []

  for (const [index, draft] of drafts.entries()) {
    const parentUuid = draft.parentUuid ?? (index === 0 ? null : previousUuid)
    const logicalParentUuid = draft.logicalParentUuid ?? (index === 0 ? lastUuid : undefined)
    const event = buildSessionEvent(draft, sessionId, cwd, timestamp, parentUuid, logicalParentUuid)
    previousUuid = event.uuid
    lines.push(serializeSessionEvent(event))
  }

  await appendFile(filePath, lines.join('\n') + '\n', 'utf8')
}

export async function saveSession(
  cwd: string,
  sessionId: string,
  messages: ChatMessage[],
  alreadySavedCount: number = 0,
): Promise<void> {
  const filePath = await ensureSessionDir(cwd, sessionId)

  // Single file read: get existing IDs (for dedup) and last UUID (for parent chain).
  const { existingIds, lastUuid: initialLastUuid } = await readSessionFileMeta(filePath)
  const nonSystemMessages = messages.slice(1)
  const toSave = nonSystemMessages.filter((message, index) => {
    if (message.id && existingIds.has(message.id)) {
      return false
    }
    if (message.id && !existingIds.has(message.id)) {
      return true
    }
    return index >= alreadySavedCount
  })
  if (toSave.length === 0) return

  let parentUuid = initialLastUuid
  const lines: string[] = []
  for (const m of toSave) {
    const event = buildMessageEvent(m, sessionId, cwd, parentUuid)
    parentUuid = event.uuid
    lines.push(serializeSessionEvent(event))
  }
  await appendFile(filePath, lines.join('\n') + '\n', 'utf8')
}

export async function appendSnipBoundary(
  cwd: string,
  sessionId: string,
  boundaryMessage: Extract<ChatMessage, { role: 'snip_boundary' }>,
): Promise<void> {
  const uuid = ensureMessageId(boundaryMessage)
  const timestamp = new Date().toISOString()
  await appendSessionEvents(cwd, sessionId, [{
    type: 'snip_boundary',
    subtype: 'snip_boundary',
    message: boundaryMessage,
    uuid,
    parentUuid: null,
    snipMetadata: {
      type: 'snip_boundary',
      removedMessageIds: boundaryMessage.removedMessageIds,
      removedCount: boundaryMessage.removedCount,
      tokensFreed: boundaryMessage.tokensFreed,
      timestamp,
      createdAt: timestamp,
    },
  }], timestamp)
}

export async function appendContextCollapseSpan(
  cwd: string,
  sessionId: string,
  span: CollapseSpan,
): Promise<void> {
  await appendSessionEvents(cwd, sessionId, [{
    type: 'context_collapse',
    subtype: 'context_collapse',
    uuid: span.id,
    parentUuid: null,
    contextCollapseSpan: span,
  }])
}

export async function appendCompactBoundary(
  cwd: string,
  sessionId: string,
  summaryText: string,
  trigger: 'auto' | 'manual',
  preTokens: number,
  postTokens: number,
  retainedMessages: ChatMessage[] = [],
): Promise<void> {
  const boundaryUuid: string = randomUUID()
  const summaryUuid: string = randomUUID()

  const drafts: SessionEventDraft[] = [
    {
      type: 'compact_boundary',
      subtype: 'compact_boundary',
      uuid: boundaryUuid,
      parentUuid: null,
      compactMetadata: { trigger, preTokens, postTokens },
    },
    {
      type: 'user',
      message: { role: 'user', content: summaryText },
      uuid: summaryUuid,
      parentUuid: boundaryUuid,
    },
  ]

  let parentUuid: string | null = summaryUuid
  for (const message of retainedMessages) {
    const event = buildMessageEvent(message, sessionId, cwd, parentUuid)
    parentUuid = event.uuid
    drafts.push(event)
  }

  await appendSessionEvents(cwd, sessionId, drafts)
}

export async function loadSession(
  cwd: string,
  sessionId: string,
): Promise<ChatMessage[] | null> {
  try {
    const snapshot = await readActiveSessionSnapshot(cwd, sessionId)
    return snapshot?.messages ?? null
  } catch {
    return null
  }
}

export async function loadContextCollapseState(
  cwd: string,
  sessionId: string,
): Promise<ContextCollapseState | null> {
  try {
    const snapshot = await readActiveSessionSnapshot(cwd, sessionId)
    return snapshot?.contextCollapseState ?? null
  } catch {
    return null
  }
}

export type SessionRuntimeState = {
  messages: ChatMessage[] | null
  contentReplacementState: ContentReplacementState | null
  contextCollapseState: ContextCollapseState | null
}

export async function loadSessionRuntimeState(
  cwd: string,
  sessionId: string,
): Promise<SessionRuntimeState | null> {
  try {
    const snapshot = await readActiveSessionSnapshot(cwd, sessionId)
    if (!snapshot?.messages) return null
    return {
      messages: snapshot.messages,
      contentReplacementState: reconstructContentReplacementState(snapshot.messages, { cwd, sessionId }),
      contextCollapseState: snapshot.contextCollapseState,
    }
  } catch {
    return null
  }
}

export async function loadContentReplacementState(
  cwd: string,
  sessionId: string,
  loadedMessages?: ChatMessage[],
): Promise<ContentReplacementState | null> {
  try {
    if (loadedMessages) {
      return reconstructContentReplacementState(loadedMessages, { cwd, sessionId })
    }

    const snapshot = await readActiveSessionSnapshot(cwd, sessionId)
    if (!snapshot?.messages) return null
    return reconstructContentReplacementState(snapshot.messages, { cwd, sessionId })
  } catch {
    return null
  }
}

export async function clearSession(
  cwd: string,
  sessionId: string,
): Promise<void> {
  try {
    await unlink(sessionFilePath(cwd, sessionId))
  } catch {
    // ignore
  }

  try {
    await rm(sessionArtifactsDir(cwd, sessionId), { recursive: true, force: true })
  } catch {
    // ignore
  }

  try {
    const dir = projectDir(cwd)
    const files = await readdir(dir)
    if (files.length === 0) {
      await rm(dir, { recursive: true, force: true })
    }
  } catch {
    // ignore
  }
}

export type SessionMeta = {
  id: string
  title: string | undefined
  messageCount: number
  updatedAt: number
}

export async function listSessions(cwd: string): Promise<SessionMeta[]> {
  const dir = projectDir(cwd)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const matched = entries.filter(name => name.endsWith('.jsonl'))
  const results: SessionMeta[] = []

  for (const name of matched) {
    const id = name.slice(0, -'.jsonl'.length)
    const filePath = path.join(dir, name)
    try {
      const stats = await stat(filePath)
      const content = await readFile(filePath, 'utf8')
      const lines = content.trim().split('\n').filter(Boolean)
      const title = extractTitleFromEvents(lines)

      results.push({
        id,
        title,
        messageCount: lines.length,
        updatedAt: stats.mtime.getTime(),
      })
    } catch {
      // skip unreadable files
    }
  }

  results.sort((a, b) => b.updatedAt - a.updatedAt)
  return results
}

export async function renameSession(
  cwd: string,
  sessionId: string,
  newTitle: string,
): Promise<boolean> {
  try {
    await readFile(sessionFilePath(cwd, sessionId))
  } catch {
    return false
  }

  const event = JSON.stringify({
    type: 'rename',
    title: newTitle,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId,
    cwd,
  })
  const filePath = await ensureSessionDir(cwd, sessionId)
  await appendFile(filePath, event + '\n', 'utf8')
  return true
}

export async function forkSession(
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  const loaded = await loadSession(cwd, sessionId)
  if (!loaded || loaded.length === 0) return null

  const newId = randomUUID().slice(0, 8)
  await saveSession(cwd, newId, [{ role: 'system', content: '' }, ...loaded])

  // Determine fork title
  const allSessions = await listSessions(cwd)
  const source = allSessions.find(s => s.id === sessionId)
  const baseTitle = source?.title ?? 'session'
  const forkPrefix = baseTitle + '_fork'
  const existingForkNums = allSessions
    .filter(s => s.title?.startsWith(forkPrefix))
    .map(s => {
      const num = s.title!.slice(forkPrefix.length)
      return parseInt(num, 10)
    })
    .filter(n => !isNaN(n))
  const nextNum = existingForkNums.length > 0 ? Math.max(...existingForkNums) + 1 : 1
  await renameSession(cwd, newId, `${baseTitle}_fork${nextNum}`)

  return newId
}

export async function cleanupExpiredSessions(
  cwd: string,
  maxAgeMs: number,
): Promise<number> {
  const dir = projectDir(cwd)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return 0
  }

  const now = Date.now()
  let removed = 0
  for (const name of entries.filter(e => e.endsWith('.jsonl'))) {
    const filePath = path.join(dir, name)
    const sessionId = name.slice(0, -'.jsonl'.length)
    try {
      const stats = await stat(filePath)
      if (now - stats.mtime.getTime() > maxAgeMs) {
        await unlink(filePath)
        await rm(sessionArtifactsDir(cwd, sessionId), { recursive: true, force: true })
        removed += 1
      }
    } catch {
      // skip
    }
  }

  // Clean up empty directory
  try {
    const remaining = await readdir(dir)
    if (remaining.length === 0) {
      await rm(dir, { recursive: true, force: true })
    }
  } catch {
    // ignore
  }

  return removed
}

export type ProjectMeta = {
  dir: string
  sessionCount: number
  latestUpdatedAt: number
}

export async function listAllProjects(): Promise<ProjectMeta[]> {
  let entries: string[]
  try {
    entries = await readdir(MINI_CODE_PROJECTS_DIR)
  } catch {
    return []
  }

  const results: ProjectMeta[] = []
  for (const name of entries) {
    const dirPath = path.join(MINI_CODE_PROJECTS_DIR, name)
    try {
      const stats = await stat(dirPath)
      if (!stats.isDirectory()) continue
      const files = await readdir(dirPath)
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))
      if (jsonlFiles.length === 0) continue

      let latestUpdatedAt = 0
      for (const f of jsonlFiles) {
        const fstats = await stat(path.join(dirPath, f))
        if (fstats.mtime.getTime() > latestUpdatedAt) {
          latestUpdatedAt = fstats.mtime.getTime()
        }
      }

      results.push({
        dir: name,
        sessionCount: jsonlFiles.length,
        latestUpdatedAt,
      })
    } catch {
      // skip
    }
  }

  results.sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt)
  return results
}

export type PersistedTranscriptEntry =
  | { kind: 'user' | 'assistant' | 'progress'; body: string }
  | { kind: 'tool'; body: string; toolName: string; status: 'running' | 'success' | 'error' }

export async function loadTranscript(
  cwd: string,
  sessionId: string,
): Promise<PersistedTranscriptEntry[] | null> {
  try {
    // Transcript shows full history (including pre-compact events), so we read
    // all lines rather than just the active post-boundary segment.
    const allLines = await readSessionLines(cwd, sessionId)
    if (!allLines) return null

    const entries: PersistedTranscriptEntry[] = []

    const events = reconstructSnippedEvents(
      allLines
        .map(line => parseEvent(line))
        .filter((event): event is SessionEvent => Boolean(event)),
    )

    for (const event of events) {

      const msg = (event.message ?? {}) as Record<string, unknown>

      switch (event.type) {
        case 'user':
          entries.push({ kind: 'user', body: typeof msg.content === 'string' ? msg.content : '' })
          break
        case 'assistant':
          entries.push({ kind: 'assistant', body: typeof msg.content === 'string' ? msg.content : '' })
          break
        case 'progress':
          entries.push({ kind: 'progress', body: typeof msg.content === 'string' ? msg.content : '' })
          break
        case 'tool_call':
          entries.push({
            kind: 'tool',
            toolName: typeof msg.toolName === 'string' ? msg.toolName : 'unknown',
            status: 'success',
            body: JSON.stringify(msg.input ?? ''),
          })
          break
        case 'summary':
          entries.push({
            kind: 'assistant',
            body: `[Context summary: ${msg.compressedCount ?? 0} messages compressed]`,
          })
          break
        case 'compact_boundary':
          entries.push({
            kind: 'assistant',
            body: `[Context compacted: ${event.compactMetadata?.preTokens ?? '?'} → ${event.compactMetadata?.postTokens ?? '?'} tokens]`,
          })
          break
        case 'snip_boundary':
          entries.push({
            kind: 'assistant',
            body: `[Snipped earlier context: removed ${event.snipMetadata?.removedCount ?? '?'} messages, freed ~${event.snipMetadata?.tokensFreed ?? '?'} tokens]`,
          })
          break
      }
    }

    return entries.length > 0 ? entries : null
  } catch {
    return null
  }
}

type ActiveSessionSnapshot = {
  messages: ChatMessage[] | null
  contextCollapseState: ContextCollapseState | null
}

async function readActiveSessionSnapshot(
  cwd: string,
  sessionId: string,
): Promise<ActiveSessionSnapshot | null> {
  const lines = await readSessionLines(cwd, sessionId)
  if (!lines) return null

  const activeEvents = activeEventsFromLines(lines)
  const messages: ChatMessage[] = []
  for (const event of reconstructSnippedEvents(activeEvents)) {
    const msg = unwrapMessage(event)
    if (msg) messages.push(msg)
  }

  const state = createContextCollapseState()
  for (const event of activeEvents) {
    if (event.type !== 'context_collapse' || !event.contextCollapseSpan) continue
    if (event.contextCollapseSpan.status !== 'committed') continue
    state.spans.push(event.contextCollapseSpan)
  }

  return {
    messages: messages.length > 0 ? messages : null,
    contextCollapseState: state.spans.length > 0 ? state : null,
  }
}
