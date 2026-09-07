import crypto from 'node:crypto'
import process from 'node:process'
import { listBackgroundTasks } from './background-tasks.js'
import { SessionRuntime } from './runtime/session-runtime.js'
import type { TurnRequest } from './runtime/turn-runner.js'
import { throwIfAborted } from './abort.js'
import { runAgentTurnWithOutcome } from './agent-loop.js'
import {
  SLASH_COMMANDS,
  findMatchingSlashCommands,
  tryHandleLocalCommand,
} from './cli-commands.js'
import { loadHistoryEntries, saveHistoryEntries } from './history.js'
import { parseLocalToolShortcut } from './local-tool-shortcuts.js'
import { summarizeMcpServers } from './mcp-status.js'
import {
  PermissionManager,
  PermissionPromptResult,
  PermissionRequest,
} from './permissions.js'
import { buildSystemPrompt } from './prompt.js'
import type { PlanManager } from './plan/manager.js'
import { formatPlan } from './plan/context.js'
import { discoverInstructionFiles } from './memory.js'
import {
  saveSession,
  loadSession,
  clearSession,
  listSessions,
  renameSession,
  appendCompactBoundary,
  appendSnipBoundary,
  appendContextCollapseSpan,
  loadTranscript,
  loadContextCollapseState,
  forkSession,
  cleanupExpiredSessions,
  listAllProjects,
} from './session.js'
import type { SessionMeta, ProjectMeta } from './session.js'
import { spawn } from 'node:child_process'
import { parseInputChunk, type ParsedInputEvent } from './tui/input-parser.js'
import {
  enterAlternateScreen,
  exitAlternateScreen,
  getPermissionPromptMaxScrollOffset,
  hideCursor,
  renderBanner,
  renderFooterBar,
  renderInputPrompt,
  renderPanel,
  renderPermissionPrompt,
  renderPermissionSummaryLine,
  renderSlashMenu,
  renderStatusLine,
  renderTerminalFrame,
  renderToolPanel,
  renderTranscript,
  getTranscriptMaxScrollOffset,
  showCursor,
  extractSelectedText,
  renderTranscriptLines,
  getTranscriptWindowSize,
  type TranscriptEntry,
  type TranscriptSelection,
} from './ui.js'
import type { RuntimeConfig } from './config.js'
import type { ToolRegistry } from './tool.js'
import type { ChatMessage, CompressionResult, ModelAdapter, AgentTurnResult } from './types.js'
import type { ContextStats } from './utils/token-estimator.js'
import type { SubAgentManager } from './agents/manager.js'
import { computeContextStats } from './utils/token-estimator.js'
import { manualCompact } from './compact/manual-compact.js'
import { snipCompactConversation } from './compact/snipCompact.js'
import {
  applyContextCollapseIfNeeded,
  createContextCollapseState,
  type ContextCollapseResult,
  type ContextCollapseState,
} from './compact/context-collapse.js'
import {
  createContentReplacementState,
  type ContentReplacementState,
} from './utils/tool-result-storage.js'

type TtyAppArgs = {
  runtime: RuntimeConfig | null
  tools: ToolRegistry
  model: ModelAdapter
  subAgents: SubAgentManager
  plan: PlanManager
  messages: ChatMessage[]
  cwd: string
  permissions: PermissionManager
  contentReplacementState?: ContentReplacementState
  contextCollapseState?: ContextCollapseState
  sessionId: string
  alreadySavedCount: number
  resumeTarget?: string | 'picker'
  execution?: SessionRuntime
}

type PendingApproval = {
  request: PermissionRequest
  resolve: (result: PermissionPromptResult) => void
  detailsExpanded: boolean
  detailsScrollOffset: number
  selectedChoiceIndex: number
  feedbackMode: boolean
  feedbackInput: string
}

type SessionPicker = {
  sessions: SessionMeta[]
  selectedIndex: number
  resolve: (sessionId: string | null) => void
  deleteConfirmIndex: number | null
  allProjects: boolean
  projects: ProjectMeta[]
  projectSelectedIndex: number
}

type WelcomeAnimationMode = 'chew' | 'escape' | 'done'

type WelcomeAnimation = {
  entryId: number
  mode: WelcomeAnimationMode
  frameIndex: number
}

type ScreenState = {
  input: string
  cursorOffset: number
  transcript: TranscriptEntry[]
  transcriptScrollOffset: number
  selectedSlashIndex: number
  status: string | null
  activeTool: string | null
  recentTools: Array<{ name: string; status: 'success' | 'error' }>
  history: string[]
  historyIndex: number
  historyDraft: string
  nextEntryId: number
  pendingApproval: PendingApproval | null
  sessionPicker: SessionPicker | null
  isBusy: boolean
  contextStats: ContextStats | null
  compressionStatus: string | null
  statusAnimationFrame: number
  inputHintFrame: number
  thinkingStartedAt: number | null
  selection: TranscriptSelection | null
  mouseDown: { x: number; y: number } | null
  transcriptBodyStartY: number
  transcriptBodyLines: number
  welcomeAnimation: WelcomeAnimation | null
}

type TranscriptEntryDraft =
  | Omit<Extract<TranscriptEntry, { kind: 'user' }>, 'id'>
  | Omit<Extract<TranscriptEntry, { kind: 'assistant' }>, 'id'>
  | Omit<Extract<TranscriptEntry, { kind: 'progress' }>, 'id'>
  | Omit<Extract<TranscriptEntry, { kind: 'tool' }>, 'id'>

export const WELCOME_CHEW_FRAMES = [
  String.raw`       (\__/)     
       (='.'=)    
       / >[cheese]`,
  String.raw`       (\__/)     
       (=-.-=)    
       / >[cheese]`,
  String.raw`       (\__/)     
       (='o'=)    
       / >>[heese]`,
  String.raw`       (\__/)    
       (='3'=) . 
       / >>[eese]`,
  String.raw`       (\__/)   
       (='o'=) .
       / >>[ese]`,
  String.raw`       (\__/)   
       (='3'=) *
       / >>[se] `,
  String.raw`       (\__/)   
       (='o'=) *
       / >>[e]  `,
  String.raw`       (\__/)   
       (=^.^=) *
       / >>[]   `,
  String.raw`       (\__/)   
       (=^.^=) *
       / >[]    `,
]

export const WELCOME_ESCAPE_FRAMES = [
  String.raw`       (\__/)   
       (='o'=) !
       / >[]    `,
  String.raw`       (\__/)    
       (='O'=) !!
       / \[]/    `,
  String.raw`       (\__/)  
      \(='O'=)/
        /  \   `,
  String.raw`       (\__/) 
       (='o'=)
      _/    \_`,
  String.raw`        \__/  
       (='o'=)
      _/    \_`,
  String.raw`        \_/   
       (='o'=)
      _/    \_`,
  String.raw`         _   
       _/ \_ 
      (_   _)`,
  String.raw`            
       _..-'
      '---. `,
  String.raw`        ... 
       .   .
            `,
  String.raw`         .  
            
            `,
  String.raw`            
            
            `,
]

const WELCOME_MESSAGE = 'Welcome back!~'

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function keepSelectionAfterMouseRelease(
  selection: TranscriptSelection | null,
): TranscriptSelection | null {
  return selection
}

function getSessionStats(args: TtyAppArgs, state: ScreenState) {
  const mcpStatus = summarizeMcpServers(args.tools.getMcpServers())
  return {
    transcriptCount: state.transcript.length,
    messageCount: args.messages.length,
    skillCount: args.tools.getSkills().length,
    mcpTotalCount: mcpStatus.total,
    mcpConnectedCount: mcpStatus.connected,
    mcpConnectingCount: mcpStatus.connecting,
    mcpErrorCount: mcpStatus.error,
    contextStats: state.contextStats,
  }
}

function renderHeaderPanel(args: TtyAppArgs, state: ScreenState): string {
  return renderBanner(
    args.runtime,
    args.cwd,
    args.permissions.getSummary(),
    getSessionStats(args, state),
  )
}

function renderPromptPanel(state: ScreenState): string {
  const commands = getVisibleCommands(state.input)
  const promptBody = [
    renderInputPrompt(state.input, state.cursorOffset, state.inputHintFrame),
    commands.length > 0
      ? `\n${renderSlashMenu(
          commands,
          Math.min(state.selectedSlashIndex, commands.length - 1),
        )}`
      : '',
  ].join('')
  return renderPanel('prompt', promptBody, { showTitle: false })
}

function renderPermissionSummary(args: TtyAppArgs, state: ScreenState): string {
  return renderPermissionSummaryLine(
    args.permissions.getSummary(),
    state.inputHintFrame,
  )
}

function setStatus(state: ScreenState, status: string | null): void {
  state.status = status
  if (status === 'Thinking...') {
    state.thinkingStartedAt ??= Date.now()
  } else {
    state.thinkingStartedAt = null
  }
}

function renderFooterStatus(state: ScreenState): string {
  if (state.status === 'Thinking...') {
    const startedAt = state.thinkingStartedAt ?? Date.now()
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    return `\u001b[33m\u001b[1mThinking(${seconds}s)\u001b[0m`
  }
  return renderStatusLine(state.status, state.statusAnimationFrame)
}

