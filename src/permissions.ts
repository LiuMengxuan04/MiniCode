import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MINI_CODE_DIR } from './config.js'
import { abortable, throwIfAborted } from './abort.js'
import { isEnoentError } from './utils/errors.js'

export type PermissionDecision =
  | 'allow_once'
  | 'allow_always'
  | 'allow_turn'
  | 'allow_all_turn'
  | 'deny_once'
  | 'deny_always'
  | 'deny_with_feedback'

export type PermissionChoice = {
  key: string
  label: string
  decision: PermissionDecision
}

export type PermissionPromptResult = {
  decision: PermissionDecision
  feedback?: string
}

type EnsureCommandOptions = {
  forcePromptReason?: string
}

export type PermissionRequest = {
  kind: 'path' | 'command' | 'edit'
  summary: string
  details: string[]
  scope: string
  choices: PermissionChoice[]
}

export type PermissionPromptHandler = (
  request: PermissionRequest,
  signal?: AbortSignal,
) => Promise<PermissionPromptResult>

type PermissionStore = {
  allowedDirectoryPrefixes?: string[]
  deniedDirectoryPrefixes?: string[]
  allowedCommandPatterns?: string[]
  deniedCommandPatterns?: string[]
  allowedEditPatterns?: string[]
  deniedEditPatterns?: string[]
}

type PathIntent = 'read' | 'write' | 'list' | 'search' | 'command_cwd'

const PERMISSIONS_PATH = path.join(MINI_CODE_DIR, 'permissions.json')

function normalizePath(targetPath: string): string {
  return path.resolve(targetPath)
}

function isWithinDirectory(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  )
}

function matchesDirectoryPrefix(
  targetPath: string,
  directories: Iterable<string>,
): boolean {
  for (const directory of directories) {
    if (isWithinDirectory(directory, targetPath)) {
      return true
    }
  }

  return false
}

function formatCommandSignature(command: string, args: string[]): string {
  return [command, ...args].join(' ').trim()
}

function classifyDangerousCommand(command: string, args: string[]): string | null {
  const normalizedArgs = args.map(arg => arg.trim()).filter(Boolean)
  const signature = formatCommandSignature(command, normalizedArgs)

  if (command === 'git') {
    if (normalizedArgs.includes('reset') && normalizedArgs.includes('--hard')) {
      return `git reset --hard can discard local changes (${signature})`
    }

    if (normalizedArgs.includes('clean')) {
      return `git clean can delete untracked files (${signature})`
    }

    if (
      normalizedArgs.includes('checkout') &&
      normalizedArgs.includes('--')
    ) {
      return `git checkout -- can overwrite working tree files (${signature})`
    }

    if (
      normalizedArgs.includes('restore') &&
      normalizedArgs.some(arg => arg.startsWith('--source'))
    ) {
      return `git restore --source can overwrite local files (${signature})`
    }

    if (
      normalizedArgs.includes('push') &&
      normalizedArgs.some(arg => arg === '--force' || arg === '-f')
    ) {
      return `git push --force rewrites remote history (${signature})`
    }
  }

  if (command === 'npm' && normalizedArgs.includes('publish')) {
    return `npm publish affects a registry outside this machine (${signature})`
  }

  if (
    command === 'node' ||
    command === 'python3' ||
    command === 'bun' ||
    command === 'bash' ||
    command === 'sh'
  ) {
    return `${command} can execute arbitrary local code (${signature})`
  }

  return null
}

async function readPermissionStore(): Promise<PermissionStore> {
  try {
    const content = await readFile(PERMISSIONS_PATH, 'utf8')
    return JSON.parse(content) as PermissionStore
  } catch (error) {
    if (isEnoentError(error)) {
      return {}
    }

    throw error
  }
}

