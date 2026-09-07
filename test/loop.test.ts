import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LoopScheduler, parseLoopRequest, type LoopClock } from '../src/loop/scheduler.js'
import { SessionRuntime } from '../src/runtime/session-runtime.js'
import { PlanManager } from '../src/plan/manager.js'
import { createUpdatePlanTool } from '../src/tools/plan.js'
import { askUserTool } from '../src/tools/ask-user.js'
import { ToolRegistry } from '../src/tool.js'
import { runAgentTurnWithOutcome } from '../src/agent-loop.js'
import type { AgentTurnResult, ChatMessage, ModelAdapter } from '../src/types.js'
import type { TurnRequest } from '../src/runtime/turn-runner.js'

class FakeClock implements LoopClock {
  time = 0
  private nextId = 0
  readonly timers = new Map<number, { at: number; callback: () => void }>()
  now = () => this.time
  setTimeout = (callback: () => void, delay: number) => {
    const id = ++this.nextId
    this.timers.set(id, { at: this.time + delay, callback })
    return id
  }
  clearTimeout = (id: unknown) => { this.timers.delete(id as number) }
  advance(ms: number) {
    this.time += ms
    for (const [id, timer] of this.timers) {
      if (timer.at <= this.time) { this.timers.delete(id); timer.callback() }
    }
  }
}

const final = (): AgentTurnResult => ({ messages: [], outcome: 'final', toolCalls: 0 })
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('Loop command interval parsing', () => {
  it('accepts default, minute and hour intervals and preserves a multiline prompt', () => {
    assert.deepEqual(parseLoopRequest('inspect results'), { prompt: 'inspect results', intervalMs: 600_000 })
    assert.deepEqual(parseLoopRequest('1m inspect\nthen report'), { prompt: 'inspect\nthen report', intervalMs: 60_000 })
    assert.deepEqual(parseLoopRequest('0.5h inspect'), { prompt: 'inspect', intervalMs: 1_800_000 })
  })

  it('rejects missing prompts, sub-minute, unsupported, nonfinite and overflowing intervals', () => {
    for (const input of ['', '1m', '0m x', '-1h x', '0.5m x', '1s x', 'NaNh x', 'Infinitym x', '999999999h x', '1e3m x']) {
      assert.throws(() => parseLoopRequest(input), undefined, input)
    }
  })
})

