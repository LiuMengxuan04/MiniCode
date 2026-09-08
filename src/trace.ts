import { appendFile, mkdir } from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import { MINI_CODE_DIR, loadEffectiveSettings } from './config.js'
import type { AgentTraceEvent } from './types.js'

const TRACE_SCHEMA_VERSION = 1

export type TraceStatus = {
  enabled: boolean
  filePath?: string
  error?: string
}

export type TraceScope = {
  sessionId?: string
  agentId?: string
}

export type TraceRecorder = {
  record(event: AgentTraceEvent, scope?: TraceScope): void
  flush(): Promise<void>
  status(): TraceStatus
}

function parseBooleanFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false
    default:
      return undefined
  }
}

export async function resolveTraceEnabled(): Promise<boolean> {
  const settings = await loadEffectiveSettings()
  return (
    parseBooleanFlag(process.env.MINI_CODE_TRACE) ??
    parseBooleanFlag(settings.trace) ??
    false
  )
}

function projectDirName(cwd: string): string {
  return cwd.replace(/[/\\:]+/g, '-').replace(/^-+/, '') || 'root'
}

export async function createTraceRecorder(options: {
  cwd: string
  enabled?: boolean
  traceRoot?: string
  launchId?: string
  now?: () => Date
}): Promise<TraceRecorder> {
  let configurationError: string | undefined
  let enabled = options.enabled
  if (enabled === undefined) {
    try {
      enabled = await resolveTraceEnabled()
    } catch (error) {
      enabled = false
      configurationError = error instanceof Error ? error.message : String(error)
    }
  }
  if (!enabled) {
    return {
      record() {},
      async flush() {},
      status: () => ({ enabled: false, error: configurationError }),
    }
  }

  const now = options.now ?? (() => new Date())
  const launchId = options.launchId ?? crypto.randomUUID()
  const traceDir = path.join(
    options.traceRoot ?? path.join(MINI_CODE_DIR, 'traces'),
    projectDirName(options.cwd),
  )
  const timestamp = now().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(
    traceDir,
    `${timestamp}-${launchId.slice(0, 8)}.jsonl`,
  )
  let sequence = 0
  let writeError: string | undefined
  let pending: Promise<void> = mkdir(traceDir, { recursive: true }).then(() => {})

  const recorder: TraceRecorder = {
    record(event, scope = {}) {
      if (writeError) return
      const entry = {
        schemaVersion: TRACE_SCHEMA_VERSION,
        launchId,
        sequence: sequence++,
        ...scope,
        ...event,
      }
      pending = pending
        .then(() => appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8'))
        .then(() => undefined)
        .catch(error => {
          writeError = error instanceof Error ? error.message : String(error)
        })
    },
    async flush() {
      await pending
    },
    status() {
      return {
        enabled: true,
        filePath,
        error: writeError,
      }
    },
  }

  recorder.record({
    type: 'trace_started',
    timestamp: now().toISOString(),
    cwd: options.cwd,
    pid: process.pid,
  })
  return recorder
}
