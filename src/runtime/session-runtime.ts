import { LoopScheduler, parseLoopRequest, type LoopClock } from '../loop/scheduler.js'
import type { PlanManager } from '../plan/manager.js'
import { GoalManager } from '../goal/manager.js'
import { GoalController } from '../goal/controller.js'
import { formatGoal, goalContext } from '../goal/context.js'
import { createGoalTools } from '../tools/goal.js'
import { ToolRegistry } from '../tool.js'
import type { AgentTurnResult } from '../types.js'
import { TurnRunner, type TurnRequest } from './turn-runner.js'

export class SessionRuntime {
  readonly turns = new TurnRunner()
  readonly goal: GoalController
  readonly loop: LoopScheduler

  constructor(private readonly options: {
    plan: PlanManager
    tools: ToolRegistry
    execute: (request: TurnRequest) => Promise<AgentTurnResult>
    recordAnswer: (input: TurnRequest['input']) => Promise<void>
    notice: (message: string) => void
    settleWorkers: () => Promise<void>
    isBusy?: () => boolean
    loopClock?: LoopClock
  }) {
    this.goal = new GoalController(new GoalManager(options.plan), {
      runTurn: request => this.run(request),
      recordAnswer: options.recordAnswer,
      notice: options.notice,
      settleWorkers: options.settleWorkers,
    })
    this.loop = new LoopScheduler({
      runTurn: request => this.run(request),
      busy: () => this.turns.busy || this.turns.awaitingUser || this.goal.enabled || !!options.isBusy?.(),
      notice: options.notice, settleWorkers: options.settleWorkers, clock: options.loopClock,
    })
  }

  toolsFor(mode?: TurnRequest['mode']): ToolRegistry {
    return mode === 'goal'
      ? new ToolRegistry([...this.options.tools.list(), ...createGoalTools(this.goal.manager)])
      : this.options.tools
  }

  contextFor(mode?: TurnRequest['mode']): string {
    if (mode === 'goal') return goalContext(this.goal.manager)
    if (mode === 'loop') return [
      '<current_loop>', JSON.stringify(this.loop.getSnapshot()), '</current_loop>',
      'Execute this recurring prompt once, then return a final. The next run is scheduled after the interval.',
      'Use the shared Plan if useful. Do not create or update a Goal. Ask the user when input is needed.',
      'The user can stop this Loop with /loop stop. There is no model-side stop tool in this MVP.',
    ].join('\n')
    return ''
  }

  async submit(content: string): Promise<void> {
    if (this.loop.waitingForAnswer) {
      this.turns.awaitingUser = false
      this.loop.answer(content)
      return
    }
    if (this.loop.running) throw new Error('Loop is running. Use /loop stop before starting another turn.')
    if (this.goal.waitingForAnswer) {
      await this.goal.answer(content)
      this.turns.awaitingUser = false
      return
    }
    if (this.goal.enabled) throw new Error('Goal is running. Use /goal pause before starting another turn.')
    await this.run({ input: { role: 'user', content } })
  }

  async command(input: string): Promise<string | null> {
    const loopMatch = /^\/loop(?:\s+([\s\S]*))?$/.exec(input.trim())
    if (loopMatch) {
      const body = loopMatch[1]?.trim() ?? ''
      if (!body) return this.loop.format()
      if (body === 'stop') {
        const wasWaiting = this.loop.waitingForAnswer
        await this.loop.stop()
        if (wasWaiting) this.turns.awaitingUser = false
        return 'Loop stopped. Plan is retained.'
      }
      if (/^(stop|pause|resume|status)(?:\s|$)/.test(body)) return 'Usage: /loop, /loop [Nm|Nh] <prompt>, or /loop stop.'
      if (this.goal.enabled) throw new Error('Pause or clear the Goal before starting a Loop; answer or clear any pending Goal question.')
      const request = parseLoopRequest(body)
      this.loop.create(request.prompt, request.intervalMs)
      return this.loop.format()
    }
    const match = /^\/goal(?:\s+([\s\S]*))?$/.exec(input.trim())
    if (!match) return null
    const body = match[1]?.trim() ?? ''
    const [command, ...rest] = body.split(/\s+/)
    const argument = rest.join(' ')
    if (!body || body === 'status') return formatGoal(this.goal.manager, this.goal.waitingForAnswer)
    if (command === 'pause') {
      await this.goal.pause(argument || 'Paused by user.')
    } else if (command === 'clear' && !argument) {
      const wasWaiting = this.goal.waitingForAnswer
      await this.goal.clear()
      if (wasWaiting) this.turns.awaitingUser = false
      return 'Goal cleared. Plan is retained.'
    } else if (command === 'resume' && !argument) {
      this.assertIdle()
      this.goal.resume()
    } else if (['update', 'edit', 'add', 'limit'].includes(command!)) {
      return 'This MVP keeps the original objective unchanged. Use /goal clear, then /goal <description>.'
    } else if (['status', 'resume', 'clear'].includes(command!)) {
      return `Usage: /goal ${command}`
    } else {
      this.assertIdle()
      this.goal.create(body)
    }
    return formatGoal(this.goal.manager, this.goal.waitingForAnswer)
  }

  async stop(): Promise<void> {
    await this.loop.stop()
    await this.goal.pause('Execution stopped by user.')
    await this.turns.stop()
    await this.options.settleWorkers()
  }

  async reset(): Promise<void> {
    await this.stop()
    await this.goal.clear()
    this.turns.awaitingUser = false
  }

  notifyIdle(): void { this.loop.kick() }

  private assertIdle(): void {
    if (this.loop.enabled) throw new Error('Stop the Loop before starting or resuming a Goal.')
    if (this.turns.busy || this.goal.running || this.options.isBusy?.()) throw new Error('Wait for the current turn to stop.')
    if (this.turns.awaitingUser && !this.goal.waitingForAnswer) throw new Error('Answer the pending question first.')
  }

  private run(request: TurnRequest): Promise<AgentTurnResult> {
    return this.turns.run(signal => this.options.execute({ ...request, signal }), request.signal).then(result => {
      if (!request.mode && this.loop.enabled && ['failed', 'max_steps', 'aborted'].includes(result.outcome)) {
        this.loop.pauseAfterFailure(result.error ?? result.outcome)
      }
      return result
    }).catch(error => {
      if (!request.mode && this.loop.enabled) this.loop.pauseAfterFailure(error instanceof Error ? error.message : String(error))
      throw error
    }).finally(() => this.loop.kick())
  }
}
