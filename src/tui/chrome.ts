import type { BackgroundTaskResult } from '../tool.js'
import path from 'node:path'
import process from 'node:process'
import type { RuntimeConfig } from '../config.js'
import type { SlashCommand } from '../cli-commands.js'
import type { PermissionRequest } from '../permissions.js'

const RESET = '\u001b[0m'
const DIM = '\u001b[2m'
const CYAN = '\u001b[36m'
const GREEN = '\u001b[32m'
const YELLOW = '\u001b[33m'
const RED = '\u001b[31m'
const BLUE = '\u001b[34m'
const MAGENTA = '\u001b[35m'
const BOLD = '\u001b[1m'
const REVERSE = '\u001b[7m'
const BRIGHT_GREEN = '\u001b[92m'
const BRIGHT_RED = '\u001b[91m'
const BRIGHT_CYAN = '\u001b[96m'
const BRIGHT_YELLOW = '\u001b[93m'
const BORDER = '\u001b[38;5;31m'

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, '')
}

export function charDisplayWidth(char: string): number {
  const code = char.codePointAt(0)
  if (code === undefined) return 0

  if (
    code >= 0x1100 &&
    (
      code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faf6) ||
      (code >= 0x20000 && code <= 0x3fffd)
    )
  ) {
    return 2
  }

  return 1
}

export function stringDisplayWidth(input: string): number {
  return [...stripAnsi(input)].reduce((sum, char) => sum + charDisplayWidth(char), 0)
}

function truncatePlain(input: string, width: number): string {
  if (width <= 0) return ''
  if (stringDisplayWidth(input) <= width) return input
  if (width <= 3) return input.slice(0, width)
  const target = width - 3
  let current = ''
  let used = 0
  for (const char of [...input]) {
    const next = charDisplayWidth(char)
    if (used + next > target) break
    current += char
    used += next
  }
  return `${current}...`
}

function padPlain(input: string, width: number): string {
  const visible = stringDisplayWidth(input)
  return visible >= width ? input : `${input}${' '.repeat(width - visible)}`
}

function truncatePathMiddle(input: string, width: number): string {
  if (width <= 0 || stringDisplayWidth(input) <= width) return input
  if (width <= 5) return truncatePlain(input, width)

  const keep = width - 3
  const leftTarget = Math.ceil(keep / 2)
  const rightTarget = Math.floor(keep / 2)

  let left = ''
  let leftWidth = 0
  for (const char of [...input]) {
    const next = charDisplayWidth(char)
    if (leftWidth + next > leftTarget) break
    left += char
    leftWidth += next
  }

  let right = ''
  let rightWidth = 0
  for (const char of [...input].reverse()) {
    const next = charDisplayWidth(char)
    if (rightWidth + next > rightTarget) break
    right = `${char}${right}`
    rightWidth += next
  }

  return `${left}...${right}`
}

function colorBadge(
  label: string,
  value: string,
  color: string,
): string {
  return `${color}[${label}]${RESET} ${BOLD}${value}${RESET}`
}

function joinSegmentsWithinWidth(
  segments: string[],
  separator: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0 || segments.length === 0) {
    return ''
  }

  let output = ''
  for (const segment of segments) {
    const candidate = output.length > 0 ? `${output}${separator}${segment}` : segment
    if (stringDisplayWidth(candidate) <= maxWidth) {
      output = candidate
      continue
    }

    if (!output) {
      return truncatePlain(stripAnsi(segment), maxWidth)
    }

    const withEllipsis = `${output}${separator}${DIM}...${RESET}`
    if (stringDisplayWidth(withEllipsis) <= maxWidth) {
      return withEllipsis
    }

    return output
  }

  return output
}

function borderLine(kind: 'top' | 'bottom', width: number): string {
  const inner = Math.max(0, width - 2)
  if (kind === 'top') {
    return `${BORDER}╭${'─'.repeat(inner)}╮${RESET}`
  }
  return `${BORDER}╰${'─'.repeat(inner)}╯${RESET}`
}

