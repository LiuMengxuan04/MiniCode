import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { MINI_CODE_DIR, MINI_CODE_HISTORY_PATH } from './config.js'

type HistoryEntry = {
  display: string
  timestamp: number
  project: string
  sessionId: string
}

const MAX_ENTRIES = 500

export async function loadHistoryEntries(): Promise<string[]> {
  try {
    const raw = await readFile(MINI_CODE_HISTORY_PATH, 'utf8')
    const lines = raw.trim().split('\n').filter(Boolean)
    const entries: string[] = []
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as HistoryEntry
        if (typeof entry.display === 'string') {
          entries.push(entry.display)
        }
      } catch {
        // skip malformed lines
      }
    }
    return entries
  } catch {
    return []
  }
}

export async function saveHistoryEntries(
  entries: string[],
  cwd: string,
  sessionId: string,
): Promise<void> {
  await mkdir(MINI_CODE_DIR, { recursive: true })

  const existing = await loadHistoryEntries()
  // Find which entries are new
  const existingSet = new Set(existing)
  const newEntries = entries.filter(e => !existingSet.has(e))

  if (newEntries.length === 0) return

  const now = Date.now()
  const lines = newEntries.map(display =>
    JSON.stringify({ display, timestamp: now, project: cwd, sessionId }),
  )

  await appendFile(MINI_CODE_HISTORY_PATH, lines.join('\n') + '\n', 'utf8')

  // Trim to MAX_ENTRIES if needed
  try {
    const raw = await readFile(MINI_CODE_HISTORY_PATH, 'utf8')
    const allLines = raw.trim().split('\n').filter(Boolean)
    if (allLines.length > MAX_ENTRIES) {
      const { writeFile } = await import('node:fs/promises')
      const kept = allLines.slice(-MAX_ENTRIES)
      await writeFile(
        MINI_CODE_HISTORY_PATH,
        kept.join('\n') + '\n',
        'utf8',
      )
    }
  } catch {
    // ignore trim errors
  }
}