function getTranscriptBodyLines(args: TtyAppArgs, state: ScreenState): number {
  const rows = Math.max(24, process.stdout.rows ?? 40)
  const headerLines = renderHeaderPanel(args, state).split('\n').length
  const permissionSummaryLines = renderPermissionSummary(args, state).split('\n').length
  const promptLines = renderPromptPanel(state).split('\n').length
  const footerLines = 1
  const gapsBetweenSections = 2
  const transcriptPanelFrameLines = 0
  const remaining =
    rows -
    headerLines -
    permissionSummaryLines -
    promptLines -
    footerLines -
    gapsBetweenSections -
    transcriptPanelFrameLines

  return Math.max(6, remaining)
}

function getMaxTranscriptScrollOffset(args: TtyAppArgs, state: ScreenState): number {
  return getTranscriptMaxScrollOffset(
    state.transcript,
    getTranscriptBodyLines(args, state),
  )
}

function screenToAbsoluteLineIndex(
  _args: TtyAppArgs,
  state: ScreenState,
  screenY: number,
): number {
  const bodyStartY = state.transcriptBodyStartY
  const bodyY = screenY - bodyStartY
  if (bodyY < 0) return -1

  const lines = renderTranscriptLines(state.transcript)
  const pageSize = getTranscriptWindowSize(state.transcriptBodyLines)
  const maxOffset = Math.max(0, lines.length - pageSize)
  const offset = Math.max(0, Math.min(state.transcriptScrollOffset, maxOffset))
  const end = lines.length - offset
  const start = Math.max(0, end - pageSize)

  const lineIndex = start + bodyY
  if (lineIndex < 0) return -1
  if (lines.length === 0) return -1
  return Math.min(lineIndex, lines.length - 1)
}

export function encodeClipboardTextForPlatform(
  platform: NodeJS.Platform,
  text: string,
): string | Buffer {
  if (platform === 'win32') {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  }
  return text
}

function copyToClipboard(text: string): void {
  try {
    const platform = process.platform
    const proc =
      platform === 'win32'
        ? spawn('clip', { stdio: ['pipe', 'inherit', 'inherit'] })
        : platform === 'darwin'
          ? spawn('pbcopy', { stdio: ['pipe', 'inherit', 'inherit'] })
          : spawn('xclip', ['-selection', 'clipboard'], {
              stdio: ['pipe', 'inherit', 'inherit'],
            })
    const payload = encodeClipboardTextForPlatform(platform, text)
    proc.stdin?.write(payload)
    proc.stdin?.end()
  } catch {
    // Silently fail if clipboard is unavailable
  }
}

function scrollTranscriptBy(
  args: TtyAppArgs,
  state: ScreenState,
  delta: number,
): boolean {
  const nextOffset = Math.max(
    0,
    Math.min(
      getMaxTranscriptScrollOffset(args, state),
      state.transcriptScrollOffset + delta,
    ),
  )

  if (nextOffset === state.transcriptScrollOffset) {
    return false
  }

  state.transcriptScrollOffset = nextOffset
  return true
}

function jumpTranscriptToEdge(
  args: TtyAppArgs,
  state: ScreenState,
  target: 'top' | 'bottom',
): boolean {
  const nextOffset =
    target === 'top' ? getMaxTranscriptScrollOffset(args, state) : 0
  if (nextOffset === state.transcriptScrollOffset) {
    return false
  }

  state.transcriptScrollOffset = nextOffset
  return true
}

function getPendingApprovalMaxScrollOffset(state: ScreenState): number {
  const pending = state.pendingApproval
  if (!pending) return 0
  return getPermissionPromptMaxScrollOffset(pending.request, {
    expanded: pending.detailsExpanded,
  })
}

function scrollPendingApprovalBy(state: ScreenState, delta: number): boolean {
  const pending = state.pendingApproval
  if (!pending || !pending.detailsExpanded) {
    return false
  }

  const maxOffset = getPendingApprovalMaxScrollOffset(state)
  const nextOffset = Math.max(
    0,
    Math.min(maxOffset, pending.detailsScrollOffset + delta),
  )
  if (nextOffset === pending.detailsScrollOffset) {
    return false
  }
  pending.detailsScrollOffset = nextOffset
  return true
}

function togglePendingApprovalExpand(state: ScreenState): boolean {
  const pending = state.pendingApproval
  if (!pending || pending.request.kind !== 'edit') {
    return false
  }
  pending.detailsExpanded = !pending.detailsExpanded
  pending.detailsScrollOffset = 0
  return true
}

function movePendingApprovalSelection(state: ScreenState, delta: number): boolean {
  const pending = state.pendingApproval
  if (!pending || pending.feedbackMode) {
    return false
  }
  const total = pending.request.choices.length
  if (total <= 0) return false
  pending.selectedChoiceIndex =
    (pending.selectedChoiceIndex + delta + total) % total
  return true
}

function historyUp(state: ScreenState): boolean {
  if (state.history.length === 0 || state.historyIndex <= 0) {
    return false
  }

  if (state.historyIndex === state.history.length) {
    state.historyDraft = state.input
  }

  state.historyIndex -= 1
  state.input = state.history[state.historyIndex] ?? ''
  state.cursorOffset = state.input.length
  return true
}

function historyDown(state: ScreenState): boolean {
  if (state.historyIndex >= state.history.length) {
    return false
  }

  state.historyIndex += 1
  state.input =
    state.historyIndex === state.history.length
      ? state.historyDraft
      : (state.history[state.historyIndex] ?? '')
  state.cursorOffset = state.input.length
  return true
}

function getVisibleCommands(input: string) {
  if (!input.startsWith('/')) return []
  if (input === '/') return SLASH_COMMANDS
  const matches = findMatchingSlashCommands(input)
  return SLASH_COMMANDS.filter(command => matches.includes(command.usage))
}

function pushTranscriptEntry(
  state: ScreenState,
  entry: TranscriptEntryDraft,
): number {
  const id = state.nextEntryId++
  state.transcript.push({ id, ...entry })
  return id
}

export function normalizeAsciiFrame(frame: string): string {
  const lines = frame.split('\n')
  const width = Math.max(...lines.map(line => line.length))
  return lines.map(line => line.padEnd(width, ' ')).join('\n')
}

export function renderWelcomeBody(frame: string): string {
  return `${WELCOME_MESSAGE}\n${normalizeAsciiFrame(frame)}`
}

function updateAssistantEntryBody(
  state: ScreenState,
  entryId: number,
  body: string,
): void {
  const entry = state.transcript.find(
    item => item.id === entryId && item.kind === 'assistant',
  )
  if (!entry || entry.kind !== 'assistant') {
    return
  }
  entry.body = body
}

export function pushWelcomeAnimation(state: ScreenState): void {
  const entryId = pushTranscriptEntry(state, {
    kind: 'assistant',
    body: renderWelcomeBody(WELCOME_CHEW_FRAMES[0] ?? ''),
  })
  state.welcomeAnimation = {
    entryId,
    mode: 'chew',
    frameIndex: 0,
  }
}

export function startWelcomeEscapeAnimation(state: ScreenState): boolean {
  const animation = state.welcomeAnimation
  if (!animation || animation.mode === 'escape' || animation.mode === 'done') {
    return false
  }

  animation.mode = 'escape'
  animation.frameIndex = 0
  updateAssistantEntryBody(
    state,
    animation.entryId,
    renderWelcomeBody(WELCOME_ESCAPE_FRAMES[0] ?? ''),
  )
  return true
}

export function advanceWelcomeAnimation(state: ScreenState): boolean {
  const animation = state.welcomeAnimation
  if (!animation || animation.mode === 'done' || state.transcriptScrollOffset > 0) {
    return false
  }

  const frames =
    animation.mode === 'escape' ? WELCOME_ESCAPE_FRAMES : WELCOME_CHEW_FRAMES
  if (frames.length === 0) {
    animation.mode = 'done'
    return false
  }

  if (animation.mode === 'chew') {
    animation.frameIndex = (animation.frameIndex + 1) % frames.length
  } else if (animation.frameIndex < frames.length - 1) {
    animation.frameIndex += 1
  } else {
    state.welcomeAnimation = null
    return false
  }

  updateAssistantEntryBody(
    state,
    animation.entryId,
    renderWelcomeBody(frames[animation.frameIndex] ?? frames[0] ?? ''),
  )
  return true
}

function updateToolEntry(
  state: ScreenState,
  entryId: number,
  status: 'running' | 'success' | 'error',
  body: string,
): void {
  const entry = state.transcript.find(
    item => item.id === entryId && item.kind === 'tool',
  )

  if (!entry || entry.kind !== 'tool') {
    return
  }

  entry.status = status
  entry.body = body
  entry.collapsed = false
  entry.collapsedSummary = undefined
  entry.collapsePhase = undefined
}

function collapseToolEntry(
  state: ScreenState,
  entryId: number,
  summary: string,
): void {
  const entry = state.transcript.find(
    item => item.id === entryId && item.kind === 'tool',
  )
  if (!entry || entry.kind !== 'tool' || entry.status === 'running') {
    return
  }
  entry.collapsePhase = undefined
  entry.collapsed = true
  entry.collapsedSummary = summary
}

function getRunningToolEntries(state: ScreenState): Array<Extract<TranscriptEntry, { kind: 'tool' }>> {
  return state.transcript.filter(
    (entry): entry is Extract<TranscriptEntry, { kind: 'tool' }> =>
      entry.kind === 'tool' && entry.status === 'running',
  )
}