function panelRow(left: string, width: number, right?: string): string {
  const inner = Math.max(0, width - 4)
  const rightText = right ?? ''
  const leftWidth = stringDisplayWidth(left)
  const rightWidth = stringDisplayWidth(rightText)
  const gap = Math.max(1, inner - leftWidth - rightWidth)
  const leftText =
    leftWidth + rightWidth + gap > inner
      ? truncatePlain(left, Math.max(0, inner - rightWidth - 1))
      : left
  return `${BORDER}│${RESET} ${leftText}${' '.repeat(
    Math.max(0, inner - stringDisplayWidth(leftText) - rightWidth),
  )}${rightText} ${BORDER}│${RESET}`
}

function emptyPanelRow(width: number): string {
  return `${BORDER}│${RESET}${' '.repeat(Math.max(0, width - 2))}${BORDER}│${RESET}`
}

export function wrapPanelBodyLine(line: string, width: number): string[] {
  const inner = Math.max(0, width - 4)
  if (inner <= 0) return ['']
  const plain = stripAnsi(line)
  if (stringDisplayWidth(plain) <= inner) return [line]
  const parts: string[] = []
  let current = ''
  let currentWidth = 0
  for (const char of [...plain]) {
    const charWidth = charDisplayWidth(char)
    if (currentWidth + charWidth > inner) {
      parts.push(current)
      current = char
      currentWidth = charWidth
      continue
    }
    current += char
    currentWidth += charWidth
  }
  if (current.length > 0) {
    parts.push(current)
  }
  return parts
}

export function renderPanel(
  title: string,
  body: string,
  options: {
    rightTitle?: string
    minBodyLines?: number
  } = {},
): string {
  const width = Math.max(60, process.stdout.columns ?? 100)
  const bodyLines = body.length > 0 ? body.split('\n') : []
  const renderedLines = bodyLines.flatMap(line => wrapPanelBodyLine(line, width))
  const minBodyLines = options.minBodyLines ?? 0
  while (renderedLines.length < minBodyLines) {
    renderedLines.push('')
  }

  return [
    borderLine('top', width),
    panelRow(
      `${BRIGHT_CYAN}${BOLD}${title}${RESET}`,
      width,
      options.rightTitle
        ? `${DIM}${truncatePlain(options.rightTitle, Math.max(10, Math.floor(width * 0.3)))}${RESET}`
        : undefined,
    ),
    emptyPanelRow(width),
    ...renderedLines.map(line => panelRow(line, width)),
    borderLine('bottom', width),
  ].join('\n')
}

export function renderContextBadge(stats: {
  utilization: number
  warningLevel: 'normal' | 'warning' | 'critical' | 'blocked'
  accounting?: {
    providerUsageTokens: number
    estimatedTokens: number
    source: 'provider_usage' | 'provider_usage_plus_estimate' | 'estimate_only'
  }
}): string {
  const { utilization, warningLevel, accounting } = stats
  const percent = Math.round(utilization * 100)

  const colorMap = {
    normal: GREEN,
    warning: YELLOW,
    critical: RED,
    blocked: BRIGHT_RED,
  }
  const color = colorMap[warningLevel]

  const filled = Math.round(utilization * 10)
  const bar = '\u2593'.repeat(filled) + '\u2591'.repeat(10 - filled)
  const sourceLabel =
    accounting?.source === 'provider_usage'
      ? 'usage'
      : accounting?.source === 'provider_usage_plus_estimate'
        ? 'usage+est'
        : accounting?.source === 'estimate_only'
          ? 'est'
          : ''
  const suffix = sourceLabel ? ` ${sourceLabel}` : ''

  return colorBadge('ctx', `${percent}% ${bar}${suffix}`, color)
}