async function writePermissionStore(store: PermissionStore): Promise<void> {
  await mkdir(MINI_CODE_DIR, { recursive: true })
  await writeFile(PERMISSIONS_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

export class PermissionManager {
  private readonly allowedDirectoryPrefixes = new Set<string>()
  private readonly deniedDirectoryPrefixes = new Set<string>()
  private readonly sessionAllowedPaths = new Set<string>()
  private readonly sessionDeniedPaths = new Set<string>()
  private readonly allowedCommandPatterns = new Set<string>()
  private readonly deniedCommandPatterns = new Set<string>()
  private readonly sessionAllowedCommands = new Set<string>()
  private readonly sessionDeniedCommands = new Set<string>()
  private readonly allowedEditPatterns = new Set<string>()
  private readonly deniedEditPatterns = new Set<string>()
  private readonly sessionDeniedEdits = new Set<string>()
  private readonly turnAllowedEdits = new Set<string>()
  private turnAllowAllEdits = false
  private ready: Promise<void>
  private signal?: AbortSignal

  constructor(
    private readonly workspaceRoot: string,
    private readonly prompt?: PermissionPromptHandler,
  ) {
    this.ready = this.initialize()
  }

  private async initialize(): Promise<void> {
    const store = await readPermissionStore()

    for (const directory of store.allowedDirectoryPrefixes ?? []) {
      this.allowedDirectoryPrefixes.add(normalizePath(directory))
    }

    for (const directory of store.deniedDirectoryPrefixes ?? []) {
      this.deniedDirectoryPrefixes.add(normalizePath(directory))
    }

    for (const pattern of store.allowedCommandPatterns ?? []) {
      this.allowedCommandPatterns.add(pattern)
    }

    for (const pattern of store.deniedCommandPatterns ?? []) {
      this.deniedCommandPatterns.add(pattern)
    }

    for (const pattern of store.allowedEditPatterns ?? []) {
      this.allowedEditPatterns.add(normalizePath(pattern))
    }

    for (const pattern of store.deniedEditPatterns ?? []) {
      this.deniedEditPatterns.add(normalizePath(pattern))
    }
  }

  async whenReady(): Promise<void> {
    await this.ready
    throwIfAborted(this.signal)
  }

  beginTurn(signal?: AbortSignal): void {
    this.signal = signal
    this.turnAllowedEdits.clear()
    this.turnAllowAllEdits = false
  }

  endTurn(): void {
    this.signal = undefined
    this.turnAllowedEdits.clear()
    this.turnAllowAllEdits = false
  }

  getSummary(): string[] {
    const summary = [`cwd: ${this.workspaceRoot}`]

    if (this.allowedDirectoryPrefixes.size > 0) {
      summary.push(
        `extra allowed dirs: ${[...this.allowedDirectoryPrefixes].slice(0, 4).join(', ')}`,
      )
    } else {
      summary.push('extra allowed dirs: none')
    }

    if (this.allowedCommandPatterns.size > 0) {
      summary.push(
        `dangerous allowlist: ${[...this.allowedCommandPatterns].slice(0, 4).join(', ')}`,
      )
    } else {
      summary.push('dangerous allowlist: none')
    }

    if (this.allowedEditPatterns.size > 0) {
      summary.push(
        `trusted edit targets: ${[...this.allowedEditPatterns].slice(0, 2).join(', ')}`,
      )
    }

    return summary
  }

  private async requestApproval(request: PermissionRequest): Promise<PermissionPromptResult> {
    const signal = this.signal
    throwIfAborted(signal)
    const result = await abortable(this.prompt!(request, signal), signal)
    throwIfAborted(signal)
    return result
  }

  private async persist(): Promise<void> {
    await writePermissionStore({
      allowedDirectoryPrefixes: [...this.allowedDirectoryPrefixes],
      deniedDirectoryPrefixes: [...this.deniedDirectoryPrefixes],
      allowedCommandPatterns: [...this.allowedCommandPatterns],
      deniedCommandPatterns: [...this.deniedCommandPatterns],
      allowedEditPatterns: [...this.allowedEditPatterns],
      deniedEditPatterns: [...this.deniedEditPatterns],
    })
  }

  async ensurePathAccess(targetPath: string, intent: PathIntent): Promise<void> {
    await this.ready
    throwIfAborted(this.signal)

    const normalizedTarget = normalizePath(targetPath)
    if (isWithinDirectory(this.workspaceRoot, normalizedTarget)) {
      return
    }

    if (
      this.sessionDeniedPaths.has(normalizedTarget) ||
      matchesDirectoryPrefix(normalizedTarget, this.deniedDirectoryPrefixes)
    ) {
      throw new Error(`Access denied for path outside cwd: ${normalizedTarget}`)
    }

    if (
      this.sessionAllowedPaths.has(normalizedTarget) ||
      matchesDirectoryPrefix(normalizedTarget, this.allowedDirectoryPrefixes)
    ) {
      return
    }

    if (!this.prompt) {
      throw new Error(
        `Path ${normalizedTarget} is outside cwd ${this.workspaceRoot}. Start minicode in TTY mode to approve it.`,
      )
    }

    const scopeDirectory =
      intent === 'list' || intent === 'command_cwd'
        ? normalizedTarget
        : path.dirname(normalizedTarget)

    const promptResult = await this.requestApproval({
      kind: 'path',
      summary: `mini-code wants ${intent.replace('_', ' ')} access outside the current cwd`,
      details: [
        `cwd: ${this.workspaceRoot}`,
        `target: ${normalizedTarget}`,
        `scope directory: ${scopeDirectory}`,
      ],
      scope: scopeDirectory,
      choices: [
        { key: 'y', label: 'allow once', decision: 'allow_once' },
        { key: 'a', label: 'allow this directory', decision: 'allow_always' },
        { key: 'n', label: 'deny once', decision: 'deny_once' },
        { key: 'd', label: 'deny this directory', decision: 'deny_always' },
      ],
    })

    if (promptResult.decision === 'allow_once') {
      this.sessionAllowedPaths.add(normalizedTarget)
      return
    }

    if (promptResult.decision === 'allow_always') {
      this.allowedDirectoryPrefixes.add(scopeDirectory)
      await this.persist()
      throwIfAborted(this.signal)
      return
    }

    if (promptResult.decision === 'deny_always') {
      this.deniedDirectoryPrefixes.add(scopeDirectory)
      await this.persist()
    } else {
      this.sessionDeniedPaths.add(normalizedTarget)
    }

    throw new Error(`Access denied for path outside cwd: ${normalizedTarget}`)
  }

  async ensureCommand(
    command: string,
    args: string[],
    commandCwd: string,
    options?: EnsureCommandOptions,
  ): Promise<void> {
    await this.ready
    throwIfAborted(this.signal)

    await this.ensurePathAccess(commandCwd, 'command_cwd')

    const dangerousReason = classifyDangerousCommand(command, args)
    const reason = options?.forcePromptReason?.trim() || dangerousReason
    if (!reason) {
      return
    }

    const signature = formatCommandSignature(command, args)
    if (
      this.sessionDeniedCommands.has(signature) ||
      this.deniedCommandPatterns.has(signature)
    ) {
      throw new Error(`Command denied: ${signature}`)
    }

    if (
      this.sessionAllowedCommands.has(signature) ||
      this.allowedCommandPatterns.has(signature)
    ) {
      return
    }

    if (!this.prompt) {
      throw new Error(
        `Command requires approval: ${signature}. Start minicode in TTY mode to approve it.`,
      )
    }

    const promptResult = await this.requestApproval({
      kind: 'command',
      summary: options?.forcePromptReason
        ? 'mini-code wants approval for this command'
        : 'mini-code wants to run a dangerous command',
      details: [
        `cwd: ${commandCwd}`,
        `command: ${signature}`,
        `reason: ${reason}`,
      ],
      scope: signature,
      choices: [
        { key: 'y', label: 'allow once', decision: 'allow_once' },
        { key: 'a', label: 'always allow this command', decision: 'allow_always' },
        { key: 'n', label: 'deny once', decision: 'deny_once' },
        { key: 'd', label: 'always deny this command', decision: 'deny_always' },
      ],
    })

    if (promptResult.decision === 'allow_once') {
      this.sessionAllowedCommands.add(signature)
      return
    }

    if (promptResult.decision === 'allow_always') {
      this.allowedCommandPatterns.add(signature)
      await this.persist()
      throwIfAborted(this.signal)
      return
    }

    if (promptResult.decision === 'deny_always') {
      this.deniedCommandPatterns.add(signature)
      await this.persist()
    } else {
      this.sessionDeniedCommands.add(signature)
    }

    throw new Error(`Command denied: ${signature}`)
  }

  async ensureEdit(targetPath: string, diffPreview: string): Promise<void> {
    await this.ready
    throwIfAborted(this.signal)

    const normalizedTarget = normalizePath(targetPath)

    if (
      this.sessionDeniedEdits.has(normalizedTarget) ||
      this.deniedEditPatterns.has(normalizedTarget)
    ) {
      throw new Error(`Edit denied: ${normalizedTarget}`)
    }

    if (
      this.turnAllowedEdits.has(normalizedTarget) ||
      this.turnAllowAllEdits ||
      this.allowedEditPatterns.has(normalizedTarget)
    ) {
      return
    }

    if (!this.prompt) {
      throw new Error(
        `Edit requires approval: ${normalizedTarget}. Start minicode in TTY mode to review it.`,
      )
    }

    const promptResult = await this.requestApproval({
      kind: 'edit',
      summary: 'mini-code wants to apply a file modification',
      details: [
        `target: ${normalizedTarget}`,
        '',
        diffPreview,
      ],
      scope: normalizedTarget,
      choices: [
        { key: '1', label: 'apply once', decision: 'allow_once' },
        { key: '2', label: 'allow this file in this turn', decision: 'allow_turn' },
        { key: '3', label: 'allow all edits in this turn', decision: 'allow_all_turn' },
        { key: '4', label: 'always allow this file', decision: 'allow_always' },
        { key: '5', label: 'reject once', decision: 'deny_once' },
        { key: '6', label: 'reject and send guidance to model', decision: 'deny_with_feedback' },
        { key: '7', label: 'always reject this file', decision: 'deny_always' },
      ],
    })

    if (promptResult.decision === 'allow_once') {
      return
    }

    if (promptResult.decision === 'allow_turn') {
      this.turnAllowedEdits.add(normalizedTarget)
      return
    }

    if (promptResult.decision === 'allow_all_turn') {
      this.turnAllowAllEdits = true
      return
    }

    if (promptResult.decision === 'allow_always') {
      this.allowedEditPatterns.add(normalizedTarget)
      await this.persist()
      throwIfAborted(this.signal)
      return
    }

    if (promptResult.decision === 'deny_with_feedback') {
      const guidance = promptResult.feedback?.trim()
      if (guidance) {
        throw new Error(
          `Edit denied: ${normalizedTarget}\nUser guidance: ${guidance}`,
        )
      }
      this.sessionDeniedEdits.add(normalizedTarget)
      throw new Error(`Edit denied: ${normalizedTarget}`)
    }

    if (promptResult.decision === 'deny_always') {
      this.deniedEditPatterns.add(normalizedTarget)
      await this.persist()
    }

    throw new Error(`Edit denied: ${normalizedTarget}`)
  }
}

export function getPermissionsPath(): string {
  return PERMISSIONS_PATH
}