describe('LoopScheduler fixed-delay scheduling', () => {
  it('runs immediately and starts the interval only after the turn and worker settlement', async () => {
    const clock = new FakeClock()
    const first = deferred<AgentTurnResult>()
    const workers = deferred()
    let calls = 0
    const loop = new LoopScheduler({ clock, busy: () => false, notice: () => {},
      runTurn: async () => { calls++; return first.promise }, settleWorkers: () => workers.promise })
    loop.create('Inspect', 60_000)
    await Promise.resolve()
    assert.equal(calls, 1)
    clock.advance(180_000)
    assert.equal(clock.timers.size, 0)
    first.resolve(final())
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(clock.timers.size, 0, 'worker settlement is part of completion')
    workers.resolve()
    await loop.whenIdle()
    assert.equal(loop.getSnapshot()?.nextRunAt, 240_000)
    clock.advance(59_999)
    assert.equal(calls, 1)
    clock.advance(1)
    await loop.whenIdle()
    assert.equal(calls, 2)
    await loop.stop()
  })

  it('coalesces busy time into one pending trigger without a catch-up queue', async () => {
    const clock = new FakeClock()
    let busy = true
    let calls = 0
    const loop = new LoopScheduler({ clock, busy: () => busy, notice: () => {}, settleWorkers: async () => {},
      async runTurn() { calls++; return final() } })
    loop.create('Inspect', 60_000)
    clock.advance(600_000)
    assert.equal(calls, 0)
    assert.equal(loop.hasPendingTrigger, true)
    busy = false
    loop.kick()
    await loop.whenIdle()
    assert.equal(calls, 1)
    busy = true
    clock.advance(600_000)
    loop.kick()
    assert.equal(calls, 1)
    assert.equal(clock.timers.size, 0)
    busy = false
    loop.kick()
    loop.kick()
    await loop.whenIdle()
    assert.equal(calls, 2)
    assert.equal(clock.timers.size, 1)
    await loop.stop()
  })

  it('invalidates stale timer callbacks after stop and recreation', async () => {
    const clock = new FakeClock()
    const prompts: string[] = []
    const loop = new LoopScheduler({ clock, busy: () => false, notice: () => {}, settleWorkers: async () => {},
      async runTurn(request) { prompts.push(request.input.content); return final() } })
    loop.create('old', 60_000)
    await loop.whenIdle()
    const stale = [...clock.timers.values()][0].callback
    await loop.stop()
    stale()
    assert.deepEqual(prompts, ['old'])
    loop.create('new', 60_000)
    await loop.whenIdle()
    stale()
    clock.advance(60_000)
    await loop.whenIdle()
    assert.deepEqual(prompts, ['old', 'new', 'new'])
    await loop.stop()
  })

  it('waits for a user answer without arming timers or synthesizing replies', async () => {
    const clock = new FakeClock()
    const inputs: TurnRequest['input'][] = []
    const loop = new LoopScheduler({ clock, busy: () => false, notice: () => {}, settleWorkers: async () => {},
      async runTurn(request) {
        inputs.push(request.input)
        return { ...final(), outcome: inputs.length === 1 ? 'awaiting_user' : 'final' }
      } })
    loop.create('Inspect', 60_000)
    await loop.whenIdle()
    clock.advance(3600_000)
    assert.equal(loop.waitingForAnswer, true)
    assert.equal(inputs.length, 1)
    assert.equal(clock.timers.size, 0)
    loop.answer('README.md')
    await loop.whenIdle()
    assert.deepEqual(inputs[1], { role: 'user', content: 'README.md' })
    assert.equal(clock.timers.size, 1)
    await loop.stop()
  })

  it('pauses on failed, aborted, controlled-stop and max-step outcomes', async () => {
    for (const outcome of ['failed', 'aborted', 'max_steps', 'controlled_stop'] as const) {
      const clock = new FakeClock()
      let calls = 0
      const loop = new LoopScheduler({ clock, busy: () => false, notice: () => {}, settleWorkers: async () => {},
        async runTurn() { calls++; return { ...final(), outcome } } })
      loop.create('Inspect', 60_000)
      await loop.whenIdle()
      assert.equal(loop.getSnapshot()?.status, 'paused')
      assert.throws(() => loop.create('new', 60_000), /already exists/)
      clock.advance(3600_000)
      assert.equal(calls, 1)
      await loop.stop()
    }
  })

  it('keeps stopping exclusive until a started tool and save have settled', async () => {
    const finished = deferred<AgentTurnResult>()
    const started = deferred<AbortSignal>()
    const loop = new LoopScheduler({ busy: () => false, notice: () => {}, settleWorkers: async () => {},
      async runTurn(request) { started.resolve(request.signal!); return finished.promise } })
    loop.create('Inspect', 60_000)
    const signal = await started.promise
    const stop = loop.stop()
    assert.equal(signal.aborted, true)
    assert.equal(loop.enabled, true)
    assert.throws(() => loop.create('new', 60_000), /already exists/)
    finished.resolve(final())
    await stop
    assert.equal(loop.enabled, false)
    assert.equal(loop.getSnapshot(), undefined)
  })
})

function runtimeHarness(model: ModelAdapter, executeOverride?: (request: TurnRequest) => Promise<AgentTurnResult>) {
  const clock = new FakeClock()
  const plan = new PlanManager('loop-test')
  const tools = new ToolRegistry([createUpdatePlanTool(plan), askUserTool])
  let messages: ChatMessage[] = []
  const runtime: SessionRuntime = new SessionRuntime({ plan, tools, loopClock: clock,
    notice: () => {}, settleWorkers: async () => {}, recordAnswer: async () => {},
    execute: executeOverride ?? (async request => {
      messages.push(request.input)
      const result = await runAgentTurnWithOutcome({ model, plan, messages,
        cwd: process.cwd(), tools: runtime.toolsFor(request.mode),
        runtimeContext: () => runtime.contextFor(request.mode), signal: request.signal,
        maxSteps: request.mode ? 50 : undefined, stopOnFatalToolError: !!request.mode })
      messages = result.messages
      return result
    }),
  })
  return { runtime, clock, plan }
}