export function renderBanner(
  runtime: RuntimeConfig | null,
  cwd: string,
  permissionSummary: string[],
  session: {
    transcriptCount: number
    messageCount: number
    skillCount: number
    mcpTotalCount: number
    mcpConnectedCount: number
    mcpConnectingCount: number
    mcpErrorCount: number
    contextStats?: {
      utilization: number
      warningLevel: 'normal' | 'warning' | 'critical' | 'blocked'
      accounting?: {
        providerUsageTokens: number
        estimatedTokens: number
        source: 'provider_usage' | 'provider_usage_plus_estimate' | 'estimate_only'
      }
    } | null
  },
): string {
  const panelWidth = Math.max(60, process.stdout.columns ?? 100)
  const panelInner = Math.max(0, panelWidth - 4)
  const cwdName = path.basename(cwd) || cwd
  const model = runtime?.model ?? 'not-configured'
  const provider = runtime?.baseUrl
    ? runtime.baseUrl.replace(/^https?:\/\//, '').split('/')[0] || 'custom'
    : 'offline'
  const pathBudget = Math.max(20, panelInner - 28)
  const projectLine = `${BLUE}${BOLD}${truncatePlain(cwdName, 24)}${RESET} ${DIM}${truncatePathMiddle(cwd, pathBudget)}${RESET}`
  const permissionLine =
    permissionSummary.length > 0
      ? `${DIM}${truncatePlain(permissionSummary.join(' | '), Math.max(24, panelInner))}${RESET}`
      : `${DIM}permissions: ask on sensitive actions${RESET}`
  const metaBadges = [
    colorBadge('session', 'local', BRIGHT_YELLOW),
    colorBadge('provider', provider, CYAN),
    colorBadge('model', model, GREEN),
    colorBadge('messages', String(session.messageCount), BRIGHT_CYAN),
    colorBadge('events', String(session.transcriptCount), BLUE),
    ...(session.contextStats ? [renderContextBadge(session.contextStats)] : []),
    colorBadge('skills', String(session.skillCount), BRIGHT_GREEN),
    colorBadge(
      'mcp',
      `${session.mcpConnectedCount}/${session.mcpTotalCount}`,
      MAGENTA,
    ),
    ...(session.mcpConnectingCount > 0
      ? [colorBadge('mcp-wait', String(session.mcpConnectingCount), YELLOW)]
      : []),
    ...(session.mcpErrorCount > 0
      ? [colorBadge('mcp-err', String(session.mcpErrorCount), BRIGHT_RED)]
      : []),
  ]
  const metaLine = joinSegmentsWithinWidth(metaBadges, '  ', panelInner)

  return renderPanel(
    'MiniCode',
    [
      `${DIM}Terminal coding assistant with a card-style session layout.${RESET}`,
      '',
      projectLine,
      metaLine,
      permissionLine,
    ].join('\n'),
    {
      rightTitle: provider,
    },
  )
}

export function renderStatusLine(status: string | null): string {
  if (!status) return `${DIM}Ready${RESET}`
  return `${YELLOW}${BOLD}${status}${RESET}`
}

export function renderToolPanel(
  activeTool: string | null,
  recentTools: Array<{ name: string; status: 'success' | 'error' }>,
  backgroundTasks: BackgroundTaskResult[] = [],
): string {
  const items: string[] = []

  if (activeTool) {
    items.push(`${YELLOW}running:${RESET} ${activeTool}`)
  }

  const runningBackground = backgroundTasks.filter(task => task.status === 'running')
  if (runningBackground.length > 0) {
    const label =
      runningBackground.length === 1
        ? `1 shell: ${truncatePlain(runningBackground[0]!.command, 48)}`
        : `${runningBackground.length} shells running`
    items.push(`${BRIGHT_CYAN}background:${RESET} ${label}`)
  }

  if (recentTools.length === 0 && runningBackground.length === 0) {
    items.push(`${DIM}recent: none${RESET}`)
    return `${DIM}tools${RESET}  ${items.join('  ')}`
  }

  for (const tool of recentTools.slice(-5).reverse()) {
    const status = tool.status === 'success' ? `${GREEN}ok${RESET}` : `${RED}err${RESET}`
    items.push(`${status} ${tool.name}`)
  }

  return `${DIM}tools${RESET}  ${items.join('  ')}`
}

export function renderFooterBar(
  status: string | null,
  toolsEnabled: boolean,
  skillsEnabled: boolean,
  mcpStatus: {
    total: number
    connected: number
    connecting: number
    error: number
    toolCount: number
  },
  backgroundTasks: BackgroundTaskResult[] = [],
  compressionStatus?: string | null,
): string {
  const width = Math.max(60, process.stdout.columns ?? 100)
  const left = renderStatusLine(status)
  const runningBackground = backgroundTasks.filter(task => task.status === 'running')
  const backgroundSummary =
    runningBackground.length > 0
      ? `${DIM}|${RESET} ${DIM}shells${RESET} ${BRIGHT_CYAN}${runningBackground.length}${RESET}`
      : ''
  const mcpSummary =
    mcpStatus.total === 0
      ? `${DIM}mcp${RESET} ${DIM}none${RESET}`
      : mcpStatus.connecting > 0
        ? `${DIM}mcp srv${RESET} ${YELLOW}${mcpStatus.connected}/${mcpStatus.total} ready, ${mcpStatus.connecting} connecting${mcpStatus.toolCount > 0 ? `, ${mcpStatus.toolCount} tools` : ''}${RESET}`
        : mcpStatus.error > 0
          ? `${DIM}mcp srv${RESET} ${BRIGHT_RED}${mcpStatus.connected}/${mcpStatus.total} ready, ${mcpStatus.error} err${mcpStatus.toolCount > 0 ? `, ${mcpStatus.toolCount} tools` : ''}${RESET}`
          : `${DIM}mcp srv${RESET} ${GREEN}${mcpStatus.connected}/${mcpStatus.total} ready${mcpStatus.toolCount > 0 ? `, ${mcpStatus.toolCount} tools` : ''}${RESET}`
  const compressionPart = compressionStatus
    ? `${DIM}|${RESET} ${YELLOW}${compressionStatus}${RESET}`
    : ''
  const right = `${DIM}tools${RESET} ${toolsEnabled ? `${GREEN}on${RESET}` : `${RED}off${RESET}`} ${DIM}|${RESET} ${DIM}skills${RESET} ${skillsEnabled ? `${GREEN}on${RESET}` : `${RED}off${RESET}`} ${DIM}|${RESET} ${mcpSummary}${backgroundSummary}${compressionPart}`
  const gap = Math.max(1, width - stripAnsi(left).length - stripAnsi(right).length)
  return `${left}${' '.repeat(gap)}${right}`
}

export function renderSlashMenu(
  commands: SlashCommand[],
  selectedIndex: number,
): string {
  if (commands.length === 0) {
    return `${DIM}no matching slash commands${RESET}`
  }

  return [
    `${DIM}commands${RESET}`,
    ...commands.map((command, index) => {
      const usage = padPlain(command.usage, 24)
      const prefix =
        index === selectedIndex
          ? `${REVERSE} ${usage} ${RESET}`
          : ` ${usage} `
      return `${prefix} ${DIM}${truncatePlain(command.description, 60)}${RESET}`
    }),
  ].join('\n')
}

type PermissionPromptRenderOptions = {
  expanded?: boolean
  scrollOffset?: number
  selectedChoiceIndex?: number
  feedbackMode?: boolean
  feedbackInput?: string
}

function flattenDetailLines(details: string[]): string[] {
  const lines: string[] = []
  details.forEach((detail, index) => {
    if (index > 0) {
      lines.push('')
    }
    lines.push(...detail.split('\n'))
  })
  return lines
}

function sliceVisibleDetails(
  detailLines: string[],
  expanded: boolean,
  scrollOffset: number,
): { lines: string[]; maxScroll: number; hiddenCount: number } {
  if (!expanded) {
    const collapsedLimit = 16
    if (detailLines.length <= collapsedLimit) {
      return { lines: detailLines, maxScroll: 0, hiddenCount: 0 }
    }
    return {
      lines: detailLines.slice(0, collapsedLimit),
      maxScroll: 0,
      hiddenCount: detailLines.length - collapsedLimit,
    }
  }

  const rows = process.stdout.rows ?? 40
  const expandedWindow = Math.max(8, rows - 20)
  const maxScroll = Math.max(0, detailLines.length - expandedWindow)
  const offset = Math.max(0, Math.min(scrollOffset, maxScroll))
  const start = offset
  const end = Math.min(detailLines.length, start + expandedWindow)
  return {
    lines: detailLines.slice(start, end),
    maxScroll,
    hiddenCount: 0,
  }
}

export function getPermissionPromptMaxScrollOffset(
  request: PermissionRequest,
  options: PermissionPromptRenderOptions = {},
): number {
  const details =
    request.kind === 'edit'
      ? colorizeEditPermissionDetails(request.details)
      : request.details
  const detailLines = flattenDetailLines(details)
  const expanded = options.expanded ?? false
  if (!expanded) {
    return 0
  }
  const rows = process.stdout.rows ?? 40
  const expandedWindow = Math.max(8, rows - 20)
  return Math.max(0, detailLines.length - expandedWindow)
}

export function renderPermissionPrompt(
  request: PermissionRequest,
  options: PermissionPromptRenderOptions = {},
): string {
  const details =
    request.kind === 'edit'
      ? colorizeEditPermissionDetails(request.details)
      : request.details
  const expanded = options.expanded ?? false
  const scrollOffset = options.scrollOffset ?? 0
  const selectedChoiceIndex = options.selectedChoiceIndex ?? 0
  const feedbackMode = options.feedbackMode ?? false
  const feedbackInput = options.feedbackInput ?? ''
  const detailLines = flattenDetailLines(details)
  const {
    lines: visibleDetailLines,
    maxScroll,
    hiddenCount,
  } = sliceVisibleDetails(detailLines, expanded, scrollOffset)

  const promptLines = [
    `${YELLOW}${BOLD}Approval Required${RESET}`,
    `${BOLD}${request.summary}${RESET}`,
    ...visibleDetailLines,
  ]

  if (request.kind === 'edit') {
    if (!expanded && hiddenCount > 0) {
      promptLines.push(
        `${DIM}... ${hiddenCount} more line(s) hidden${RESET}`,
        `${DIM}Ctrl+O expand full diff${RESET}`,
      )
    } else if (expanded) {
      promptLines.push(
        `${DIM}Ctrl+O collapse | Wheel/PgUp/PgDn/Alt+Up/Alt+Down scroll (${Math.max(
          0,
          Math.min(scrollOffset, maxScroll),
        )}/${maxScroll})${RESET}`,
      )
    }
  }

  return [
    ...promptLines,
    '',
    ...(feedbackMode
      ? [
          `${YELLOW}${BOLD}Reject With Guidance${RESET}`,
          `${DIM}Type feedback for model, Enter submit, Esc back${RESET}`,
          `> ${feedbackInput}`,
        ]
      : request.choices.map((choice, index) => {
          const selected = index === selectedChoiceIndex
          const prefix = selected ? `${REVERSE}>${RESET}` : ' '
          return `${prefix} ${choice.label}`
        })),
    '',
    `${DIM}Use Up/Down to select, Enter confirm, Esc deny once${RESET}`,
  ].join('\n')
}

type DiffLineKind = 'meta' | 'add' | 'remove' | 'context'

type StyledDiffLine = {
  raw: string
  kind: DiffLineKind
  emphasisRange?: { start: number; end: number }
}

function isUnifiedDiffHeader(line: string): boolean {
  return (
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('@@ ')
  )
}

function classifyDiffLine(line: string): DiffLineKind {
  if (isUnifiedDiffHeader(line)) {
    return 'meta'
  }

  if (line.startsWith('+')) {
    return 'add'
  }

  if (line.startsWith('-')) {
    return 'remove'
  }

  return 'context'
}

function computeChangedRange(
  removedText: string,
  addedText: string,
): { remove: { start: number; end: number }; add: { start: number; end: number } } | null {
  if (!removedText || !addedText) {
    return null
  }

  let prefix = 0
  const maxPrefix = Math.min(removedText.length, addedText.length)
  while (
    prefix < maxPrefix &&
    removedText[prefix] === addedText[prefix]
  ) {
    prefix += 1
  }

  let removedSuffix = removedText.length - 1
  let addedSuffix = addedText.length - 1
  while (
    removedSuffix >= prefix &&
    addedSuffix >= prefix &&
    removedText[removedSuffix] === addedText[addedSuffix]
  ) {
    removedSuffix -= 1
    addedSuffix -= 1
  }

  const removeRange = { start: prefix, end: removedSuffix + 1 }
  const addRange = { start: prefix, end: addedSuffix + 1 }
  if (removeRange.start >= removeRange.end || addRange.start >= addRange.end) {
    return null
  }

  return {
    remove: removeRange,
    add: addRange,
  }
}

function applyWordEmphasis(
  content: string,
  color: string,
  emphasisRange?: { start: number; end: number },
): string {
  if (!emphasisRange) {
    return `${color}${content}${RESET}`
  }

  const start = Math.max(0, Math.min(content.length, emphasisRange.start))
  const end = Math.max(start, Math.min(content.length, emphasisRange.end))
  if (start === end) {
    return `${color}${content}${RESET}`
  }

  const before = content.slice(0, start)
  const changed = content.slice(start, end)
  const after = content.slice(end)
  return [
    `${color}${before}`,
    `${BOLD}${changed}${RESET}`,
    `${color}${after}${RESET}`,
  ].join('')
}

function renderStyledDiffLine(line: StyledDiffLine): string {
  if (line.raw.trim() === '') {
    return line.raw
  }

  if (line.kind === 'meta') {
    return `${CYAN}${BOLD}${line.raw}${RESET}`
  }

  if (line.kind === 'add' || line.kind === 'remove') {
    const sign = line.raw.slice(0, 1)
    const content = line.raw.slice(1)
    const color = line.kind === 'add' ? BRIGHT_GREEN : BRIGHT_RED
    const emphasized = applyWordEmphasis(content, color, line.emphasisRange)
    return `${color}${sign}${RESET}${emphasized}`
  }

  if (line.raw.startsWith('... (')) {
    return `${DIM}${line.raw}${RESET}`
  }

  return `${DIM}${line.raw}${RESET}`
}

function colorizeUnifiedDiffBlock(block: string): string {
  const lines = block.split('\n')
  const styled: StyledDiffLine[] = lines.map(raw => ({
    raw,
    kind: classifyDiffLine(raw),
  }))

  // Pair adjacent removed/added lines and emphasize changed word spans.
  for (let i = 0; i < styled.length; i += 1) {
    if (styled[i]?.kind !== 'remove') {
      continue
    }

    let removeEnd = i
    while (removeEnd < styled.length && styled[removeEnd]?.kind === 'remove') {
      removeEnd += 1
    }

    let addEnd = removeEnd
    while (addEnd < styled.length && styled[addEnd]?.kind === 'add') {
      addEnd += 1
    }

    const removeCount = removeEnd - i
    const addCount = addEnd - removeEnd
    const pairCount = Math.min(removeCount, addCount)
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const removeLine = styled[i + pairIndex]
      const addLine = styled[removeEnd + pairIndex]
      if (!removeLine || !addLine) {
        continue
      }

      const removedText = removeLine.raw.slice(1)
      const addedText = addLine.raw.slice(1)
      const ranges = computeChangedRange(removedText, addedText)
      if (!ranges) {
        continue
      }

      removeLine.emphasisRange = ranges.remove
      addLine.emphasisRange = ranges.add
    }

    i = addEnd - 1
  }

  return styled.map(renderStyledDiffLine).join('\n')
}

function looksLikeDiffBlock(detail: string): boolean {
  return (
    detail.includes('\n') &&
    (detail.includes('--- a/') ||
      detail.includes('+++ b/') ||
      detail.includes('@@ '))
  )
}

function colorizeEditPermissionDetails(details: string[]): string[] {
  return details.map(detail => {
    if (looksLikeDiffBlock(detail)) {
      return colorizeUnifiedDiffBlock(detail)
    }
    return detail
  })
}
