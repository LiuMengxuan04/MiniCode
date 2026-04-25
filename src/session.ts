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
import type { ChatMessage } from './types.js'

const MAX_TITLE_LENGTH = 60

type EventType = 'system' | 'user' | 'assistant' | 'progress' | 'tool_call' | 'tool_result' | 'summary' | 'compact_boundary' | 'rename'

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
  title?: string
}

function projectDirName(cwd: string): string {
  return cwd.replace(/[/\\:]+/g, '-').replace(/^-+/, '')
}

function projectDir(cwd: string): string {
  return path.join(MINI_CODE_PROJECTS_DIR, projectDirName(cwd))
}

function sessionFilePath(cwd: string, sessionId: string): string {
  return path.join(projectDir(cwd), `${sessionId}.jsonl`)
}

function roleToType(role: string): EventType {
  switch (role) {
    case 'system': return 'system'
    case 'user': return 'user'
    case 'assistant': return 'assistant'
    case 'assistant_progress': return 'progress'
    case 'assistant_tool_call': return 'tool_call'
    case 'tool_result': return 'tool_result'
    case 'context_summary': return 'summary'
    default: return 'user'
  }
}

function wrapEvent(message: ChatMessage, sessionId: string, cwd: string, parentUuid: string | null): string {
  const event: SessionEvent = {
    type: roleToType(message.role),
    message,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId,
    cwd,
    parentUuid,
  }
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
  if (event.message) return event.message as ChatMessage
  return null
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

export async function saveSession(
  cwd: string,
  sessionId: string,
  messages: ChatMessage[],
  alreadySavedCount: number = 0,
): Promise<void> {
  const toSave = messages.slice(1).slice(alreadySavedCount)
  if (toSave.length === 0) return

  const dir = projectDir(cwd)
  const filePath = sessionFilePath(cwd, sessionId)
  await mkdir(dir, { recursive: true })

  let parentUuid = await readLastEventUuid(filePath)
  const lines: string[] = []
  for (const m of toSave) {
    const line = wrapEvent(m, sessionId, cwd, parentUuid)
    const parsed = JSON.parse(line) as SessionEvent
    parentUuid = parsed.uuid
    lines.push(line)
  }
  await appendFile(filePath, lines.join('\n') + '\n', 'utf8')
}

export async function appendCompactBoundary(
  cwd: string,
  sessionId: string,
  summaryText: string,
  trigger: 'auto' | 'manual',
  preTokens: number,
  postTokens: number,
): Promise<void> {
  const dir = projectDir(cwd)
  const filePath = sessionFilePath(cwd, sessionId)
  await mkdir(dir, { recursive: true })

  const lastUuid = await readLastEventUuid(filePath)
  const now = new Date().toISOString()

  const boundary: SessionEvent = {
    type: 'compact_boundary',
    subtype: 'compact_boundary',
    uuid: randomUUID(),
    timestamp: now,
    sessionId,
    cwd,
    parentUuid: null,
    logicalParentUuid: lastUuid,
    compactMetadata: { trigger, preTokens, postTokens },
  }

  const summary: SessionEvent = {
    type: 'user',
    message: { role: 'user', content: summaryText },
    uuid: randomUUID(),
    timestamp: now,
    sessionId,
    cwd,
    parentUuid: boundary.uuid,
  }

  await appendFile(filePath, JSON.stringify(boundary) + '\n' + JSON.stringify(summary) + '\n', 'utf8')
}

export async function loadSession(
  cwd: string,
  sessionId: string,
): Promise<ChatMessage[] | null> {
  try {
    const content = await readFile(sessionFilePath(cwd, sessionId), 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)

    // Find last compact_boundary
    let lastBoundaryIndex = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      const event = parseEvent(lines[i]!)
      if (event?.type === 'compact_boundary') {
        lastBoundaryIndex = i
        break
      }
    }

    const startLine = lastBoundaryIndex >= 0 ? lastBoundaryIndex + 1 : 0
    const messages: ChatMessage[] = []
    for (let i = startLine; i < lines.length; i++) {
      const event = parseEvent(lines[i]!)
      if (!event) continue
      const msg = unwrapMessage(event)
      if (msg) messages.push(msg)
    }

    return messages.length > 0 ? messages : null
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
  await mkdir(projectDir(cwd), { recursive: true })
  await appendFile(sessionFilePath(cwd, sessionId), event + '\n', 'utf8')
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
    try {
      const stats = await stat(filePath)
      if (now - stats.mtime.getTime() > maxAgeMs) {
        await unlink(filePath)
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
    const content = await readFile(sessionFilePath(cwd, sessionId), 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    const entries: PersistedTranscriptEntry[] = []

    for (const line of lines) {
      const event = parseEvent(line)
      if (!event) continue

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
      }
    }

    return entries.length > 0 ? entries : null
  } catch {
    return null
  }
}