describe('Loop integration and Goal exclusion', () => {
  it('uses Plan and the existing runner without exposing Goal context or tools', async () => {
    let calls = 0
    const h = runtimeHarness({ async next(messages, options) {
      calls++
      assert.ok(!options?.tools?.some(tool => ['get_goal', 'update_goal'].includes(tool.name)))
      assert.ok(!messages.some(message => message.role === 'system' && message.content.includes('<current_goal>')))
      if (calls === 1) return { type: 'tool_calls', calls: [{ id: 'plan', toolName: 'update_plan', input: { todos: [{ title: 'Inspect', status: 'pending' }] } }] }
      return { type: 'assistant', content: 'Done this time.' }
    } })
    await h.runtime.command('/loop 1m Inspect')
    await h.runtime.loop.whenIdle()
    assert.equal(calls, 2)
    assert.equal(h.plan.getSnapshot().todos.length, 1)
    await assert.rejects(h.runtime.command('/goal another'), /Stop the Loop/)
    await h.runtime.command('/loop stop')
    assert.equal(h.plan.getSnapshot().todos.length, 1)
    await h.runtime.reset()
  })

  it('blocks Loop while Goal is running or awaiting an answer, even after pause', async () => {
    const h = runtimeHarness({ async next() { return { type: 'tool_calls', calls: [{ id: 'ask', toolName: 'ask_user', input: { question: 'Which file?' } }] } } })
    await h.runtime.command('/goal Inspect')
    await assert.rejects(h.runtime.command('/loop Inspect'), /Pause or clear the Goal/)
    await h.runtime.goal.whenIdle()
    await h.runtime.command('/goal pause')
    await assert.rejects(h.runtime.command('/loop Inspect'), /pending Goal question/)
    await h.runtime.command('/goal clear')
    await h.runtime.command('/loop Inspect')
    await h.runtime.loop.whenIdle()
    await assert.rejects(h.runtime.command('/goal Inspect'), /Stop the Loop/)
    await h.runtime.reset()
  })

  it('continues a Loop question with a real user answer in Loop mode', async () => {
    let requests = 0
    const h = runtimeHarness({ async next(messages, options) {
      requests++
      assert.ok(!options?.tools?.some(tool => tool.name === 'update_goal'))
      if (requests === 1) return { type: 'tool_calls', calls: [{ id: 'question', toolName: 'ask_user', input: { question: 'Which file?' } }] }
      assert.ok(messages.some(message => message.role === 'user' && !message.internal && message.content === 'README.md'))
      return { type: 'assistant', content: 'Answer processed.' }
    } })
    await h.runtime.command('/loop 1m Inspect')
    await h.runtime.loop.whenIdle()
    assert.equal(h.runtime.loop.waitingForAnswer, true)
    assert.equal(h.clock.timers.size, 0)
    await h.runtime.submit('README.md')
    await h.runtime.loop.whenIdle()
    assert.equal(requests, 2)
    assert.equal(h.runtime.loop.waitingForAnswer, false)
    assert.equal(h.clock.timers.size, 1)
    await h.runtime.reset()
  })

  it('holds a due trigger during ordinary ask_user and runs once after its real answer', async () => {
    const calls: TurnRequest[] = []
    const h = runtimeHarness({ async next() { return { type: 'assistant', content: 'unused' } } }, async request => {
      calls.push(request)
      return { ...final(), outcome: request.input.content === 'Ask me' ? 'awaiting_user' : 'final' }
    })
    await h.runtime.submit('Ask me')
    await h.runtime.command('/loop 1m Inspect')
    h.clock.advance(600_000)
    assert.equal(calls.length, 1)
    await h.runtime.submit('My answer')
    await h.runtime.loop.whenIdle()
    assert.deepEqual(calls.map(call => call.mode), [undefined, undefined, 'loop'])
    await h.runtime.reset()
  })

  it('pauses Loop after an ordinary turn fails instead of dispatching its pending trigger', async () => {
    let runs = 0
    const h = runtimeHarness({ async next() { return { type: 'assistant', content: 'unused' } } }, async request => {
      runs++
      if (!request.mode) { h.clock.advance(60_000); throw new Error('Save failure') }
      return final()
    })
    await h.runtime.command('/loop 1m Inspect')
    await h.runtime.loop.whenIdle()
    await assert.rejects(h.runtime.submit('Ordinary turn'), /Save failure/)
    assert.equal(h.runtime.loop.getSnapshot()?.status, 'paused')
    assert.equal(runs, 2)
    await h.runtime.reset()
  })

  it('caps a Loop turn at 50 steps and clears timers on session reset', async () => {
    let calls = 0
    const h = runtimeHarness({ async next() {
      return { type: 'tool_calls', calls: [{ id: `plan-${++calls}`, toolName: 'update_plan', input: { todos: [] } }] }
    } })
    await h.runtime.command('/loop 1m Inspect')
    await h.runtime.loop.whenIdle()
    assert.equal(calls, 50)
    assert.equal(h.runtime.loop.getSnapshot()?.status, 'paused')
    await h.runtime.reset()
    h.clock.advance(3600_000)
    assert.equal(calls, 50)
    assert.equal(h.runtime.loop.getSnapshot(), undefined)
    assert.equal(h.clock.timers.size, 0)
  })
})
