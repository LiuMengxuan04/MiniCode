import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { MINI_CODE_DIR } from './config.js'

export type ContextFile = {
  path: string
  content: string
}

export type MemoryFileInfo = ContextFile & {
  scope: 'global' | 'project' | 'rules'
  lineCount: number
  charCount: number
  preview: string
}

const MAX_PER_FILE_CHARS = 8_000
const MAX_TOTAL_CHARS = 20_000

const CANDIDATES_PER_DIR = [
  'MINI.md',
  'MINI.local.md',
  path.join('.mini-code', 'MINI.md'),
  'CLAUDE.md',
  'CLAUDE.local.md',
  path.join('.claude', 'CLAUDE.md'),
]

const INCLUDE_LINE_RE = /^@([^\s]+)\s*$/

function contentHash(text: string): string {
  const normalized = text.trim()
  return createHash('sha256').update(normalized).digest('hex')
}

function truncateTo(text: string, limit: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  return trimmed.slice(0, limit) + '\n\n[truncated]'
}

async function tryRead(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, 'utf8')
    return content.trim() ? content : null
  } catch {
    return null
  }
}

async function discoverRuleFiles(rulesDir: string): Promise<string[]> {
  try {
    const entries = await readdir(rulesDir, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => path.join(rulesDir, entry.name))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

function isUnsafeIncludePath(includePath: string): boolean {
  if (!includePath || path.isAbsolute(includePath)) return true
  const parts = includePath.split(/[\\/]+/)
  return parts.some(part => part === '..')
}

async function resolveIncludes(
  content: string,
  fromFile: string,
  visited: Set<string>,
): Promise<string> {
  const fromDir = path.dirname(fromFile)
  const lines = content.split('\n')
  const rendered: string[] = []

  for (const line of lines) {
    const match = line.trim().match(INCLUDE_LINE_RE)
    if (!match) {
      rendered.push(line)
      continue
    }

    const includeRef = match[1]
    if (isUnsafeIncludePath(includeRef)) {
      rendered.push(`<!-- include skipped: unsafe path ${includeRef} -->`)
      continue
    }

    const includePath = path.resolve(fromDir, includeRef)
    if (visited.has(includePath)) {
      rendered.push(`<!-- include skipped: cycle detected ${includeRef} -->`)
      continue
    }

    const included = await tryRead(includePath)
    if (!included) {
      rendered.push(`<!-- include skipped: not found ${includeRef} -->`)
      continue
    }

    visited.add(includePath)
    const resolved = await resolveIncludes(included, includePath, visited)
    visited.delete(includePath)
    rendered.push(
      `<!-- included from ${includeRef} -->`,
      resolved,
      `<!-- end include ${includeRef} -->`,
    )
  }

  return rendered.join('\n')
}

function dedupe(files: ContextFile[]): ContextFile[] {
  const result: ContextFile[] = []
  const seen = new Set<string>()
  // Walk in reverse so later (cwd) entries win
  for (let i = files.length - 1; i >= 0; i--) {
    const hash = contentHash(files[i].content)
    if (seen.has(hash)) continue
    seen.add(hash)
    result.unshift(files[i])
  }
  return result
}

export async function discoverInstructionFiles(
  cwd: string,
  homeDir?: string,
  scanRoot?: string,
): Promise<ContextFile[]> {
  // Collect ancestor directories from root → cwd
  const dirs: string[] = []
  let cursor: string | undefined = cwd
  const resolvedScanRoot = scanRoot ? path.resolve(scanRoot) : undefined
  while (cursor) {
    dirs.push(cursor)
    if (resolvedScanRoot && path.resolve(cursor) === resolvedScanRoot) break
    cursor = path.dirname(cursor)
    if (cursor === dirs[dirs.length - 1]) break // reached root
  }
  dirs.reverse()

  const files: ContextFile[] = []

  // User global first
  const home = homeDir ?? MINI_CODE_DIR
  const globalCandidates = [
    path.join(home, 'MINI.md'),
    path.join(home, 'CLAUDE.md'),
  ]
  for (const candidate of globalCandidates) {
    const content = await tryRead(candidate)
    if (content) {
      files.push({ path: candidate, content: await resolveIncludes(content, candidate, new Set([candidate])) })
      break // only one global file
    }
  }

  for (const rulePath of await discoverRuleFiles(path.join(home, 'rules'))) {
    const content = await tryRead(rulePath)
    if (content) {
      files.push({ path: rulePath, content: await resolveIncludes(content, rulePath, new Set([rulePath])) })
    }
  }

  // Then each ancestor directory
  for (const dir of dirs) {
    for (const name of CANDIDATES_PER_DIR) {
      const filePath = path.join(dir, name)
      const content = await tryRead(filePath)
      if (content) {
        files.push({ path: filePath, content: await resolveIncludes(content, filePath, new Set([filePath])) })
      }
    }

    for (const rulePath of await discoverRuleFiles(path.join(dir, '.mini-code', 'rules'))) {
      const content = await tryRead(rulePath)
      if (content) {
        files.push({ path: rulePath, content: await resolveIncludes(content, rulePath, new Set([rulePath])) })
      }
    }
  }

  return dedupe(files)
}

export function describeMemoryFiles(files: ContextFile[], cwd = process.cwd()): MemoryFileInfo[] {
  return files.map(file => {
    const normalized = file.path.split(path.sep).join('/')
    const scope = normalized.includes('/rules/')
      ? 'rules'
      : path.resolve(file.path).startsWith(path.resolve(MINI_CODE_DIR))
        ? 'global'
        : 'project'
    const trimmed = file.content.trim()
    return {
      ...file,
      path: path.isAbsolute(file.path) ? path.relative(cwd, file.path) || file.path : file.path,
      scope,
      lineCount: trimmed ? trimmed.split('\n').length : 0,
      charCount: file.content.length,
      preview: trimmed.split('\n')[0] || '<empty>',
    }
  })
}

export function renderMemoryReport(files: ContextFile[], cwd = process.cwd()): string {
  if (files.length === 0) return 'No memory files loaded.'

  const infos = describeMemoryFiles(files, cwd)
  return [
    `Memory files loaded: ${infos.length}`,
    '',
    ...infos.map((file, index) => [
      `${index + 1}. ${file.path}`,
      `   scope: ${file.scope}`,
      `   lines: ${file.lineCount}`,
      `   chars: ${file.charCount}`,
      `   preview: ${file.preview}`,
    ].join('\n')),
  ].join('\n\n')
}

function renderScope(filePath: string): string {
  const base = path.basename(filePath)
  const dir = path.dirname(filePath)
  return `${base} (scope: ${dir})`
}

export async function loadMemory(cwd: string, homeDir?: string, scanRoot?: string): Promise<string> {
  const files = await discoverInstructionFiles(cwd, homeDir, scanRoot)
  if (files.length === 0) return ''

  const sections: string[] = ['# Instructions']
  let remaining = MAX_TOTAL_CHARS

  for (const file of files) {
    if (remaining <= 0) {
      sections.push('_Additional instruction content omitted after reaching the prompt budget._')
      break
    }

    const truncated = truncateTo(file.content, Math.min(MAX_PER_FILE_CHARS, remaining))
    sections.push(`## ${renderScope(file.path)}\n\n${truncated}`)
    remaining -= truncated.length
  }

  return sections.join('\n\n')
}