function finalizeDanglingRunningTools(state: ScreenState): void {
  const runningEntries = getRunningToolEntries(state)
  for (const entry of runningEntries) {
    entry.status = 'error'
    entry.body = `${entry.body}\n\nERROR: Tool did not report a final result before the turn ended. This usually means the command kept running in the background or the tool lifecycle got out of sync.`
    entry.collapsed = false
    entry.collapsedSummary = undefined
    entry.collapsePhase = undefined
    state.recentTools.push({
      name: entry.toolName,
      status: 'error',
    })
  }
  if (runningEntries.length > 0) {
    state.activeTool = null
    setStatus(state, `Previous turn ended with ${runningEntries.length} unfinished tool call(s).`)
  }
}

function summarizeCollapsedToolBody(output: string): string {
  const line = output
    .split('\n')
    .map(item => item.trim())
    .find(Boolean)
  if (!line) {
    return 'output collapsed'
  }
  if (line.length > 140) {
    return `${line.slice(0, 140)}...`
  }
  return line
}

function truncateForDisplay(text: string, max = 180): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

function summarizeToolInput(toolName: string, input: unknown): string {
  if (typeof input === 'string') {
    return truncateForDisplay(input.replace(/\s+/g, ' ').trim())
  }

  if (typeof input === 'object' && input !== null) {
    const maybePath = (input as { path?: unknown }).path
    const pathPart =
      typeof maybePath === 'string' && maybePath.trim()
        ? ` path=${maybePath}`
        : ''

    if (toolName === 'patch_file') {
      const count = Array.isArray((input as { replacements?: unknown }).replacements)
        ? (input as { replacements: unknown[] }).replacements.length
        : 0
      return `patch_file${pathPart} replacements=${count}`
    }

    if (toolName === 'edit_file') {
      return `edit_file${pathPart}`
    }

    if (toolName === 'read_file') {
      const offset = (input as { offset?: unknown }).offset
      const limit = (input as { limit?: unknown }).limit
      return `read_file${pathPart}${offset !== undefined ? ` offset=${String(offset)}` : ''}${limit !== undefined ? ` limit=${String(limit)}` : ''}`
    }

    if (toolName === 'run_command') {
      const command = (input as { command?: unknown }).command
      return `run_command${typeof command === 'string' ? ` ${truncateForDisplay(command, 120)}` : ''}`
    }
  }

  try {
    return truncateForDisplay(JSON.stringify(input))
  } catch {
    return truncateForDisplay(String(input))
  }
}

type AggregatedEditProgress = {
  entryId: number
  toolName: string
  path: string
  total: number
  completed: number
  errors: number
  lastOutput: string
}

function isFileEditTool(toolName: string): boolean {
  return (
    toolName === 'edit_file' ||
    toolName === 'patch_file' ||
    toolName === 'modify_file' ||
    toolName === 'write_file'
  )
}

function extractPathFromToolInput(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) {
    return null
  }
  if (!('path' in input)) {
    return null
  }
  const value = (input as { path?: unknown }).path
  return typeof value === 'string' && value.trim() ? value : null
}

function renderScreen(args: TtyAppArgs, state: ScreenState): void {
  const backgroundTasks = listBackgroundTasks()
  const frame: string[] = []
  const headerPanel = renderHeaderPanel(args, state)
  frame.push(headerPanel)
  frame.push('')
  state.transcriptBodyStartY = headerPanel.split('\n').length + 4
  state.transcriptBodyLines = getTranscriptBodyLines(args, state)

  if (state.pendingApproval) {
    frame.push(
      renderPanel('approval', renderPermissionPrompt(state.pendingApproval.request, {
        expanded: state.pendingApproval.detailsExpanded,
        scrollOffset: state.pendingApproval.detailsScrollOffset,
        selectedChoiceIndex: state.pendingApproval.selectedChoiceIndex,
        feedbackMode: state.pendingApproval.feedbackMode,
        feedbackInput: state.pendingApproval.feedbackInput,
      })),
    )
    frame.push('')
    frame.push(`Control: ${state.input || '/goal pause, /loop stop, or /exit'}`)
    frame.push(renderPanel('activity', renderToolPanel(state.activeTool, state.recentTools, backgroundTasks)))
    frame.push('')
    frame.push(
      renderFooterBar(
        state.status,
        true,
        args.tools.getSkills().length > 0,
        summarizeMcpServers(args.tools.getMcpServers()),
        backgroundTasks,
        state.compressionStatus,
        state.statusAnimationFrame,
        undefined,
        renderSubAgentFooter(args.subAgents),
      ),
    )
    renderTerminalFrame(frame.join('\n'))
    return
  }

  if (state.sessionPicker) {
    if (state.sessionPicker.allProjects) {
      const projects = state.sessionPicker.projects
      const lines = projects.map((p, i) => {
        const marker = i === state.sessionPicker!.projectSelectedIndex ? ' > ' : '   '
        const ago = formatRelativeTime(p.latestUpdatedAt)
        return `${marker}${p.dir}  ${p.sessionCount} sessions  ${ago}`
      })
      const body = `All projects:\n\n${lines.join('\n')}\n\nEnter to see info, Tab to go back, Esc to cancel`
      frame.push(renderPanel('projects', body))
    } else {
      const lines = state.sessionPicker.sessions.map((s, i) => {
        const marker = i === state.sessionPicker!.selectedIndex ? ' > ' : '   '
        const title = s.title ? `  ${s.title}` : ''
        const ago = formatRelativeTime(s.updatedAt)
        const deleteTag = state.sessionPicker!.deleteConfirmIndex === i ? '  [DELETE? Press d again to confirm]' : ''
        return `${marker}${s.id}${title}  ${s.messageCount} messages  ${ago}${deleteTag}`
      })
      const body = `Select a session to resume:\n\n${lines.join('\n')}\n\n↑/↓ to select, Enter to resume, d to delete, Tab for all projects, Esc to cancel`
      frame.push(renderPanel('sessions', body))
    }
    frame.push('')
    frame.push(
      renderFooterBar(
        state.status,
        true,
        args.tools.getSkills().length > 0,
        summarizeMcpServers(args.tools.getMcpServers()),
        backgroundTasks,
        state.compressionStatus,
        state.statusAnimationFrame,
        undefined,
        renderSubAgentFooter(args.subAgents),
      ),
    )
    renderTerminalFrame(frame.join('\n'))
    return
  }

  frame.push(
    renderPanel(
      'session feed',
      state.transcript.length > 0
        ? renderTranscript(
            state.transcript,
            state.transcriptScrollOffset,
            getTranscriptBodyLines(args, state),
            state.selection ?? undefined,
          )
        : '',
      {
        minBodyLines: getTranscriptBodyLines(args, state),
        frame: false,
      },
    ),
  )
  frame.push(renderPermissionSummary(args, state))
  frame.push(renderPromptPanel(state))
  frame.push(
    renderFooterBar(
      state.status,
      true,
      args.tools.getSkills().length > 0,
      summarizeMcpServers(args.tools.getMcpServers()),
      backgroundTasks,
      state.compressionStatus,
      state.statusAnimationFrame,
      renderFooterStatus(state),
      renderSubAgentFooter(args.subAgents),
    ),
  )
  renderTerminalFrame(frame.join('\n'))
}

function renderSubAgentFooter(manager: SubAgentManager): string | undefined {
  if (manager.runningCount === 0) return undefined
  return `\x1b[1m\x1b[35m● SUB-AGENTS ${manager.runningCount}/${manager.maxConcurrent} RUNNING\x1b[0m`
}

function createRenderScheduler(renderNow: () => void): () => void {
  let scheduled: NodeJS.Immediate | null = null

  return () => {
    if (scheduled) return

    scheduled = setImmediate(() => {
      scheduled = null
      renderNow()
    })
  }
}

async function refreshSystemPrompt(args: TtyAppArgs): Promise<void> {
  args.messages[0] = {
    role: 'system',
    content: await buildSystemPrompt(args.cwd, args.permissions.getSummary(), {
      skills: args.tools.getSkills(),
      mcpServers: args.tools.getMcpServers(),
      subAgents: { maxConcurrent: args.subAgents.maxConcurrent },
    }),
  }
}

function retainedMessagesAfterCompact(result: CompressionResult): ChatMessage[] {
  return result.messages.filter(message => (
    message.role !== 'system' && message !== result.summary
  ))
}

async function persistContextCollapseResult(
  args: TtyAppArgs,
  result: ContextCollapseResult,
): Promise<number> {
  const spans = result.spans.length > 0
    ? result.spans
    : result.span
      ? [result.span]
      : []

  for (const span of spans) {
    await appendContextCollapseSpan(args.cwd, args.sessionId, span)
  }

  return spans.reduce(
    (sum, span) => sum + Math.max(0, span.tokensBefore - span.tokensAfter),
    0,
  )
}

async function executeToolShortcut(
  args: TtyAppArgs,
  state: ScreenState,
  toolName: string,
  input: unknown,
  rerender: () => void,
): Promise<void> {
  state.isBusy = true
  setStatus(state, `Running ${toolName}...`)
  state.activeTool = toolName
  const entryId = pushTranscriptEntry(state, {
    kind: 'tool',
    toolName,
    status: 'running',
    body: summarizeToolInput(toolName, input),
  })
  rerender()

  try {
    const result = await args.tools.execute(toolName, input, {
      cwd: args.cwd,
      permissions: args.permissions,
    })

    state.recentTools.push({
      name: toolName,
      status: result.ok ? 'success' : 'error',
    })
    updateToolEntry(
      state,
      entryId,
      result.ok ? 'success' : 'error',
      result.ok ? result.output : `ERROR: ${result.output}`,
    )
    collapseToolEntry(
      state,
      entryId,
      summarizeCollapsedToolBody(
        result.ok ? result.output : `ERROR: ${result.output}`,
      ),
    )
    state.transcriptScrollOffset = 0
  } finally {
    state.isBusy = false
    state.activeTool = null
    finalizeDanglingRunningTools(state)
    if (getRunningToolEntries(state).length === 0) {
      setStatus(state, null)
    }
  }
}

