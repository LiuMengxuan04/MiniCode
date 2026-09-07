import { randomUUID } from 'node:crypto'
import type { AgentTurnResult } from '../types.js'
import type { TurnRequest } from '../runtime/turn-runner.js'

export const DEFAULT_LOOP_INTERVAL = 10 * 60_000
export const MAX_LOOP_INTERVAL = 2_147_483_647

export function parseLoopRequest(body: string): { prompt: string; intervalMs: number } {
  const trimmed = body.trim()
  if (!trimmed) throw new Error('Usage: /loop [Nm|Nh] <prompt>')
  const [first] = trimmed.split(/\s+/)
  const interval = /^(\d+(?:\.\d+)?)(m|h)$/.exec(first!)
  let intervalMs = DEFAULT_LOOP_INTERVAL
  let prompt = trimmed
  if (interval) {
    intervalMs = Number(interval[1]) * (interval[2] === 'h' ? 3_600_000 : 60_000)
    prompt = trimmed.slice(first!.length).trim()
  } else if (/^[+-]?(?:\d|\.\d)|^(?:Infinity|NaN)(?:m|h)?$/i.test(first!)) {
    throw new Error('Invalid interval. Use minutes (Nm) or hours (Nh), at least 1 minute.')
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000 || intervalMs > MAX_LOOP_INTERVAL) {
    throw new Error('Loop interval must be at least 1 minute and fit a single timer (at most 2147483647 ms).')
  }
  if (!prompt) throw new Error('Usage: /loop [Nm|Nh] <prompt>')
  return { prompt, intervalMs }
}

export type LoopDocument = {
  id: string
  prompt: string
  intervalMs: number
  status: 'active' | 'paused'
  nextRunAt?: number
  stopReason?: string
}

export type LoopClock = {
  now: () => number
  setTimeout: (callback: () => void, delay: number) => unknown
  clearTimeout: (timer: unknown) => void
}

const realClock: LoopClock = {
  now: Date.now,
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
}

/** One process-local fixed-delay timer. Busy time never creates a catch-up queue. */
export class LoopScheduler {
  private document?: LoopDocument
  private timer?: unknown
  private pending = false
  private current?: { controller: AbortController; done: Promise<void> }
  private generation = 0
  waitingForAnswer = false

  constructor(private readonly options: {
    runTurn: (request: TurnRequest) => Promise<AgentTurnResult>
    busy: () => boolean
    notice: (message: string) => void
    settleWorkers: () => Promise<void>
    clock?: LoopClock
  }) {}

  private get clock(): LoopClock { return this.options.clock ?? realClock }
  get running(): boolean { return !!this.current }
  get enabled(): boolean { return this.running || this.waitingForAnswer || this.document?.status === 'active' }
  get hasPendingTrigger(): boolean { return this.pending }
  getSnapshot(): LoopDocument | undefined { return this.document ? { ...this.document } : undefined }
  whenIdle(): Promise<void> { return this.current?.done ?? Promise.resolve() }

  create(prompt: string, intervalMs: number): void {
    if (this.document || this.current) throw new Error('A Loop already exists. Use /loop stop first.')
    if (!prompt.trim() || !Number.isFinite(intervalMs) || intervalMs < 60_000 || intervalMs > MAX_LOOP_INTERVAL) {
      throw new Error('A Loop needs a prompt and a valid interval of at least 1 minute.')
    }
    this.generation++
    this.document = { id: randomUUID(), prompt, intervalMs, status: 'active' }
    this.pending = true
    this.kick()
  }

  kick(): void {
    if (!this.pending || this.current || this.waitingForAnswer || this.options.busy() || this.document?.status !== 'active') return
    this.pending = false
    this.launch({ role: 'user', internal: 'loop', content: this.document.prompt })
  }

  answer(content: string): void {
    if (!this.waitingForAnswer || this.current || this.document?.status !== 'active') {
      throw new Error('Loop is not ready for an answer.')
    }
    this.waitingForAnswer = false
    this.launch({ role: 'user', content })
  }

  pauseAfterFailure(reason: string): void {
    if (!this.document) return
    this.cancelTimer()
    this.pending = false
    this.document = { ...this.document, status: 'paused', nextRunAt: undefined, stopReason: reason }
    this.options.notice(`Loop paused: ${reason} Use /loop stop before creating another.`)
  }

  async stop(): Promise<void> {
    this.generation++
    this.cancelTimer()
    this.pending = false
    this.waitingForAnswer = false
    this.document = undefined
    this.current?.controller.abort(new Error('Loop stopped by user.'))
    await this.whenIdle()
  }

  format(): string {
    const loop = this.document
    if (!loop) return this.current ? 'Loop is stopping...' : 'No Loop. Use /loop [Nm|Nh] <prompt>.'
    return [
      `Loop: ${loop.status}${this.waitingForAnswer ? ' (waiting for your answer)' : this.current ? ' (running)' : this.pending ? ' (pending until idle)' : ''}`,
      `Interval: ${loop.intervalMs / 60_000}m after completion`, loop.prompt, loop.stopReason ?? '',
    ].filter(Boolean).join('\n')
  }

  private launch(input: TurnRequest['input']): void {
    const generation = this.generation
    const controller = new AbortController()
    const done = Promise.resolve().then(async () => {
      let scheduleNext = false
      try {
        if (controller.signal.aborted || generation !== this.generation) return
        const result = await this.options.runTurn({ input, mode: 'loop', signal: controller.signal })
        if (controller.signal.aborted || generation !== this.generation) return
        if (result.outcome === 'awaiting_user') {
          this.waitingForAnswer = true
          this.options.notice('Loop is waiting for your answer.')
        } else if (result.outcome === 'final') {
          scheduleNext = true
        } else {
          this.pauseAfterFailure(result.error ?? result.outcome)
        }
      } catch (error) {
        if (!controller.signal.aborted && generation === this.generation) {
          this.pauseAfterFailure(error instanceof Error ? error.message : String(error))
        }
      } finally {
        controller.abort(new Error('Loop turn finished.'))
        await this.options.settleWorkers()
        if (scheduleNext && generation === this.generation && this.document?.status === 'active') {
          // Fixed delay starts after the turn, saving, and worker settlement.
          const delay = this.document.intervalMs
          this.document.nextRunAt = this.clock.now() + delay
          this.timer = this.clock.setTimeout(() => {
            if (generation !== this.generation || this.document?.status !== 'active') return
            this.timer = undefined
            this.document.nextRunAt = undefined
            this.pending = true
            this.kick()
          }, delay)
        }
      }
    }).finally(() => {
      this.current = undefined
      this.kick()
    })
    this.current = { controller, done }
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = undefined
  }
}
