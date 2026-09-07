import type { AgentTurnResult, ChatMessage } from '../types.js'

export type TurnRequest = {
  input: Extract<ChatMessage, { role: 'user' }>
  mode?: 'goal' | 'loop'
  signal?: AbortSignal
}

/** One root turn at a time, including tool settlement and message saving. */
export class TurnRunner {
  private current?: { controller: AbortController; done: Promise<AgentTurnResult> }
  awaitingUser = false

  get busy(): boolean { return this.current !== undefined }

  run(work: (signal: AbortSignal) => Promise<AgentTurnResult>, parentSignal?: AbortSignal): Promise<AgentTurnResult> {
    if (this.current) return Promise.reject(new Error('A root turn is still running.'))
    const controller = new AbortController()
    const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal
    this.awaitingUser = false
    const done = Promise.resolve().then(() => work(signal)).then(result => {
      this.awaitingUser = result.outcome === 'awaiting_user'
      return result
    }).finally(() => { this.current = undefined })
    this.current = { controller, done }
    return done
  }

  async stop(reason = 'Execution stopped by user'): Promise<void> {
    const current = this.current
    if (!current) return
    current.controller.abort(new Error(reason))
    await current.done.catch(() => {})
  }
}
