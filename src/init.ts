import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { isEnoentError } from './utils/errors.js'

export type InitStatus = 'created' | 'updated' | 'skipped'

export type InitArtifact = {
  name: string
  status: InitStatus
}

export type InitReport = {
  projectRoot: string
  artifacts: InitArtifact[]
}

type RepoDetection = {
  typescript: boolean
  packageJson: boolean
  python: boolean
  rustWorkspace: boolean
  rustRoot: boolean
  react: boolean
  nextjs: boolean
  vite: boolean
  nest: boolean
  srcDir: boolean
  testsDir: boolean
  rustDir: boolean
}

const GITIGNORE_COMMENT = '# MiniCode local artifacts'
const GITIGNORE_ENTRIES = ['.mini-code/settings.local.json', '.mini-code/sessions/']

function detectRepo(cwd: string): RepoDetection {
  const pkgJson = (() => {
    try {
      return readFileSync(path.join(cwd, 'package.json'), 'utf8').toLowerCase()
    } catch {
      return ''
    }
  })()

  return {
    rustWorkspace: existsSync(path.join(cwd, 'rust', 'Cargo.toml')),
    rustRoot: existsSync(path.join(cwd, 'Cargo.toml')),
    python:
      existsSync(path.join(cwd, 'pyproject.toml')) ||
      existsSync(path.join(cwd, 'requirements.txt')) ||
      existsSync(path.join(cwd, 'setup.py')),
    packageJson: existsSync(path.join(cwd, 'package.json')),
    typescript:
      existsSync(path.join(cwd, 'tsconfig.json')) || pkgJson.includes('typescript'),
    nextjs: pkgJson.includes('"next"'),
    react: pkgJson.includes('"react"'),
    vite: pkgJson.includes('"vite"'),
    nest: pkgJson.includes('@nestjs'),
    srcDir: existsSync(path.join(cwd, 'src')),
    testsDir: existsSync(path.join(cwd, 'tests')),
    rustDir: existsSync(path.join(cwd, 'rust')),
  }
}

function detectedLanguages(d: RepoDetection): string[] {
  const langs: string[] = []
  if (d.rustWorkspace || d.rustRoot) langs.push('Rust')
  if (d.python) langs.push('Python')
  if (d.typescript) langs.push('TypeScript')
  else if (d.packageJson) langs.push('JavaScript/Node.js')
  return langs
}

function detectedFrameworks(d: RepoDetection): string[] {
  const frameworks: string[] = []
  if (d.nextjs) frameworks.push('Next.js')
  if (d.react) frameworks.push('React')
  if (d.vite) frameworks.push('Vite')
  if (d.nest) frameworks.push('NestJS')
  return frameworks
}

function verificationLines(cwd: string, d: RepoDetection): string[] {
  const lines: string[] = []
  if (d.rustWorkspace) {
    lines.push(
      '- Run Rust verification from `rust/`: `cargo fmt`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`',
    )
  } else if (d.rustRoot) {
    lines.push(
      '- Run Rust verification: `cargo fmt`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`',
    )
  }
  if (d.python) {
    if (existsSync(path.join(cwd, 'pyproject.toml'))) {
      lines.push(
        '- Run Python checks from `pyproject.toml` (e.g. `pytest`, `ruff check`, `mypy` when configured).',
      )
    } else {
      lines.push('- Run the repo\'s Python test/lint commands before shipping changes.')
    }
  }
  if (d.packageJson) {
    lines.push(
      '- Run the JS/TS checks from `package.json` before shipping changes (`npm test`, `npm run lint`, `npm run build`).',
    )
  }
  if (d.testsDir && d.srcDir) {
    lines.push(
      '- `src/` and `tests/` are both present; update both surfaces together when behavior changes.',
    )
  }
  return lines
}

function repositoryShapeLines(d: RepoDetection): string[] {
  const lines: string[] = []
  if (d.rustDir) {
    lines.push('- `rust/` contains the Rust workspace and active CLI/runtime implementation.')
  }
  if (d.srcDir) {
    lines.push(
      '- `src/` contains source files that should stay consistent with generated guidance and tests.',
    )
  }
  if (d.testsDir) {
    lines.push(
      '- `tests/` contains validation surfaces that should be reviewed alongside code changes.',
    )
  }
  return lines
}

function frameworkNotes(d: RepoDetection): string[] {
  const lines: string[] = []
  if (d.nextjs) {
    lines.push(
      '- Next.js detected: preserve routing/data-fetching conventions and verify production builds after changing app structure.',
    )
  }
  if (d.react && !d.nextjs) {
    lines.push(
      '- React detected: keep component behavior covered with focused tests and avoid unnecessary prop/API churn.',
    )
  }
  if (d.vite) {
    lines.push(
      '- Vite detected: validate the production bundle after changing build-sensitive configuration or imports.',
    )
  }
  if (d.nest) {
    lines.push(
      '- NestJS detected: keep module/provider boundaries explicit and verify controller/service wiring after refactors.',
    )
  }
  return lines
}

