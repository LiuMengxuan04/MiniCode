import process from 'node:process'
import { runAgentTurn } from './agent-loop.js'
import {
  SLASH_COMMANDS,
  findMatchingSlashCommands,
  tryHandleLocalCommand,
} from './cli-commands.js'
import { loadHistoryEntries, saveHistoryEntries } from './history.js'
import { parseLocalToolShortcut } from './local-tool-shortcuts.js'
import {
  PermissionManager,
  PermissionPromptResult,
  PermissionRequest,
} from './permissions.js'
import { buildSystemPrompt } from './prompt.js'
import { parseInputChunk, type ParsedInputEvent } from './tui/input-parser.js'
import {
  clearScreen,
  enterAlternateScreen,
  exitAlternateScreen,
  getPermissionPromptMaxScrollOffset,
  hideCursor,
  renderBanner,
  renderFooterBar,
  renderInputPrompt,
  renderPanel,
  renderPermissionPrompt,
  renderSlashMenu,
  renderStatusLine,
  renderToolPanel,
  renderTranscript,
  getTranscriptMaxScrollOffset,
  showCursor,
  type TranscriptEntry,
} from './ui.js'
import type { RuntimeConfig } from './config.js'
import type { ToolRegistry } from './tool.js'
import type { ChatMessage, ModelAdapter } from './types.js'

type TtyAppArgs = {
  runtime: RuntimeConfig | null
  tools: ToolRegistry
  model: ModelAdapter
  messages: ChatMessage[]
  cwd: string
  permissions: PermissionManager
}

type ContextUsage = {
  usedTokens: number
  maxTokens: number
  usedPercent: number
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
}

type TranscriptEntryDraft =
  | Omit<Extract<TranscriptEntry, { kind: 'user' }>, 'id'>
  | Omit<Extract<TranscriptEntry, { kind: 'assistant' }>, 'id'>
  | Omit<Extract<TranscriptEntry, { kind: 'progress' }>, 'id'>
  | Omit<Extract<TranscriptEntry, { kind: 'tool' }>, 'id'>

function getSessionStats(args: TtyAppArgs, state: ScreenState) {
  return {
    transcriptCount: state.transcript.length,
    messageCount: args.messages.length,
    skillCount: args.tools.getSkills().length,
    mcpCount: args.tools.getMcpServers().length,
  }
}

function estimateTextTokens(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return 0
  // Keep estimation simple and stable: roughly 1 token per 4 chars.
  return Math.max(1, Math.ceil(trimmed.length / 4))
}

function estimateContextUsage(messages: ChatMessage[]): ContextUsage {
  const envOverride = Number(process.env.MINI_CODE_MAX_CONTEXT_TOKENS)
  const maxTokens =
    Number.isFinite(envOverride) && envOverride > 0
      ? Math.floor(envOverride)
      : 200_000

  let usedTokens = 0
  for (const message of messages) {
    if (
      message.role === 'system' ||
      message.role === 'user' ||
      message.role === 'assistant' ||
      message.role === 'assistant_progress'
    ) {
      usedTokens += estimateTextTokens(message.content)
      continue
    }

    if (message.role === 'assistant_tool_call') {
      usedTokens += estimateTextTokens(message.toolName)
      try {
        usedTokens += estimateTextTokens(JSON.stringify(message.input))
      } catch {
        usedTokens += estimateTextTokens(String(message.input))
      }
      continue
    }

    usedTokens += estimateTextTokens(message.toolName)
    usedTokens += estimateTextTokens(message.content)
  }

  return {
    usedTokens,
    maxTokens,
    usedPercent: Number(((usedTokens / maxTokens) * 100).toFixed(1)),
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
    renderInputPrompt(state.input, state.cursorOffset),
    commands.length > 0
      ? `\n${renderSlashMenu(
          commands,
          Math.min(state.selectedSlashIndex, commands.length - 1),
        )}`
      : '',
  ].join('')
  return renderPanel('prompt', promptBody)
}