async function resumeSession(
  args: TtyAppArgs,
  state: ScreenState,
  sessionId: string,
  loaded: ChatMessage[],
): Promise<void> {
  args.sessionId = sessionId
  args.plan.reset(sessionId)
  const systemContent =
    args.messages[0]?.role === 'system' ? args.messages[0].content : ''
  await refreshSystemPrompt(args)
  args.messages.length = 0
  args.messages.push({ role: 'system', content: systemContent })
  args.messages.push(...loaded)
  state.transcript = []
  const persistedTranscript = await loadTranscript(args.cwd, sessionId)
  if (persistedTranscript && persistedTranscript.length > 0) {
    for (const entry of persistedTranscript) {
      pushTranscriptEntry(state, entry)
    }
  } else {
    for (const msg of loaded) {
      if (msg.role === 'user' && !msg.internal) {
        pushTranscriptEntry(state, { kind: 'user', body: msg.content })
      } else if (msg.role === 'assistant') {
        pushTranscriptEntry(state, { kind: 'assistant', body: msg.content })
      } else if (msg.role === 'assistant_tool_call') {
        pushTranscriptEntry(state, {
          kind: 'tool',
          toolName: msg.toolName,
          status: 'success',
          body: summarizeToolInput(msg.toolName, msg.input),
        })
      } else if (msg.role === 'context_summary') {
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: `[Context summary: ${msg.compressedCount} messages compressed]`,
        })
      } else if (msg.role === 'snip_boundary') {
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: `Snipped earlier context: removed ${msg.removedCount} messages, freed ~${Math.round(msg.tokensFreed)} tokens.`,
        })
      }
    }
  }
  pushTranscriptEntry(state, {
    kind: 'assistant',
    body: `Session ${sessionId} resumed (${loaded.length} messages loaded).`,
  })
  args.alreadySavedCount = loaded.length
  args.contextCollapseState =
    await loadContextCollapseState(args.cwd, sessionId) ??
    createContextCollapseState()
  state.transcriptScrollOffset = 0
}

async function handleInput(
  args: TtyAppArgs,
  state: ScreenState,
  rerender: () => void,
  submittedRawInput?: string,
): Promise<boolean> {
  const input = (submittedRawInput ?? state.input).trim()
  if (!input) return false
  if (input === '/exit') {
    await args.execution!.stop()
    return true
  }
  if (input === '/plan') {
    pushTranscriptEntry(state, { kind: 'assistant', body: formatPlan(args.plan.getSnapshot()) })
    return false
  }
  const runtimeReply = await args.execution!.command(input)
  if (runtimeReply !== null) {
    pushTranscriptEntry(state, { kind: 'assistant', body: runtimeReply })
    rerender()
    return false
  }
  if (/^\/(new|resume|fork)(?:\s|$)/.test(input)) {
    await args.execution!.reset()
    // Retry saving before switching sessions; a failure leaves the current session intact.
    await saveSession(args.cwd, args.sessionId, args.messages, args.alreadySavedCount)
    args.alreadySavedCount = args.messages.length - 1
  }
  if (state.isBusy || args.execution!.turns.busy || args.execution!.goal.running || args.execution!.loop.running) {
    setStatus(state, 'Current turn is still running. Use /goal pause, /loop stop, or /exit.')
    return false
  }

  // /collapse: persistent model-visible projection; original transcript remains intact
  if (input === '/collapse') {
    const model = args.runtime?.model ?? ''
    if (!model) {
      pushTranscriptEntry(state, {
        kind: 'assistant',
        body: 'No model configured. Cannot collapse context.',
      })
      return false
    }

    state.isBusy = true
    setStatus(state, 'Collapsing context...')
    state.compressionStatus = 'collapsing...'
    rerender()
    try {
      const result = await applyContextCollapseIfNeeded(
        args.messages,
        model,
        args.model,
        args.contextCollapseState ?? createContextCollapseState(),
        {
          utilizationThreshold: 0,
          reason: 'manual',
        },
      )
      args.contextCollapseState = result.state
      state.contextStats = computeContextStats(result.messages, model)

      if (result.collapsed) {
        const savedTokens = await persistContextCollapseResult(args, result)
        const spanCount = result.spans.length
        state.compressionStatus = `collapse saved ~${Math.round(savedTokens)} tokens`
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: `Context collapse projected ${spanCount} span${spanCount === 1 ? '' : 's'} into model-visible summaries. Original transcript is preserved.`,
        })
      } else {
        state.compressionStatus = result.state.enabled ? 'nothing safe to collapse' : 'collapse disabled'
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: result.state.enabled
            ? 'Nothing safe to collapse.'
            : 'Context collapse is disabled after repeated summary failures.',
        })
      }
    } catch (error) {
      state.compressionStatus = null
      const message = error instanceof Error ? error.message : String(error)
      pushTranscriptEntry(state, {
        kind: 'assistant',
        body: `Context collapse failed: ${message}`,
      })
    } finally {
      state.isBusy = false
      setStatus(state, null)
      state.transcriptScrollOffset = 0
      setTimeout(() => {
        state.compressionStatus = null
        rerender()
      }, 5000)
    }
    return false
  }

  // /snip: deterministic middle-context removal without calling the model
  if (input === '/snip') {
    const model = args.runtime?.model ?? ''
    const stats = computeContextStats(args.messages, model)
    const result = await snipCompactConversation({
      messages: args.messages,
      contextStats: stats,
      modelContextWindow: stats.effectiveInput,
    })

    if (!result.didSnip || result.boundaryMessage?.role !== 'snip_boundary') {
      pushTranscriptEntry(state, {
        kind: 'assistant',
        body: 'Nothing safe to snip.',
      })
      return false
    }

    await appendSnipBoundary(args.cwd, args.sessionId, result.boundaryMessage)
    args.messages.length = 0
    args.messages.push(...result.messages)
    args.alreadySavedCount = 0
    args.contextCollapseState = createContextCollapseState()
    state.contextStats = computeContextStats(args.messages, model)
    state.compressionStatus = `snip saved ~${Math.round(result.tokensFreed)} tokens`
    state.transcriptScrollOffset = 0
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: `Snipped earlier context: removed ${result.removedMessageIds.length} messages, freed ~${Math.round(result.tokensFreed)} tokens.`,
    })
    setTimeout(() => {
      state.compressionStatus = null
      rerender()
    }, 5000)
    return false
  }

  // /compact: manual context compression
  if (input === '/compact') {
    if (args.messages.length <= 2) {
      pushTranscriptEntry(state, {
        kind: 'assistant',
        body: 'Not enough conversation to compress.',
      })
      return false
    }
    const model = args.runtime?.model ?? ''
    if (!model) {
      pushTranscriptEntry(state, {
        kind: 'assistant',
        body: 'No model configured. Cannot compress.',
      })
      return false
    }
    state.isBusy = true
    setStatus(state, 'Compressing context...')
    state.compressionStatus = 'compressing...'
    rerender()
    try {
      const result = await manualCompact(args.messages, args.model)
      if (result) {
        const summaryText = typeof result.summary.content === 'string' ? result.summary.content : ''
        await appendCompactBoundary(
          args.cwd,
          args.sessionId,
          summaryText,
          'manual',
          result.tokensBefore,
          result.tokensAfter,
          retainedMessagesAfterCompact(result),
        )
        args.messages.length = 0
        args.messages.push(...result.messages)
        args.alreadySavedCount = args.messages.length - 1
        args.contextCollapseState = createContextCollapseState()
        const savedPct = Math.round((1 - result.tokensAfter / result.tokensBefore) * 100)
        const savedTokens = result.tokensBefore - result.tokensAfter
        state.compressionStatus = `ctx -${savedPct}% (saved ${savedTokens >= 1000 ? `${Math.round(savedTokens / 1000)}K` : savedTokens} tokens)`
        state.contextStats = computeContextStats(args.messages, model)
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: `Context compressed: ${result.removedCount} messages summarized. ${savedPct}% reduction (${savedTokens >= 1000 ? `${Math.round(savedTokens / 1000)}K` : savedTokens} tokens saved).`,
        })
      } else {
        state.compressionStatus = 'compression failed'
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: 'Could not compress further. The conversation may already be minimal.',
        })
      }
    } catch (error) {
      state.compressionStatus = null
      const message = error instanceof Error ? error.message : String(error)
      pushTranscriptEntry(state, {
        kind: 'assistant',
        body: `Compression failed: ${message}`,
      })
    } finally {
      state.isBusy = false
      setStatus(state, null)
      state.transcriptScrollOffset = 0
      // Clear compression status after a delay (will be reset on next render cycle)
      setTimeout(() => {
        state.compressionStatus = null
        rerender()
      }, 5000)
    }
    return false
  }

  if (input.startsWith('/rename ')) {
    const newName = input.slice('/rename '.length).trim()
    if (!newName) {
      pushTranscriptEntry(state, {
        kind: 'assistant',
        body: 'Usage: /rename <name>',
      })
      return false
    }
    const ok = await renameSession(args.cwd, args.sessionId, newName)
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: ok ? `Session renamed to "${newName}".` : 'No active session to rename.',
    })
    return false
  }

  if (input === '/resume' || input.startsWith('/resume ')) {
    const sessionIdArg = input.startsWith('/resume ') ? input.slice('/resume '.length).trim() : ''

    if (!sessionIdArg) {
      const sessions = await listSessions(args.cwd)
      if (sessions.length === 0) {
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: 'No saved sessions for this project.',
        })
        return false
      }

      const selectedId = await new Promise<string | null>(resolve => {
        state.sessionPicker = {
          sessions,
          selectedIndex: 0,
          resolve,
          deleteConfirmIndex: null,
          allProjects: false,
          projects: [],
          projectSelectedIndex: 0,
        }
        setStatus(state, 'Select a session to resume')
        rerender()
      })

      state.sessionPicker = null
      setStatus(state, null)
      rerender()

      if (!selectedId) return false

      const loaded = await loadSession(args.cwd, selectedId)
      if (!loaded || loaded.length === 0) {
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: `Session ${selectedId} not found.`,
        })
        return false
      }
      await resumeSession(args, state, selectedId, loaded)
      return false
    }

    // Direct resume by id
    const loaded = await loadSession(args.cwd, sessionIdArg)
    if (!loaded || loaded.length === 0) {
      pushTranscriptEntry(state, {
        kind: 'assistant',
        body: `Session ${sessionIdArg} not found.`,
      })
      return false
    }
    await resumeSession(args, state, sessionIdArg, loaded)
    return false
  }

  if (input === '/new') {
    args.sessionId = crypto.randomUUID().slice(0, 8)
    args.plan.reset(args.sessionId)
    args.alreadySavedCount = 0
    args.contextCollapseState = createContextCollapseState()
    state.transcript = []
    args.messages.length = 0
    await refreshSystemPrompt(args)
    state.transcriptScrollOffset = 0
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: 'Session cleared. Starting fresh.',
    })
    return false
  }

  if (input === '/fork') {
    const newId = await forkSession(args.cwd, args.sessionId)
    if (!newId) {
      pushTranscriptEntry(state, {
        kind: 'assistant',
        body: 'No current session to fork.',
      })
      return false
    }
    args.sessionId = newId
    args.plan.reset(newId)
    args.alreadySavedCount = args.messages.length - 1
    args.contextCollapseState = createContextCollapseState()
    state.transcriptScrollOffset = 0
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: `Session forked. Now in session ${newId}. Original session preserved.`,
    })
    return false
  }

  if (state.history.at(-1) !== input) {
    state.history.push(input)
    await saveHistoryEntries(state.history, args.cwd, args.sessionId)
  }
  state.historyIndex = state.history.length
  state.historyDraft = ''

  if (input === '/tools') {
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: args.tools
        .list()
        .map(tool => `${tool.name}: ${tool.description}`)
        .join('\n'),
    })
    return false
  }

  const localCommandResult = await tryHandleLocalCommand(input, {
    cwd: args.cwd,
    tools: args.tools,
    plan: args.plan,
    permissionSummary: args.permissions.getSummary(),
  })
  if (localCommandResult !== null) {
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: localCommandResult,
    })
    return false
  }

  const toolShortcut = parseLocalToolShortcut(input)
  if (toolShortcut) {
    await executeToolShortcut(
      args,
      state,
      toolShortcut.toolName,
      toolShortcut.input,
      rerender,
    )
    return false
  }

  if (input.startsWith('/')) {
    const matches = findMatchingSlashCommands(input)
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body:
        matches.length > 0
          ? `未识别命令。你是不是想输入：\n${matches.join('\n')}`
          : '未识别命令。输入 /help 查看可用命令。',
    })
    return false
  }

  await args.execution!.submit(input)
  return false
}

