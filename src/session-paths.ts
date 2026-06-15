import path from 'node:path'
import { MINI_CODE_PROJECTS_DIR } from './config.js'

export const SESSION_FILE_EXTENSION = '.jsonl'
export const TOOL_RESULTS_SUBDIR = 'tool-results'

/**
 * Sanitizes a single path segment so it is safe to use as a file/directory name.
 *
 * - Replaces any character outside `[a-zA-Z0-9._-]` with an underscore.
 * - Normalizes leading dots (hidden-file prefix / relative traversal) to underscores.
 * - Falls back to `fallback` when the result would be empty.
 */
export function sanitizePathSegment(value: string, fallback = 'session'): string {
  const trimmed = value.trim()
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_')
  const normalized = sanitized.replace(/^\.+/, match => '_'.repeat(match.length))
  return normalized.length > 0 ? normalized : fallback
}

/**
 * Throws if `filePath` is not contained within `rootDir`.
 * Used as a defense-in-depth check after all sanitization has been applied.
 */
function assertPathContained(filePath: string, rootDir: string): void {
  const relative = path.relative(rootDir, filePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `[session-paths] Path escapes expected root.\n  root: ${rootDir}\n  path: ${filePath}`,
    )
  }
}

function sessionPathSegment(sessionId: string): string {
  return sanitizePathSegment(sessionId, 'session')
}

export function projectDirName(cwd: string): string {
  return cwd.replace(/[/\\:]+/g, '-').replace(/^-+/, '')
}

export function projectDir(cwd: string): string {
  return path.join(MINI_CODE_PROJECTS_DIR, projectDirName(cwd))
}

export function sessionFilePath(cwd: string, sessionId: string): string {
  return path.join(projectDir(cwd), `${sessionPathSegment(sessionId)}${SESSION_FILE_EXTENSION}`)
}

/**
 * Returns the artifact directory for a session.
 *
 * Layout under MINI_CODE_PROJECTS_DIR:
 *   <project-dir>/          ← one directory per unique CWD (projectDirName)
 *     <session-id>.jsonl    ← session event log
 *     <session-id>/         ← sessionArtifactsDir: per-session artefacts
 *       tool-results/       ← sessionToolResultsDir: persisted large tool outputs
 *         <tool-use-id>.txt ← individual result file (string output)
 *         <tool-use-id>.json← individual result file (structured / block output)
 */
export function sessionArtifactsDir(cwd: string, sessionId: string): string {
  return path.join(projectDir(cwd), sessionPathSegment(sessionId))
}

export function sessionToolResultsDir(cwd: string, sessionId: string): string {
  return path.join(sessionArtifactsDir(cwd, sessionId), TOOL_RESULTS_SUBDIR)
}

/**
 * Returns the file path for persisting a single tool result.
 *
 * @param ext - `'txt'` for plain-string outputs (default), `'json'` for
 *              structured content-block arrays.
 *
 * The path is always contained within `sessionToolResultsDir`.  An assertion
 * is raised if sanitization somehow fails to prevent escape (defense-in-depth).
 */
export function sessionToolResultPath(
  cwd: string,
  sessionId: string,
  toolUseId: string,
  ext: 'txt' | 'json' = 'txt',
): string {
  const dir = sessionToolResultsDir(cwd, sessionId)
  const filename = `${sanitizePathSegment(toolUseId, 'tool-result')}.${ext}`
  const filePath = path.join(dir, filename)
  assertPathContained(filePath, dir)
  return filePath
}