export function renderInitMiniMd(cwd: string): string {
  const detection = detectRepo(cwd)
  const sections: string[][] = []

  // Header
  sections.push([
    '# MINI.md',
    '',
    'This file provides guidance to MiniCode when working with code in this repository.',
    '',
  ])

  // Detected stack
  const langs = detectedLanguages(detection)
  const frameworks = detectedFrameworks(detection)
  sections.push(['## Detected stack'])
  if (langs.length === 0) {
    sections[1].push(
      '- No specific language markers were detected yet; document the primary language and verification commands once the project structure settles.',
    )
  } else {
    sections[1].push(`- Languages: ${langs.join(', ')}.`)
  }
  if (frameworks.length === 0) {
    sections[1].push(
      '- Frameworks: none detected from the supported starter markers.',
    )
  } else {
    sections[1].push(`- Frameworks/tooling: ${frameworks.join(', ')}.`)
  }
  sections[1].push('')

  // Verification
  const verifyLines = verificationLines(cwd, detection)
  if (verifyLines.length > 0) {
    sections.push(['## Verification', ...verifyLines, ''])
  }

  // Repository shape
  const shapeLines = repositoryShapeLines(detection)
  if (shapeLines.length > 0) {
    sections.push(['## Repository shape', ...shapeLines, ''])
  }

  // Framework notes
  const fwNotes = frameworkNotes(detection)
  if (fwNotes.length > 0) {
    sections.push(['## Framework notes', ...fwNotes, ''])
  }

  // Working agreement
  sections.push([
    '## Working agreement',
    '- Prefer small, reviewable changes and keep generated bootstrap files aligned with actual repo workflows.',
    '- Keep shared defaults in `~/.mini-code/settings.json`; reserve `.mini-code/settings.local.json` for project-local overrides.',
    '- Do not overwrite existing `MINI.md` content automatically; update it intentionally when repo workflows change.',
    '',
  ])

  return sections.map(s => s.join('\n')).join('\n')
}

async function ensureDir(dirPath: string): Promise<InitStatus> {
  try {
    const existing = await stat(dirPath)
    if (!existing.isDirectory()) {
      throw new Error(`Cannot initialize: ${dirPath} exists and is not a directory`)
    }
    return 'skipped'
  } catch (error) {
    if (!isEnoentError(error)) throw error
  }

  try {
    await mkdir(dirPath, { recursive: true })
    return 'created'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const existing = await stat(dirPath)
      if (existing.isDirectory()) return 'skipped'
    }
    throw error
  }
}

async function writeFileIfMissing(
  filePath: string,
  content: string,
): Promise<InitStatus> {
  try {
    await writeFile(filePath, content, { flag: 'wx' })
    return 'created'
  } catch (error) {
    if (isEnoentError(error)) {
      // Parent directory missing — create it and retry
      await mkdir(path.dirname(filePath), { recursive: true })
      try {
        await writeFile(filePath, content, { flag: 'wx' })
        return 'created'
      } catch (retryError) {
        if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') return 'skipped'
        throw retryError
      }
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'skipped'
    throw error
  }
}

async function ensureGitignoreEntries(
  gitignorePath: string,
): Promise<InitStatus> {
  let existing: string
  try {
    existing = await readFile(gitignorePath, 'utf8')
  } catch {
    // Create new .gitignore
    const lines = [GITIGNORE_COMMENT, ...GITIGNORE_ENTRIES]
    await writeFile(gitignorePath, `${lines.join('\n')}\n`, { flag: 'wx' })
    return 'created'
  }

  const currentLines = existing.split('\n').map(l => l.trimEnd())
  let changed = false

  if (!currentLines.some(l => l === GITIGNORE_COMMENT)) {
    currentLines.push(GITIGNORE_COMMENT)
    changed = true
  }

  for (const entry of GITIGNORE_ENTRIES) {
    if (!currentLines.some(l => l === entry)) {
      currentLines.push(entry)
      changed = true
    }
  }

  if (!changed) return 'skipped'

  await writeFile(gitignorePath, `${currentLines.join('\n')}\n`)
  return 'updated'
}

export async function initializeRepo(cwd: string): Promise<InitReport> {
  const artifacts: InitArtifact[] = []

  const miniCodeDir = path.join(cwd, '.mini-code')
  artifacts.push({
    name: '.mini-code/',
    status: await ensureDir(miniCodeDir),
  })

  const gitignorePath = path.join(cwd, '.gitignore')
  artifacts.push({
    name: '.gitignore',
    status: await ensureGitignoreEntries(gitignorePath),
  })

  const miniMdPath = path.join(cwd, 'MINI.md')
  const content = renderInitMiniMd(cwd)
  artifacts.push({
    name: 'MINI.md',
    status: await writeFileIfMissing(miniMdPath, content),
  })

  return { projectRoot: cwd, artifacts }
}

export function renderInitReport(report: InitReport): string {
  const lines = [
    'Init',
    `  Project          ${report.projectRoot}`,
    ...report.artifacts.map(a => {
      const label =
        a.status === 'created'
          ? 'created'
          : a.status === 'updated'
            ? 'updated'
            : 'skipped (already exists)'
      return `  ${a.name.padEnd(16)} ${label}`
    }),
    '  Next step        Review and tailor the generated guidance',
  ]
  return lines.join('\n')
}