async function executeTtyTurn(
  args: TtyAppArgs,
  state: ScreenState,
  rerender: () => void,
  request: TurnRequest,
): Promise<AgentTurnResult> {
  let result: AgentTurnResult = { messages: args.messages, outcome: 'failed', toolCalls: 0 }
  state.isBusy = true
  args.permissions.beginTurn(request.signal)
  try {
    await refreshSystemPrompt(args)
    throwIfAborted(request.signal)
    args.messages.push(request.input)
    pushTranscriptEntry(state, {
      kind: request.input.internal ? 'progress' : 'user',
      body: request.input.internal ? `${request.mode ?? 'Agent'} continuing...` : request.input.content,
    })
    state.transcriptScrollOffset = 0
    startWelcomeEscapeAnimation(state)
    setStatus(state, 'Thinking...')
    state.isBusy = true
    rerender()

    const pendingToolEntries = new Map<string, number[]>()
    const aggregatedEditByKey = new Map<string, AggregatedEditProgress>()
    const aggregatedEditByEntryId = new Map<number, AggregatedEditProgress>()
    const turnStartedAt = Date.now()

    result = await runAgentTurnWithOutcome({
      model: args.model,
      tools: args.execution!.toolsFor(request.mode),
      runtimeContext: () => args.execution!.contextFor(request.mode),
      maxSteps: request.mode ? 50 : undefined,
      stopOnFatalToolError: !!request.mode,
      signal: request.signal,
      plan: args.plan,
      messages: args.messages,
      cwd: args.cwd,
      permissions: args.permissions,
      modelName: args.runtime?.model ?? '',
      contentReplacementState: args.contentReplacementState,
      contextCollapseState: args.contextCollapseState,
      onContextStats(stats) {
        state.contextStats = stats
        rerender()
      },
      async onAutoCompact(result) {
        const savedPct = Math.round((1 - result.tokensAfter / result.tokensBefore) * 100)
        const savedTokens = result.tokensBefore - result.tokensAfter
        state.compressionStatus = `ctx -${savedPct}% (saved ${savedTokens >= 1000 ? `${Math.round(savedTokens / 1000)}K` : savedTokens} tokens)`
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: `Context auto-compressed: ${result.removedCount} messages summarized.`,
        })
        const summaryText = typeof result.summary.content === 'string' ? result.summary.content : ''
        await appendCompactBoundary(
          args.cwd,
          args.sessionId,
          summaryText,
          'auto',
          result.tokensBefore,
          result.tokensAfter,
          retainedMessagesAfterCompact(result),
        )
        args.alreadySavedCount = result.messages.length - 1
        state.transcriptScrollOffset = 0
        setTimeout(() => {
          state.compressionStatus = null
          rerender()
        }, 5000)
      },
      async onContextCollapse(result) {
        if (result.collapsed) {
          const savedTokens = await persistContextCollapseResult(args, result)
          state.compressionStatus = `collapse saved ~${Math.round(savedTokens)} tokens`
          rerender()
          setTimeout(() => {
            state.compressionStatus = null
            rerender()
          }, 5000)
        }
      },
      async onSnipCompact(result) {
        if (result.boundaryMessage?.role === 'snip_boundary') {
          await appendSnipBoundary(args.cwd, args.sessionId, result.boundaryMessage)
        }
        args.alreadySavedCount = 0
        state.compressionStatus = `snip saved ~${Math.round(result.tokensFreed)} tokens`
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: `Snipped earlier context: removed ${result.removedMessageIds.length} messages, freed ~${Math.round(result.tokensFreed)} tokens.`,
        })
        state.transcriptScrollOffset = 0
        setTimeout(() => {
          state.compressionStatus = null
          rerender()
        }, 5000)
      },
      onAssistantMessage(content, metadata) {
        const workedForSeconds = metadata?.final
          ? Math.max(0, Math.floor((Date.now() - turnStartedAt) / 1000))
          : undefined
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: content,
          ...(workedForSeconds === undefined ? {} : { workedForSeconds }),
        })
        state.transcriptScrollOffset = 0
        rerender()
      },
      onProgressMessage(content) {
        pushTranscriptEntry(state, {
          kind: 'progress',
          body: content,
        })
        state.transcriptScrollOffset = 0
        rerender()
      },
      onToolStart(toolName, toolInput) {
        setStatus(state, `Running ${toolName}...`)
        state.activeTool = toolName
        let entryId: number
        const targetPath = extractPathFromToolInput(toolInput)
        const canAggregate = isFileEditTool(toolName) && targetPath !== null

        if (canAggregate) {
          const key = `${toolName}:${targetPath}`
          const existing = aggregatedEditByKey.get(key)
          if (existing) {
            existing.total += 1
            existing.lastOutput = summarizeToolInput(toolName, toolInput)
            entryId = existing.entryId
            updateToolEntry(
              state,
              entryId,
              existing.errors > 0 ? 'error' : 'running',
              `Aggregated ${toolName} for ${targetPath}\nCompleted: ${existing.completed}/${existing.total}`,
            )
          } else {
            entryId = pushTranscriptEntry(state, {
              kind: 'tool',
              toolName,
              status: 'running',
              body: summarizeToolInput(toolName, toolInput),
            })
            const progress: AggregatedEditProgress = {
              entryId,
              toolName,
              path: targetPath,
              total: 1,
              completed: 0,
              errors: 0,
              lastOutput: summarizeToolInput(toolName, toolInput),
            }
            aggregatedEditByKey.set(key, progress)
            aggregatedEditByEntryId.set(entryId, progress)
          }
        } else {
          entryId = pushTranscriptEntry(state, {
            kind: 'tool',
            toolName,
            status: 'running',
            body: summarizeToolInput(toolName, toolInput),
          })
        }
        const pending = pendingToolEntries.get(toolName) ?? []
        pending.push(entryId)
        pendingToolEntries.set(toolName, pending)
        state.transcriptScrollOffset = 0
        rerender()
      },
      onToolResult(toolName, output, isError) {
        const pending = pendingToolEntries.get(toolName) ?? []
        const entryId = pending.shift()
        pendingToolEntries.set(toolName, pending)
        if (entryId !== undefined && toolName === 'update_plan' && !isError) {
          state.recentTools.push({ name: toolName, status: 'success' })
          updateToolEntry(state, entryId, 'success', formatPlan(args.plan.getSnapshot()))
        } else if (entryId !== undefined) {
          const aggregated = aggregatedEditByEntryId.get(entryId)
          if (aggregated && aggregated.toolName === toolName) {
            aggregated.completed += 1
            if (isError) {
              aggregated.errors += 1
            }
            aggregated.lastOutput = output
            const done = aggregated.completed >= aggregated.total
            if (done) {
              state.recentTools.push({
                name: `${toolName} x${aggregated.total}`,
                status: aggregated.errors > 0 ? 'error' : 'success',
              })
            }
            const aggregatedBody = done
              ? [
                  `Aggregated ${toolName} for ${aggregated.path}`,
                  `Operations: ${aggregated.total}, errors: ${aggregated.errors}`,
                  `Last result: ${aggregated.lastOutput}`,
                ].join('\n')
              : `Aggregated ${toolName} for ${aggregated.path}\nCompleted: ${aggregated.completed}/${aggregated.total}`
            updateToolEntry(
              state,
              entryId,
              aggregated.errors > 0 ? 'error' : done ? 'success' : 'running',
              aggregatedBody,
            )
            if (done) {
              collapseToolEntry(
                state,
                entryId,
                summarizeCollapsedToolBody(aggregatedBody),
              )
              aggregatedEditByEntryId.delete(entryId)
              aggregatedEditByKey.delete(`${toolName}:${aggregated.path}`)
            }
          } else {
            state.recentTools.push({
              name: toolName,
              status: isError ? 'error' : 'success',
            })
            updateToolEntry(
              state,
              entryId,
              isError ? 'error' : 'success',
              isError ? `ERROR: ${output}` : output,
            )
            collapseToolEntry(
              state,
              entryId,
              summarizeCollapsedToolBody(
                isError ? `ERROR: ${output}` : output,
              ),
            )
          }
        } else {
          state.recentTools.push({
            name: toolName,
            status: isError ? 'error' : 'success',
          })
        }
        state.activeTool = null
        setStatus(state, 'Thinking...')
        rerender()
      },
    })
    args.messages.splice(0, args.messages.length, ...result.messages)
    await saveSession(args.cwd, args.sessionId, args.messages, args.alreadySavedCount)
    args.alreadySavedCount = args.messages.length - 1
    if (result.error) pushTranscriptEntry(state, { kind: 'assistant', body: result.error })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result = { ...result, messages: args.messages, outcome: 'failed', error: message }
    args.messages.push({
      role: 'assistant',
      content: `请求失败: ${message}`,
    })
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: `请求失败: ${message}`,
    })
    state.transcriptScrollOffset = 0
  } finally {
    args.permissions.endTurn()
    state.isBusy = false
  }

  finalizeDanglingRunningTools(state)
  if (getRunningToolEntries(state).length === 0) {
    setStatus(state, null)
  }
  rerender()
  return result
}

