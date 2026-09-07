import { abortableDelay } from '../abort.js'
import type { AgentTurnResult } from '../types.js'
import type { TurnRequest } from '../runtime/turn-runner.js'
import { GoalManager } from './manager.js'

type GoalControllerOptions = {
  runTurn: (request: TurnRequest) => Promise<AgentTurnResult>
  recordAnswer: (input: TurnRequest['input']) => Promise<void>
  notice: (message: string) => void
  settleWorkers: () => Promise<void>
}

/** A final is a turn boundary. Only explicit state changes finish a Goal. */
export class GoalController {
  private current?: { controller: AbortController; done: Promise<void> }
  waitingForAnswer = false

  constructor(readonly manager: GoalManager, private readonly options: GoalControllerOptions) {}
  get running(): boolean { return !!this.current }
  get enabled(): boolean { return this.running || this.waitingForAnswer || this.manager.getSnapshot()?.status === 'active' }
  whenIdle(): Promise<void> { return this.current?.done ?? Promise.resolve() }

  create(description: string): void {
    this.manager.create(description)
    this.start({ role: 'user', content: `/goal ${description}` })
  }

  resume(): void {
    if (this.running) throw new Error('Goal is still running or stopping.')
    if (this.waitingForAnswer) throw new Error('Answer the pending question before resuming the Goal.')
    this.manager.resume()
    this.start(this.continuation())
  }

  async answer(content: string): Promise<void> {
    if (this.running) throw new Error('Wait for the current turn to stop.')
    const input: TurnRequest['input'] = { role: 'user', content }
    if (this.manager.getSnapshot()?.status === 'paused') {
      await this.options.recordAnswer(input)
      this.waitingForAnswer = false
      this.options.notice('Answer saved. Goal remains paused; use /goal resume to continue.')
    } else {
      this.waitingForAnswer = false
      this.start(input)
    }
  }

  async pause(reason = 'Paused by user.'): Promise<void> {
    this.manager.pause(reason)
    this.current?.controller.abort(new Error(reason))
    await this.whenIdle()
  }

  async clear(): Promise<void> {
    await this.pause('Goal cleared.')
    this.manager.clear()
    this.waitingForAnswer = false
  }

  private continuation(): TurnRequest['input'] {
    return { role: 'user', internal: 'goal', content: 'Continue the active Goal using its latest state and Plan. Take the next concrete step, ask_user if needed, or explicitly report completed/blocked.' }
  }

  private start(input: TurnRequest['input']): void {
    if (this.current) throw new Error('Goal is still running.')
    const controller = new AbortController()
    const done = Promise.resolve().then(async () => {
      let nextInput = input
      let emptyTurns = 0
      try {
        while (!controller.signal.aborted && this.manager.getSnapshot()?.status === 'active') {
          const result = await this.options.runTurn({ input: nextInput, mode: 'goal', signal: controller.signal })
          if (result.outcome === 'awaiting_user') {
            this.waitingForAnswer = true
            this.options.notice('Goal is waiting for your answer.')
            break
          }
          if (controller.signal.aborted) break
          if (result.outcome === 'failed' || result.outcome === 'max_steps' || result.outcome === 'aborted') {
            this.manager.pause(result.error ?? `Goal stopped: ${result.outcome}.`, true)
            break
          }
          if (this.manager.getSnapshot()?.status !== 'active') break
          if (result.outcome !== 'final') {
            this.manager.pause('Goal stopped without an ordinary final.')
            break
          }
          emptyTurns = nextInput.internal && result.toolCalls === 0 ? emptyTurns + 1 : 0
          if (emptyTurns >= 3) {
            this.manager.pause('Paused after 3 automatic turns without a tool call.')
            break
          }
          nextInput = this.continuation()
          await abortableDelay(0, controller.signal)
        }
      } catch (error) {
        if (!controller.signal.aborted) this.manager.pause(error instanceof Error ? error.message : String(error), true)
      } finally {
        controller.abort(new Error('Goal execution stopped.'))
        await this.options.settleWorkers()
        const goal = this.manager.getSnapshot()
        if (goal && !this.waitingForAnswer) {
          this.options.notice(`Goal ${goal.status}: ${goal.completion?.summary ?? goal.stopReason ?? ''}`)
        }
      }
    }).finally(() => { this.current = undefined })
    this.current = { controller, done }
  }
}
