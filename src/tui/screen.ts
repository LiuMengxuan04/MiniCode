import process from 'node:process'

const ENTER_ALT_SCREEN = '[?1049h'
const EXIT_ALT_SCREEN = '[?1049l'
const ERASE_SCREEN_AND_HOME = '[2J[H'
const ENABLE_MOUSE_TRACKING =
  '[?1000h' +
  '[?1002h' +
  '[?1006h'
const DISABLE_MOUSE_TRACKING =
  '[?1006l' +
  '[?1002l' +
  '[?1000l'
export function hideCursor(): void {
  process.stdout.write('[?25l')
}

export function showCursor(): void {
  process.stdout.write('[?25h')
}

export function enterAlternateScreen(): void {
  process.stdout.write(
    DISABLE_MOUSE_TRACKING + ENTER_ALT_SCREEN + ERASE_SCREEN_AND_HOME + ENABLE_MOUSE_TRACKING,
  )
}

export function exitAlternateScreen(): void {
  process.stdout.write(DISABLE_MOUSE_TRACKING + EXIT_ALT_SCREEN)
}

export function clearScreen(): void {
  // Softer redraw than full clear to reduce visible flicker.
  process.stdout.write('[H[J')
}