function createPermissionPromptHandler(
  state: ScreenState,
  rerender: () => void,
): (request: PermissionRequest, signal?: AbortSignal) => Promise<PermissionPromptResult> {
  return (request, signal) => new Promise((resolve, reject) => {
    const cancel = () => {
      if (state.pendingApproval === pending) state.pendingApproval = null
      signal?.removeEventListener('abort', cancel)
      reject(signal?.reason ?? new Error('Approval cancelled.'))
      rerender()
    }
    const pending: PendingApproval = {
      request,
      resolve(result) {
        signal?.removeEventListener('abort', cancel)
        if (signal?.aborted) reject(signal.reason)
        else resolve(result)
      },
      detailsExpanded: false, detailsScrollOffset: 0, selectedChoiceIndex: 0,
      feedbackMode: false, feedbackInput: '',
    }
    state.pendingApproval = pending
    if (signal?.aborted) cancel()
    else signal?.addEventListener('abort', cancel, { once: true })
    setStatus(state, 'Waiting for approval... (/goal pause or /loop stop is available)')
    rerender()
  })
}

export async function runTtyApp(args: TtyAppArgs): Promise<void> {
  enterAlternateScreen()
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }
  hideCursor()

  const state: ScreenState = {
    input: '',
    cursorOffset: 0,
    transcript: [],
    transcriptScrollOffset: 0,
    selectedSlashIndex: 0,
    status: null,
    activeTool: null,
    recentTools: [],
    history: await loadHistoryEntries(),
    historyIndex: 0,
    historyDraft: '',
    nextEntryId: 1,
    pendingApproval: null,
    sessionPicker: null,
    isBusy: false,
    contextStats: null,
    compressionStatus: null,
    statusAnimationFrame: 0,
    inputHintFrame: 0,
    thinkingStartedAt: null,
    selection: null,
    mouseDown: null,
    transcriptBodyStartY: 0,
    transcriptBodyLines: 20,
    welcomeAnimation: null,
  }
  state.historyIndex = state.history.length

  const permissionArgs: TtyAppArgs = {
    ...args,
    contentReplacementState:
      args.contentReplacementState ?? createContentReplacementState(),
    contextCollapseState:
      args.contextCollapseState ?? createContextCollapseState(),
    permissions: new PermissionManager(
      args.cwd,
      createPermissionPromptHandler(state, () => scheduleRender()),
    ),
  }
  let screenClosed = false
  const renderNow = () => { if (!screenClosed) renderScreen(permissionArgs, state) }
  let scheduleRender = renderNow
  scheduleRender = createRenderScheduler(renderNow)
  permissionArgs.execution = new SessionRuntime({
    plan: permissionArgs.plan, tools: permissionArgs.tools,
    isBusy: () => state.isBusy,
    execute: request => executeTtyTurn(permissionArgs, state, scheduleRender, request),
    async recordAnswer(input) {
      permissionArgs.messages.push(input)
      pushTranscriptEntry(state, { kind: 'user', body: input.content })
      await saveSession(permissionArgs.cwd, permissionArgs.sessionId, permissionArgs.messages, permissionArgs.alreadySavedCount)
      permissionArgs.alreadySavedCount = permissionArgs.messages.length - 1
    },
    notice(message) {
      pushTranscriptEntry(state, { kind: 'assistant', body: message })
      scheduleRender()
    },
    settleWorkers: () => permissionArgs.subAgents.closeAll(),
  })
  const unsubscribeSubAgents = permissionArgs.subAgents.subscribe(scheduleRender)
  const unsubscribePlan = permissionArgs.plan.subscribe(scheduleRender)
  await permissionArgs.permissions.whenReady()
  if (
    permissionArgs.messages.length === 0 ||
    permissionArgs.messages[0]?.role !== 'system'
  ) {
    await refreshSystemPrompt(permissionArgs)
  }

  pushWelcomeAnimation(state)

  // Show loaded instruction files at startup
  const memoryFiles = await discoverInstructionFiles(args.cwd)
  if (memoryFiles.length > 0) {
    const lines = [
      `Memory: ${memoryFiles.length} instruction file(s) loaded`,
      ...memoryFiles.map((f, i) => {
        const lineCount = f.content.split('\n').length
        const preview = f.content.trim().split('\n')[0] || '<empty>'
        return `  ${i + 1}. ${f.path}\n     lines=${lineCount} preview=${preview}`
      }),
    ]
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: lines.join('\n'),
    })
  }

  let deferredResumeInput: string | null = null
  if (permissionArgs.resumeTarget) {
    if (permissionArgs.resumeTarget === 'picker') {
      deferredResumeInput = '/resume'
    } else {
      await handleInput(
        permissionArgs,
        state,
        scheduleRender,
        `/resume ${permissionArgs.resumeTarget}`,
      )
    }
  } else {
    const expired = await cleanupExpiredSessions(args.cwd, 30 * 24 * 60 * 60 * 1000)
    if (expired > 0) {
      pushTranscriptEntry(state, {
        kind: 'assistant',
        body: `Cleaned up ${expired} expired session(s) (>30 days old).`,
      })
    }
    const sessions = await listSessions(args.cwd)
    if (sessions.length > 0) {
      pushTranscriptEntry(state, {
        kind: 'assistant',
        body: `Found ${sessions.length} saved session(s). Type /resume to continue one.`,
      })
    }
  }

  renderNow()

  await new Promise<void>(resolve => {
    let finished = false
    let inputRemainder = ''
    let eventChain = Promise.resolve()
    let submitInFlight = false
    let controlInFlight = false
    const statusAnimationTimer = setInterval(() => {
      state.statusAnimationFrame = (state.statusAnimationFrame + 1) % 3
      scheduleRender()
    }, 1000)
    const welcomeAnimationTimer = setInterval(() => {
      if (advanceWelcomeAnimation(state)) {
        scheduleRender()
      }
    }, 200)
    const inputHintTimer = setInterval(() => {
      state.inputHintFrame = (state.inputHintFrame + 1) % 2
      if (!state.input) {
        scheduleRender()
      }
    }, 3000)

    const cleanup = () => {
      screenClosed = true
      clearInterval(statusAnimationTimer)
      clearInterval(welcomeAnimationTimer)
      clearInterval(inputHintTimer)
      unsubscribeSubAgents()
      unsubscribePlan()
      process.stdin.off('data', onData)
      process.stdin.off('end', onEnd)
      process.stdin.off('close', onClose)
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      showCursor()
      exitAlternateScreen()
      process.stdin.pause()
      process.stdout.write(`Session ${permissionArgs.sessionId} saved. To resume: minicode --resume ${permissionArgs.sessionId}\n`)
    }

    const finish = () => {
      if (finished) return
      finished = true
      void permissionArgs.execution!.stop().finally(() => {
        permissionArgs.execution!.goal.manager.dispose()
        cleanup()
        resolve()
      })
    }

    const handleEvent = async (event: ParsedInputEvent) => {
      try {
        if (finished) return
        if (state.pendingApproval && !state.pendingApproval.feedbackMode && !state.input &&
          event.kind === 'text' && !event.ctrl && event.text.startsWith('/')) {
          state.input = event.text
          state.cursorOffset = state.input.length
          scheduleRender()
          return
        }
        if (event.kind === 'key' && event.name === 'return' &&
          /^\/(goal|loop|plan|new|resume|fork|exit)(?:\s|$)/.test(state.input.trim())) {
          if (controlInFlight) return
          const submittedInput = state.input
          state.input = ''
          state.cursorOffset = 0
          state.selectedSlashIndex = 0
          controlInFlight = true
          void handleInput(permissionArgs, state, scheduleRender, submittedInput).then(shouldExit => {
            if (shouldExit) finish()
          }).catch(error => {
            pushTranscriptEntry(state, { kind: 'assistant', body: error instanceof Error ? error.message : String(error) })
          }).finally(() => { controlInFlight = false; permissionArgs.execution!.notifyIdle(); scheduleRender() })
          return
        }
        if (state.pendingApproval && !state.input.startsWith('/')) {
          if (event.kind === 'text' && event.ctrl && event.text === 'o') {
            if (togglePendingApprovalExpand(state)) {
              scheduleRender()
            }
            return
          }

          if (event.kind === 'text' && event.ctrl && event.text === 'c') {
            finish()
            return
          }

          if (event.kind === 'wheel') {
            if (
              event.direction === 'up'
                ? scrollPendingApprovalBy(state, -3)
                : scrollPendingApprovalBy(state, 3)
            ) {
              scheduleRender()
            }
            return
          }

          if (event.kind === 'key' && event.name === 'pageup') {
            if (scrollPendingApprovalBy(state, -8)) {
              scheduleRender()
            }
            return
          }

          if (event.kind === 'key' && event.name === 'pagedown') {
            if (scrollPendingApprovalBy(state, 8)) {
              scheduleRender()
            }
            return
          }

          if (event.kind === 'key' && event.name === 'up' && event.meta) {
            if (scrollPendingApprovalBy(state, -1)) {
              scheduleRender()
            }
            return
          }

          if (event.kind === 'key' && event.name === 'down' && event.meta) {
            if (scrollPendingApprovalBy(state, 1)) {
              scheduleRender()
            }
            return
          }

          if (event.kind === 'key' && event.name === 'up' && !event.meta) {
            if (movePendingApprovalSelection(state, -1)) {
              scheduleRender()
            }
            return
          }

          if (event.kind === 'key' && event.name === 'down' && !event.meta) {
            if (movePendingApprovalSelection(state, 1)) {
              scheduleRender()
            }
            return
          }

          if (event.kind === 'key' && event.name === 'backspace') {
            const pending = state.pendingApproval
            if (pending.feedbackMode && pending.feedbackInput.length > 0) {
              pending.feedbackInput = pending.feedbackInput.slice(0, -1)
              scheduleRender()
            }
            return
          }

          if (event.kind === 'text' && !event.ctrl && !event.meta) {
            const pending = state.pendingApproval
            if (!pending.feedbackMode) {
              const pressed = event.text.trim().toLowerCase()
              const matched = pending.request.choices.find(
                choice => choice.key.toLowerCase() === pressed,
              )
              if (matched) {
                if (matched.decision === 'deny_with_feedback') {
                  pending.feedbackMode = true
                  pending.feedbackInput = ''
                  scheduleRender()
                  return
                }

                state.pendingApproval = null
                setStatus(state, null)
                pending.resolve({ decision: matched.decision })
                scheduleRender()
                return
              }
            }

            if (pending.feedbackMode) {
              pending.feedbackInput += event.text
              scheduleRender()
            }
            return
          }

          if (event.kind === 'key' && event.name === 'return') {
            const pending = state.pendingApproval
            if (pending.feedbackMode) {
              const feedback = pending.feedbackInput.trim()
              state.pendingApproval = null
              setStatus(state, null)
              pending.resolve({
                decision: 'deny_with_feedback',
                feedback,
              })
              scheduleRender()
              return
            }

            const selected =
              pending.request.choices[
                Math.min(
                  pending.selectedChoiceIndex,
                  pending.request.choices.length - 1,
                )
              ]
            if (!selected) {
              return
            }

            if (selected.decision === 'deny_with_feedback') {
              pending.feedbackMode = true
              pending.feedbackInput = ''
              scheduleRender()
              return
            }

            state.pendingApproval = null
            setStatus(state, null)
            pending.resolve({ decision: selected.decision })
            scheduleRender()
            return
          }

          if (event.kind === 'key' && event.name === 'escape') {
            const pending = state.pendingApproval
            if (pending.feedbackMode) {
              pending.feedbackMode = false
              pending.feedbackInput = ''
              scheduleRender()
              return
            }

            state.pendingApproval = null
            setStatus(state, null)
            pending.resolve({ decision: 'deny_once' })
            scheduleRender()
            return
          }

          return
        }

        if (state.sessionPicker) {
          if (event.kind === 'text' && event.ctrl && event.text === 'c') {
            state.sessionPicker.resolve(null)
            state.sessionPicker = null
            setStatus(state, null)
            scheduleRender()
            return
          }

          // All-projects view
          if (state.sessionPicker.allProjects) {
            if (event.kind === 'key' && event.name === 'up') {
              if (state.sessionPicker.projectSelectedIndex > 0) {
                state.sessionPicker.projectSelectedIndex -= 1
                scheduleRender()
              }
              return
            }

            if (event.kind === 'key' && event.name === 'down') {
              if (state.sessionPicker.projectSelectedIndex < state.sessionPicker.projects.length - 1) {
                state.sessionPicker.projectSelectedIndex += 1
                scheduleRender()
              }
              return
            }

            if (event.kind === 'key' && event.name === 'return') {
              const proj = state.sessionPicker.projects[state.sessionPicker.projectSelectedIndex]
              if (proj && proj.sessionCount > 0) {
                state.sessionPicker = null
                setStatus(state, null)
                pushTranscriptEntry(state, {
                  kind: 'assistant',
                  body: `Project "${proj.dir}" has ${proj.sessionCount} session(s). Switch to it by exiting and running:\n\n  cd <project-path> && minicode --resume`,
                })
                scheduleRender()
              }
              return
            }

            if ((event.kind === 'key' && event.name === 'tab') || (event.kind === 'key' && event.name === 'escape')) {
              state.sessionPicker.allProjects = false
              scheduleRender()
              return
            }

            return
          }

          // Session list view
          if (event.kind === 'key' && event.name === 'up') {
            const picker = state.sessionPicker
            if (picker.selectedIndex > 0) {
              picker.selectedIndex -= 1
              picker.deleteConfirmIndex = null
              scheduleRender()
            }
            return
          }

          if (event.kind === 'key' && event.name === 'down') {
            const picker = state.sessionPicker
            if (picker.selectedIndex < picker.sessions.length - 1) {
              picker.selectedIndex += 1
              picker.deleteConfirmIndex = null
              scheduleRender()
            }
            return
          }

          if (event.kind === 'key' && event.name === 'return') {
            const picker = state.sessionPicker
            const selected = picker.sessions[picker.selectedIndex]
            const id = selected?.id ?? null
            state.sessionPicker = null
            setStatus(state, null)
            picker.resolve(id)
            scheduleRender()
            return
          }

          // 'd' to delete — first press marks, second press confirms
          if (event.kind === 'text' && !event.ctrl && !event.meta && event.text === 'd') {
            const picker = state.sessionPicker
            if (picker.deleteConfirmIndex === picker.selectedIndex) {
              // Second press — confirm delete
              const target = picker.sessions[picker.selectedIndex]
              if (target) {
                await clearSession(args.cwd, target.id)
                const sessions = await listSessions(args.cwd)
                if (sessions.length === 0) {
                  state.sessionPicker.resolve(null)
                  state.sessionPicker = null
                  setStatus(state, null)
                  scheduleRender()
                  return
                }
                picker.sessions = sessions
                picker.selectedIndex = Math.min(picker.selectedIndex, sessions.length - 1)
                picker.deleteConfirmIndex = null
              }
            } else {
              picker.deleteConfirmIndex = picker.selectedIndex
            }
            scheduleRender()
            return
          }

          // Tab — switch to all-projects view
          if (event.kind === 'key' && event.name === 'tab') {
            state.sessionPicker.allProjects = true
            state.sessionPicker.projects = await listAllProjects()
            state.sessionPicker.projectSelectedIndex = 0
            scheduleRender()
            return
          }

          if (event.kind === 'key' && event.name === 'escape') {
            state.sessionPicker.resolve(null)
            state.sessionPicker = null
            setStatus(state, null)
            scheduleRender()
            return
          }

          return
        }

        const visibleCommands = getVisibleCommands(state.input)

        if (event.kind === 'text' && event.ctrl && event.text === 'c') {
          finish()
          return
        }

        if (event.kind === 'wheel') {
          if (
              event.direction === 'up'
              ? scrollTranscriptBy(permissionArgs, state, 3)
              : scrollTranscriptBy(permissionArgs, state, -3)
          ) {
            scheduleRender()
          }
          return
        }

        if (event.kind === 'mouse') {
          const screenX = event.x + 1
          const screenY = event.y + 1
          const lineIndex = screenToAbsoluteLineIndex(permissionArgs, state, screenY)
          if (lineIndex < 0) {
            state.mouseDown = null
            state.selection = null
            return
          }
          const col = Math.max(0, screenX - 3)  // panel border (2) + content starts after left padding space

          if (event.action === 'press' && event.button === 'left') {
            state.mouseDown = { x: col, y: lineIndex }
            state.selection = null
            scheduleRender()
            return
          }

          if (event.action === 'drag' && event.button === 'left' && state.mouseDown) {
            const startLine = Math.min(state.mouseDown.y, lineIndex)
            const endLine = Math.max(state.mouseDown.y, lineIndex)
            const startCol =
              startLine === state.mouseDown.y
                ? Math.min(state.mouseDown.x, col)
                : state.mouseDown.y < lineIndex
                  ? state.mouseDown.x
                  : col
            const endCol =
              endLine === state.mouseDown.y
                ? Math.max(state.mouseDown.x, col)
                : state.mouseDown.y > lineIndex
                  ? state.mouseDown.x
                  : col

            state.selection = {
              startLine,
              startCol,
              endLine,
              endCol,
            }
            scheduleRender()
            return
          }

          if (event.action === 'release' && state.mouseDown) {
            if (state.selection) {
              const text = extractSelectedText(state.transcript, state.selection)
              if (text) {
                copyToClipboard(text)
              }
            }
            state.mouseDown = null
            state.selection = keepSelectionAfterMouseRelease(state.selection)
            scheduleRender()
            return
          }

          return
        }


        if (event.kind === 'key' && event.name === 'return') {
          if (state.isBusy || controlInFlight) {
            setStatus(
              state,
              state.activeTool
                ? `Running ${state.activeTool}...`
                : 'Current turn is still running...',
            )
            scheduleRender()
            return
          }

          if (visibleCommands.length > 0) {
            const selected =
              visibleCommands[
                Math.min(state.selectedSlashIndex, visibleCommands.length - 1)
              ]
            if (selected && state.input.trim() !== selected.usage) {
              state.input = selected.usage
              state.cursorOffset = state.input.length
              state.selectedSlashIndex = 0
              scheduleRender()
              return
            }
          }

          const submittedInput = state.input
          state.input = ''
          state.cursorOffset = 0
          state.selectedSlashIndex = 0
          scheduleRender()
          if (submitInFlight) {
            return
          }
          submitInFlight = true
          void (async () => {
            try {
              const shouldExit = await handleInput(
                permissionArgs,
                state,
                scheduleRender,
                submittedInput,
              )
              if (shouldExit) {
                finish()
                return
              }
              scheduleRender()
            } catch (error) {
              pushTranscriptEntry(state, {
                kind: 'assistant',
                body: error instanceof Error ? error.message : String(error),
              })
              state.input = ''
              state.cursorOffset = 0
              state.selectedSlashIndex = 0
              setStatus(state, null)
              scheduleRender()
            } finally {
              submitInFlight = false
              permissionArgs.execution!.notifyIdle()
            }
          })()
          return
        }

        if (event.kind === 'key' && event.name === 'backspace') {
          if (state.cursorOffset > 0) {
            state.input =
              state.input.slice(0, state.cursorOffset - 1) +
              state.input.slice(state.cursorOffset)
            state.cursorOffset -= 1
          }
          state.selectedSlashIndex = 0
          scheduleRender()
          return
        }

        if (event.kind === 'key' && event.name === 'delete') {
          state.input =
            state.input.slice(0, state.cursorOffset) +
            state.input.slice(state.cursorOffset + 1)
          state.selectedSlashIndex = 0
          scheduleRender()
          return
        }

        if (event.kind === 'key' && event.name === 'tab') {
          if (visibleCommands.length > 0) {
            const selected =
              visibleCommands[
                Math.min(state.selectedSlashIndex, visibleCommands.length - 1)
              ]
            if (selected) {
              state.input = selected.usage
              state.cursorOffset = state.input.length
              state.selectedSlashIndex = 0
              scheduleRender()
            }
          }
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'p') {
          if (historyUp(state)) {
            scheduleRender()
          }
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'n') {
          if (historyDown(state)) {
            scheduleRender()
          }
          return
        }

        if (event.kind === 'key' && event.name === 'up') {
          if (visibleCommands.length > 0) {
            state.selectedSlashIndex =
              (state.selectedSlashIndex - 1 + visibleCommands.length) %
              visibleCommands.length
            scheduleRender()
          } else if (event.meta) {
            if (scrollTranscriptBy(permissionArgs, state, 1)) {
              scheduleRender()
            }
          } else if (historyUp(state)) {
            scheduleRender()
          }
          return
        }

        if (event.kind === 'key' && event.name === 'down') {
          if (visibleCommands.length > 0) {
            state.selectedSlashIndex =
              (state.selectedSlashIndex + 1) % visibleCommands.length
              scheduleRender()
          } else if (event.meta) {
            if (scrollTranscriptBy(permissionArgs, state, -1)) {
              scheduleRender()
            }
          } else if (historyDown(state)) {
            scheduleRender()
          }
          return
        }

        if (event.kind === 'key' && event.name === 'pageup') {
          if (scrollTranscriptBy(permissionArgs, state, 8)) {
            scheduleRender()
          }
          return
        }

        if (event.kind === 'key' && event.name === 'pagedown') {
          if (scrollTranscriptBy(permissionArgs, state, -8)) {
            scheduleRender()
          }
          return
        }

        if (event.kind === 'key' && event.name === 'left') {
          state.cursorOffset = Math.max(0, state.cursorOffset - 1)
          scheduleRender()
          return
        }

        if (event.kind === 'key' && event.name === 'right') {
          state.cursorOffset = Math.min(state.input.length, state.cursorOffset + 1)
          scheduleRender()
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'u') {
          state.input = ''
          state.cursorOffset = 0
          state.selectedSlashIndex = 0
          scheduleRender()
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'a') {
          if (!state.input) {
            if (jumpTranscriptToEdge(permissionArgs, state, 'top')) {
              scheduleRender()
            }
            return
          }

          state.cursorOffset = 0
          scheduleRender()
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'e') {
          if (!state.input) {
            if (jumpTranscriptToEdge(permissionArgs, state, 'bottom')) {
              scheduleRender()
            }
            return
          }

          state.cursorOffset = state.input.length
          scheduleRender()
          return
        }

        if (event.kind === 'key' && event.name === 'escape') {
          state.input = ''
          state.cursorOffset = 0
          state.selectedSlashIndex = 0
          scheduleRender()
          return
        }

        if (event.kind === 'text' && !event.ctrl) {
          state.input =
            state.input.slice(0, state.cursorOffset) +
            event.text +
            state.input.slice(state.cursorOffset)
          state.cursorOffset += event.text.length
          state.selectedSlashIndex = 0
          state.historyIndex = state.history.length
          scheduleRender()
        }
      } catch (error) {
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: error instanceof Error ? error.message : String(error),
        })
        state.input = ''
        state.cursorOffset = 0
        state.selectedSlashIndex = 0
        setStatus(state, null)
        scheduleRender()
      }
    }

    const onData = (chunk: Buffer | string) => {
      const parsed = parseInputChunk(inputRemainder, chunk)
      inputRemainder = parsed.rest
      eventChain = eventChain.then(async () => {
        for (const event of parsed.events) {
          await handleEvent(event)
        }
      }).catch(error => {
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: error instanceof Error ? error.message : String(error),
        })
        state.input = ''
        state.cursorOffset = 0
        state.selectedSlashIndex = 0
        setStatus(state, null)
        scheduleRender()
      })
    }

    const onEnd = () => finish()
    const onClose = () => finish()
    process.stdin.on('data', onData)
    process.stdin.once('end', onEnd)
    process.stdin.once('close', onClose)

    // Handle deferred --resume (picker mode)
    if (deferredResumeInput) {
      const input = deferredResumeInput
      deferredResumeInput = null
      submitInFlight = true
      void (async () => {
        try {
          const shouldExit = await handleInput(
            permissionArgs,
            state,
            scheduleRender,
            input,
          )
          if (shouldExit) {
            finish()
            return
          }
          scheduleRender()
        } catch (error) {
          pushTranscriptEntry(state, {
            kind: 'assistant',
            body: error instanceof Error ? error.message : String(error),
          })
          state.input = ''
          state.cursorOffset = 0
          state.selectedSlashIndex = 0
          setStatus(state, null)
          scheduleRender()
        } finally {
          submitInFlight = false
        }
      })()
    }
  })
}
