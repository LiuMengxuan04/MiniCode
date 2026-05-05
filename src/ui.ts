export {
  clearScreen,
  enterAlternateScreen,
  exitAlternateScreen,
  getPermissionPromptMaxScrollOffset,
  getTranscriptMaxScrollOffset,
  getTranscriptWindowSize,
  hideCursor,
  renderBanner,
  renderContextBadge,
  renderFooterBar,
  renderInputPrompt,
  renderPanel,
  renderPermissionPrompt,
  renderSlashMenu,
  renderStatusLine,
  renderToolPanel,
  renderTranscript,
  showCursor,
  extractSelectedText,
  renderTranscriptLines,
} from './tui/index.js'

export type { TranscriptEntry } from './tui/index.js'
export type { TranscriptSelection } from './tui/index.js'
