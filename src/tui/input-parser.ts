type ParsedKeyName =
  | 'return'
  | 'tab'
  | 'backspace'
  | 'delete'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'pageup'
  | 'pagedown'
  | 'home'
  | 'end'
  | 'escape'

type ParsedInputEvent =
  | {
      kind: 'key'
      name: ParsedKeyName
      ctrl: boolean
      meta: boolean
    }
  | {
      kind: 'text'
      text: string
      ctrl: boolean
      meta: boolean
    }
  | {
      kind: 'wheel'
      direction: 'up' | 'down'
    }
  | {
      kind: 'mouse'
      x: number
      y: number
      button: 'left' | 'middle' | 'right'
      action: 'press' | 'release' | 'drag'
    }

type ParseResult = {
  events: ParsedInputEvent[]
  rest: string
}

const ESC = '\u001b'
const CTRL_CHAR_TO_NAME: Record<string, string> = {
  '\u0001': 'a',
  '\u0003': 'c',
  '\u0005': 'e',
  '\u000e': 'n',
  '\u000f': 'o',
  '\u0010': 'p',
  '\u0015': 'u',
}

function maybeNeedMoreForEscapeSequence(input: string): boolean {
  if (!input.startsWith(ESC)) return false

  if (input === ESC) return true
  // Wait only for known-incomplete CSI prefixes.
  // If an unexpected character appears (for example "\u001b[\r"), do not
  // block the parser forever; let parseEscapeSequence fall back.
  if (input === '\u001b[') return true
  if (/^\u001b\[[<\d;?]*$/.test(input)) {
    return true
  }
  if (input.startsWith('\u001bO') && input.length < 3) {
    return true
  }

  return false
}

function parseEscapeSequence(input: string): {
  event: ParsedInputEvent | null
  length: number
} | null {
  let match = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])/.exec(input)
  if (match) {
    const button = Number(match[1])
    const x = Number(match[2]) - 1
    const y = Number(match[3]) - 1
    const released = match[4] === 'm'
    const length = match[0].length
    if ((button & 0x43) === 0x40) {
      return { event: { kind: 'wheel', direction: 'up' }, length }
    }
    if ((button & 0x43) === 0x41) {
      return { event: { kind: 'wheel', direction: 'down' }, length }
    }
    const btnCode = button & 0x43
    const isDrag = (button & 0x20) !== 0
    const buttonName: 'left' | 'middle' | 'right' =
      btnCode === 0 ? 'left' : btnCode === 1 ? 'middle' : 'right'
    return {
      event: {
        kind: 'mouse',
        x,
        y,
        button: buttonName,
        action: released ? 'release' : isDrag ? 'drag' : 'press',
      },
      length,
    }
  }

  if (/^\u001b\[M.../.test(input)) {
    const seq = input.slice(0, 6)
    const button = seq.charCodeAt(3) - 32
    if ((button & 0x43) === 0x40) {
      return { event: { kind: 'wheel', direction: 'up' }, length: 6 }
    }
    if ((button & 0x43) === 0x41) {
      return { event: { kind: 'wheel', direction: 'down' }, length: 6 }
    }
    return { event: null, length: 6 }
  }

  match = /^\u001b\[(?:1;(\d+))?([ABCDHF])/.exec(input)
  if (match) {
    const modifier = Number(match[1] ?? '1')
    const meta = modifier === 3
    const ctrl = modifier === 5
    const nameMap: Record<string, ParsedKeyName> = {
      A: 'up',
      B: 'down',
      C: 'right',
      D: 'left',
      H: 'home',
      F: 'end',
    }
    return {
      event: {
        kind: 'key',
        name: nameMap[match[2]],
        ctrl,
        meta,
      },
      length: match[0].length,
    }
  }

  match = /^\u001b\[(\d+)~/.exec(input)
  if (match) {
    const nameMap: Record<string, ParsedKeyName> = {
      '1': 'home',
      '3': 'delete',
      '4': 'end',
      '5': 'pageup',
      '6': 'pagedown',
      '7': 'home',
      '8': 'end',
    }
    const name = nameMap[match[1]]
    if (!name) return { event: null, length: match[0].length }
    return {
      event: { kind: 'key', name, ctrl: false, meta: false },
      length: match[0].length,
    }
  }

  match = /^\u001bO([ABCDHF])/.exec(input)
  if (match) {
    const nameMap: Record<string, ParsedKeyName> = {
      A: 'up',
      B: 'down',
      C: 'right',
      D: 'left',
      H: 'home',
      F: 'end',
    }
    return {
      event: {
        kind: 'key',
        name: nameMap[match[1]],
        ctrl: false,
        meta: false,
      },
      length: match[0].length,
    }
  }

  if (input.startsWith('\u001b\t')) {
    return {
      event: { kind: 'key', name: 'tab', ctrl: false, meta: true },
      length: 2,
    }
  }

  if (input.length >= 2) {
    const char = input[1]
    if (char !== '[' && char !== 'O') {
      return {
        event: { kind: 'text', text: char, ctrl: false, meta: true },
        length: 2,
      }
    }
  }

  return {
    event: { kind: 'key', name: 'escape', ctrl: false, meta: false },
    length: 1,
  }
}

export function parseInputChunk(
  previousRest: string,
  chunk: Buffer | string,
): ParseResult {
  const input = previousRest + String(chunk)
  const events: ParsedInputEvent[] = []
  let index = 0

  while (index < input.length) {
    const remaining = input.slice(index)

    if (remaining[0] === ESC) {
      if (maybeNeedMoreForEscapeSequence(remaining)) {
        return { events, rest: remaining }
      }

      const parsed = parseEscapeSequence(remaining)
      if (parsed) {
        if (parsed.event) events.push(parsed.event)
        index += parsed.length
        continue
      }
    }

    const char = remaining[0]
    if (!char) break

    if (char === '\r' || char === '\n') {
      events.push({ kind: 'key', name: 'return', ctrl: false, meta: false })
      if (
        (char === '\r' && remaining[1] === '\n') ||
        (char === '\n' && remaining[1] === '\r')
      ) {
        index += 2
      } else {
        index += 1
      }
      continue
    }

    if (char === '\t') {
      events.push({ kind: 'key', name: 'tab', ctrl: false, meta: false })
      index += 1
      continue
    }

    if (char === '\u007f' || char === '\b') {
      events.push({ kind: 'key', name: 'backspace', ctrl: false, meta: false })
      index += 1
      continue
    }

    if (char >= '\u0001' && char <= '\u001a') {
      const name = CTRL_CHAR_TO_NAME[char]
      if (name) {
        events.push({ kind: 'text', text: name, ctrl: true, meta: false })
      }
      index += 1
      continue
    }

    if (char < ' ') {
      index += 1
      continue
    }

    events.push({ kind: 'text', text: char, ctrl: false, meta: false })
    index += 1
  }

  return { events, rest: '' }
}

export type { ParsedInputEvent }