function getTranscriptBodyLines(args: TtyAppArgs, state: ScreenState): number {
  const rows = Math.max(24, process.stdout.rows ?? 40)
  const headerLines = renderHeaderPanel(args, state).split('\n').length
  const promptLines = renderPromptPanel(state).split('\n').length
  const footerLines = 1
  const gapsBetweenSections = 3
  const transcriptPanelFrameLines = 4
  const remaining =
    rows -
    headerLines -
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

function setToolEntryCollapsePhase(
  state: ScreenState,
  entryId: number,
  phase: 1 | 2 | 3,
): void {
  const entry = state.transcript.find(
    item => item.id === entryId && item.kind === 'tool',
  )
  if (!entry || entry.kind !== 'tool' || entry.status === 'running') {
    return
  }
  entry.collapsePhase = phase
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

function scheduleToolAutoCollapse(
  state: ScreenState,
  entryId: number,
  output: string,
  rerender: () => void,
): void {
  const summary = summarizeCollapsedToolBody(output)
  const frames: Array<1 | 2 | 3> = [1, 2]
  frames.forEach((phase, idx) => {
    setTimeout(() => {
      setToolEntryCollapsePhase(state, entryId, phase)
      rerender()
    }, 110 * (idx + 1))
  })
  setTimeout(() => {
    collapseToolEntry(state, entryId, summary)
    rerender()
  }, 320)
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
  const contextUsage = estimateContextUsage(args.messages)
  clearScreen()
  console.log(renderHeaderPanel(args, state))
  console.log('')

  if (state.pendingApproval) {
    console.log(
      renderPanel(
        'approval',
        renderPermissionPrompt(state.pendingApproval.request, {
          expanded: state.pendingApproval.detailsExpanded,
          scrollOffset: state.pendingApproval.detailsScrollOffset,
          selectedChoiceIndex: state.pendingApproval.selectedChoiceIndex,
          feedbackMode: state.pendingApproval.feedbackMode,
          feedbackInput: state.pendingApproval.feedbackInput,
        }),
      ),
    )
    console.log('')
    console.log(renderPanel('activity', renderToolPanel(state.activeTool, state.recentTools)))
    console.log('')
    console.log(
      renderFooterBar(
        state.status,
        true,
        args.tools.getSkills().length > 0,
        contextUsage,
      ),
    )
    return
  }

  console.log(
    renderPanel(
      'session feed',
      state.transcript.length > 0
        ? renderTranscript(
            state.transcript,
            state.transcriptScrollOffset,
            getTranscriptBodyLines(args, state),
          )
        : `${renderStatusLine(null)}\n\nType /help for commands.`,
      {
        rightTitle: `${state.transcript.length} events`,
        minBodyLines: getTranscriptBodyLines(args, state),
      },
    ),
  )
  console.log('')
  console.log(renderPromptPanel(state))

  console.log('')
  console.log(
    renderFooterBar(
      state.status,
      true,
      args.tools.getSkills().length > 0,
      contextUsage,
    ),
  )
}

async function refreshSystemPrompt(args: TtyAppArgs): Promise<void> {
  args.messages[0] = {
    role: 'system',
    content: await buildSystemPrompt(args.cwd, args.permissions.getSummary(), {
      skills: args.tools.getSkills(),
      mcpServers: args.tools.getMcpServers(),
    }),
  }
}

async function executeToolShortcut(
  args: TtyAppArgs,
  state: ScreenState,
  toolName: string,
  input: unknown,
  rerender: () => void,
): Promise<void> {
  state.status = `Running ${toolName}...`
  state.activeTool = toolName
  const entryId = pushTranscriptEntry(state, {
    kind: 'tool',
    toolName,
    status: 'running',
    body: summarizeToolInput(toolName, input),
  })
  rerender()

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
  state.activeTool = null
  state.status = null
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
  if (input === '/exit') return true

  if (state.history.at(-1) !== input) {
    state.history.push(input)
    await saveHistoryEntries(state.history)
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
    tools: args.tools,
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

  await refreshSystemPrompt(args)
  args.messages.push({ role: 'user', content: input })
  pushTranscriptEntry(state, {
    kind: 'user',
    body: input,
  })
  state.transcriptScrollOffset = 0
  state.status = 'Thinking...'
  rerender()

  const pendingToolEntries = new Map<string, number[]>()
  const aggregatedEditByKey = new Map<string, AggregatedEditProgress>()
  const aggregatedEditByEntryId = new Map<number, AggregatedEditProgress>()

  args.permissions.beginTurn()
  try {
    const nextMessages = await runAgentTurn({
      model: args.model,
      tools: args.tools,
      messages: args.messages,
      cwd: args.cwd,
      permissions: args.permissions,
      onAssistantMessage(content) {
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: content,
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
        state.status = `Running ${toolName}...`
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
        if (entryId !== undefined) {
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
        state.status = 'Thinking...'
        rerender()
      },
    })
    args.messages.length = 0
    args.messages.push(...nextMessages)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
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
  }

  state.status = null
  return false
}

function createPermissionPromptHandler(
  state: ScreenState,
  rerender: () => void,
): (request: PermissionRequest) => Promise<PermissionPromptResult> {
  return request =>
    new Promise(resolve => {
      state.pendingApproval = {
        request,
        resolve,
        detailsExpanded: false,
        detailsScrollOffset: 0,
        selectedChoiceIndex: 0,
        feedbackMode: false,
        feedbackInput: '',
      }
      state.status = 'Waiting for approval...'
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
  }
  state.historyIndex = state.history.length

  const permissionArgs: TtyAppArgs = {
    ...args,
    permissions: new PermissionManager(
      args.cwd,
      createPermissionPromptHandler(state, () => renderScreen(permissionArgs, state)),
    ),
  }
  await permissionArgs.permissions.whenReady()
  await refreshSystemPrompt(permissionArgs)

  renderScreen(permissionArgs, state)

  await new Promise<void>(resolve => {
    let finished = false
    let inputRemainder = ''

    const cleanup = () => {
      process.stdin.off('data', onData)
      process.stdin.off('end', onEnd)
      process.stdin.off('close', onClose)
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      showCursor()
      exitAlternateScreen()
      process.stdin.pause()
      process.stdout.write('mini-code exited.\n')
    }

    const finish = () => {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }

    const handleEvent = async (event: ParsedInputEvent) => {
      try {
        if (state.pendingApproval) {
          if (event.kind === 'text' && event.ctrl && event.text === 'o') {
            if (togglePendingApprovalExpand(state)) {
              renderScreen(permissionArgs, state)
            }
            return
          }

          if (event.kind === 'wheel') {
            if (
              event.direction === 'up'
                ? scrollPendingApprovalBy(state, -3)
                : scrollPendingApprovalBy(state, 3)
            ) {
              renderScreen(permissionArgs, state)
            }
            return
          }

          if (event.kind === 'key' && event.name === 'pageup') {
            if (scrollPendingApprovalBy(state, -8)) {
              renderScreen(permissionArgs, state)
            }
            return
          }

          if (event.kind === 'key' && event.name === 'pagedown') {
            if (scrollPendingApprovalBy(state, 8)) {
              renderScreen(permissionArgs, state)
            }
            return
          }

          if (event.kind === 'key' && event.name === 'up' && event.meta) {
            if (scrollPendingApprovalBy(state, -1)) {
              renderScreen(permissionArgs, state)
            }
            return
          }

          if (event.kind === 'key' && event.name === 'down' && event.meta) {
            if (scrollPendingApprovalBy(state, 1)) {
              renderScreen(permissionArgs, state)
            }
            return
          }

          if (event.kind === 'key' && event.name === 'up' && !event.meta) {
            if (movePendingApprovalSelection(state, -1)) {
              renderScreen(permissionArgs, state)
            }
            return
          }

          if (event.kind === 'key' && event.name === 'down' && !event.meta) {
            if (movePendingApprovalSelection(state, 1)) {
              renderScreen(permissionArgs, state)
            }
            return
          }

          if (event.kind === 'key' && event.name === 'backspace') {
            const pending = state.pendingApproval
            if (pending.feedbackMode && pending.feedbackInput.length > 0) {
              pending.feedbackInput = pending.feedbackInput.slice(0, -1)
              renderScreen(permissionArgs, state)
            }
            return
          }

          if (event.kind === 'text' && !event.ctrl && !event.meta) {
            const pending = state.pendingApproval
            if (pending.feedbackMode) {
              pending.feedbackInput += event.text
              renderScreen(permissionArgs, state)
            }
            return
          }

          if (event.kind === 'key' && event.name === 'return') {
            const pending = state.pendingApproval
            if (pending.feedbackMode) {
              const feedback = pending.feedbackInput.trim()
              state.pendingApproval = null
              state.status = null
              pending.resolve({
                decision: 'deny_with_feedback',
                feedback,
              })
              renderScreen(permissionArgs, state)
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
              renderScreen(permissionArgs, state)
              return
            }

            state.pendingApproval = null
            state.status = null
            pending.resolve({ decision: selected.decision })
            renderScreen(permissionArgs, state)
            return
          }

          if (event.kind === 'key' && event.name === 'escape') {
            const pending = state.pendingApproval
            if (pending.feedbackMode) {
              pending.feedbackMode = false
              pending.feedbackInput = ''
              renderScreen(permissionArgs, state)
              return
            }

            state.pendingApproval = null
            state.status = null
            pending.resolve({ decision: 'deny_once' })
            renderScreen(permissionArgs, state)
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
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'key' && event.name === 'return') {
          if (visibleCommands.length > 0) {
            const selected =
              visibleCommands[
                Math.min(state.selectedSlashIndex, visibleCommands.length - 1)
              ]
            if (selected && state.input.trim() !== selected.usage) {
              state.input = selected.usage
              state.cursorOffset = state.input.length
              state.selectedSlashIndex = 0
              renderScreen(permissionArgs, state)
              return
            }
          }

          const submittedInput = state.input
          state.input = ''
          state.cursorOffset = 0
          state.selectedSlashIndex = 0
          renderScreen(permissionArgs, state)
          const shouldExit = await handleInput(
            permissionArgs,
            state,
            () => renderScreen(permissionArgs, state),
            submittedInput,
          )
          if (shouldExit) {
            finish()
            return
          }
          renderScreen(permissionArgs, state)
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
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'key' && event.name === 'delete') {
          state.input =
            state.input.slice(0, state.cursorOffset) +
            state.input.slice(state.cursorOffset + 1)
          state.selectedSlashIndex = 0
          renderScreen(permissionArgs, state)
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
              renderScreen(permissionArgs, state)
            }
          }
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'p') {
          if (historyUp(state)) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'n') {
          if (historyDown(state)) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'key' && event.name === 'up') {
          if (visibleCommands.length > 0) {
            state.selectedSlashIndex =
              (state.selectedSlashIndex - 1 + visibleCommands.length) %
              visibleCommands.length
            renderScreen(permissionArgs, state)
          } else if (event.meta) {
            if (scrollTranscriptBy(permissionArgs, state, 1)) {
              renderScreen(permissionArgs, state)
            }
          } else if (historyUp(state)) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'key' && event.name === 'down') {
          if (visibleCommands.length > 0) {
            state.selectedSlashIndex =
              (state.selectedSlashIndex + 1) % visibleCommands.length
              renderScreen(permissionArgs, state)
          } else if (event.meta) {
            if (scrollTranscriptBy(permissionArgs, state, -1)) {
              renderScreen(permissionArgs, state)
            }
          } else if (historyDown(state)) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'key' && event.name === 'pageup') {
          if (scrollTranscriptBy(permissionArgs, state, 8)) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'key' && event.name === 'pagedown') {
          if (scrollTranscriptBy(permissionArgs, state, -8)) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'key' && event.name === 'left') {
          state.cursorOffset = Math.max(0, state.cursorOffset - 1)
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'key' && event.name === 'right') {
          state.cursorOffset = Math.min(state.input.length, state.cursorOffset + 1)
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'u') {
          state.input = ''
          state.cursorOffset = 0
          state.selectedSlashIndex = 0
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'a') {
          if (!state.input) {
            if (jumpTranscriptToEdge(permissionArgs, state, 'top')) {
              renderScreen(permissionArgs, state)
            }
            return
          }

          state.cursorOffset = 0
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'e') {
          if (!state.input) {
            if (jumpTranscriptToEdge(permissionArgs, state, 'bottom')) {
              renderScreen(permissionArgs, state)
            }
            return
          }

          state.cursorOffset = state.input.length
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'key' && event.name === 'escape') {
          state.input = ''
          state.cursorOffset = 0
          state.selectedSlashIndex = 0
          renderScreen(permissionArgs, state)
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
          renderScreen(permissionArgs, state)
        }
      } catch (error) {
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: error instanceof Error ? error.message : String(error),
        })
        state.input = ''
        state.cursorOffset = 0
        state.selectedSlashIndex = 0
        state.status = null
        renderScreen(permissionArgs, state)
      }
    }

    const onData = (chunk: Buffer | string) => {
      const parsed = parseInputChunk(inputRemainder, chunk)
      inputRemainder = parsed.rest
      void (async () => {
        for (const event of parsed.events) {
          await handleEvent(event)
        }
      })()
    }

    const onEnd = () => finish()
    const onClose = () => finish()
    process.stdin.on('data', onData)
    process.stdin.once('end', onEnd)
    process.stdin.once('close', onClose)
  })
}
