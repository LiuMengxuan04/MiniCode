import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { GoalManager } from '../src/goal/manager.js'
import { SessionRuntime } from '../src/runtime/session-runtime.js'
import { PlanManager } from '../src/plan/manager.js'
import { createUpdatePlanTool } from '../src/tools/plan.js'
import { askUserTool } from '../src/tools/ask-user.js'
import { ToolRegistry } from '../src/tool.js'
import { runAgentTurnWithOutcome } from '../src/agent-loop.js'
import type { AgentStep, ChatMessage, ModelAdapter } from '../src/types.js'

const completedTodo = { title: 'Check the result', status: 'completed' as const }
const final: AgentStep = { type: 'assistant', content: 'One turn finished.' }
const call = (id: string, toolName: string, input: unknown): AgentStep => ({ type: 'tool_calls', calls: [{ id, toolName, input }] })

function harness(next: ModelAdapter['next'], failSave = false) {
  const plan = new PlanManager('goal-test')
  const tools = new ToolRegistry([createUpdatePlanTool(plan), askUserTool])
  let messages: ChatMessage[] = [{ role: 'system', content: 'Original instructions.' }]
  const notices: string[] = []
  const runtime: SessionRuntime = new SessionRuntime({
    plan, tools, notice: message => notices.push(message), settleWorkers: async () => {},
    async recordAnswer(input) { messages.push(input) },
    async execute(request) {
      messages = [...messages, request.input]
      const result = await runAgentTurnWithOutcome({
        model: { next }, messages, tools: runtime.toolsFor(request.mode), plan,
        runtimeContext: () => runtime.contextFor(request.mode), cwd: process.cwd(),
        signal: request.signal, maxSteps: request.mode ? 50 : undefined, stopOnFatalToolError: !!request.mode,
      })
      messages = result.messages
      return failSave ? { ...result, outcome: 'failed', error: 'Saving failed' } : result
    },
  })
  return { plan, runtime, notices, messages: () => messages }
}

describe('Goal state and completion checks', () => {
  it('requires a fresh nonempty plan, criteria, all completed Todos, and matching checks', () => {
    const plan = new PlanManager('s')
    plan.update([completedTodo])
    const manager = new GoalManager(plan)
    const original = manager.create('Inspect the result')
    assert.throws(() => manager.create('replace'), /already exists/)
    assert.throws(() => manager.update({ action: 'set_criteria', criteria: ['Read the result'] }), /update_plan/)
    assert.throws(() => manager.update({ action: 'completed', summary: 'done', checks: ['read'] }), /planning/)
    plan.update([{ ...completedTodo, status: 'pending' }])
    manager.update({ action: 'set_criteria', criteria: ['Read the result'] })
    assert.throws(() => manager.update({ action: 'completed', summary: 'done', checks: ['read'] }), /every Todo/)
    plan.update(plan.getSnapshot().todos.map(todo => ({ ...todo, status: 'completed' })))
    assert.throws(() => manager.update({ action: 'completed', summary: 'done', checks: ['one', 'two'] }), /one check/)
    manager.update({ action: 'completed', summary: 'Checked', checks: ['Read the saved result and confirmed its contents'] })
    assert.equal(manager.getSnapshot()?.status, 'completed')
    assert.equal(manager.getSnapshot()?.description, original.description)
    assert.equal(manager.getSnapshot()?.planId, plan.getSnapshot().id)
    assert.throws(() => manager.resume(), /completed/)
    const snapshot = manager.getSnapshot()!
    snapshot.completionCriteria.length = 0
    assert.equal(manager.getSnapshot()?.completionCriteria.length, 1)
    plan.update([{ title: 'New task', status: 'pending' }])
    assert.equal(manager.getSnapshot()?.status, 'paused')
    assert.equal(manager.getSnapshot()?.needsReplan, true)
    assert.equal(manager.getSnapshot()?.completion, undefined)
    plan.reset('other-session')
    assert.equal(manager.getSnapshot(), undefined)
    manager.dispose()
  })

  it('rejects malformed tool actions and cannot change user-owned fields', async () => {
    const h = harness(async () => final)
    h.runtime.goal.manager.create('Original objective')
    for (const input of [
      { action: 'pause' }, { action: 'blocked', reason: ' ' },
      { action: 'set_criteria', criteria: [] },
      { action: 'blocked', reason: 'missing access', description: 'replace objective' },
    ]) {
      const result = await h.runtime.toolsFor('goal').execute('update_goal', input, { cwd: process.cwd() })
      assert.equal(result.ok, false)
    }
    assert.equal(h.runtime.goal.manager.getSnapshot()?.description, 'Original objective')
    assert.equal(h.runtime.toolsFor().find('update_goal'), undefined)
    assert.equal(h.runtime.toolsFor('loop').find('get_goal'), undefined)
    assert.equal(h.runtime.contextFor(), '')
    await h.runtime.reset()
  })
})

describe('Goal execution through the root turn runner', () => {
  it('continues across ordinary finals and stops the batch immediately on explicit completion', async () => {
    let requests = 0
    const h = harness(async (messages, options) => {
      requests++
      assert.ok(options?.tools?.some(tool => tool.name === 'update_goal'))
      assert.match(messages[0].role === 'system' ? messages[0].content : '', /Original instructions\.[\s\S]*current_goal/)
      if (requests === 1) return call('plan', 'update_plan', { todos: [completedTodo] })
      if (requests === 2) return call('criteria', 'update_goal', { action: 'set_criteria', criteria: ['Inspect result'] })
      if (requests === 3) return final
      assert.ok(messages.some(message => message.role === 'user' && message.internal === 'goal'))
      return { type: 'tool_calls', calls: [
        { id: 'complete', toolName: 'update_goal', input: { action: 'completed', summary: 'Result inspected', checks: ['Read and confirmed result'] } },
        { id: 'must-not-run', toolName: 'update_plan', input: { todos: [] } },
      ] }
    })
    await h.runtime.command('/goal Inspect result')
    await h.runtime.goal.whenIdle()
    assert.equal(requests, 4)
    assert.equal(h.runtime.goal.manager.getSnapshot()?.status, 'completed')
    assert.equal(h.plan.getSnapshot().todos.length, 1)
    assert.ok(h.messages().some(message => message.role === 'tool_result' && message.toolUseId === 'must-not-run' && message.isError))
    assert.deepEqual(h.messages()[0], { role: 'system', content: 'Original instructions.' })
    await h.runtime.reset()
  })

  it('pauses after three automatic turns without tools and never marks the Goal complete from a final', async () => {
    let calls = 0
    const h = harness(async () => { calls++; return final })
    await h.runtime.command('/goal Keep going')
    await h.runtime.goal.whenIdle()
    assert.equal(calls, 4, 'the initial user-created turn is not an automatic turn')
    assert.equal(h.runtime.goal.manager.getSnapshot()?.status, 'paused')
    assert.match(h.runtime.goal.manager.getSnapshot()?.stopReason ?? '', /3 automatic turns/)
    await h.runtime.reset()
  })

  it('waits for ask_user, records a paused answer, and requires explicit resume', async () => {
    let calls = 0
    const h = harness(async () => {
      calls++
      return calls === 1 ? call('question', 'ask_user', { question: 'Which file?' })
        : call('blocked', 'update_goal', { action: 'blocked', reason: 'File unavailable' })
    })
    await h.runtime.command('/goal Inspect a file')
    await h.runtime.goal.whenIdle()
    assert.equal(calls, 1)
    assert.equal(h.runtime.goal.waitingForAnswer, true)
    await h.runtime.command('/goal pause')
    await assert.rejects(h.runtime.command('/goal resume'), /Answer/)
    await h.runtime.submit('README.md')
    assert.equal(calls, 1)
    assert.deepEqual(h.messages().at(-1), { role: 'user', content: 'README.md' })
    assert.equal(h.runtime.goal.manager.getSnapshot()?.status, 'paused')
    await h.runtime.command('/goal resume')
    await h.runtime.goal.whenIdle()
    assert.equal(calls, 2)
    assert.equal(h.runtime.goal.manager.getSnapshot()?.status, 'blocked')
    await h.runtime.reset()
  })

  it('does not restart after a save failure, including after a completion tool succeeds', async () => {
    const h = harness(async () => call('complete', 'update_goal', {
      action: 'completed', summary: 'Done', checks: ['Checked'],
    }), true)
    h.runtime.goal.manager.create('Check')
    h.plan.update([completedTodo])
    h.runtime.goal.manager.update({ action: 'set_criteria', criteria: ['Check'] })
    h.runtime.goal.resume()
    await h.runtime.goal.whenIdle()
    assert.equal(h.runtime.goal.manager.getSnapshot()?.status, 'paused')
    assert.equal(h.runtime.goal.manager.getSnapshot()?.completion, undefined)
    assert.match(h.runtime.goal.manager.getSnapshot()?.stopReason ?? '', /Saving failed/)
    await h.runtime.reset()
  })

  it('stops on a model exception, retaining preceding calls and results', async () => {
    let calls = 0
    const h = harness(async () => {
      if (++calls === 1) return call('plan', 'update_plan', { todos: [completedTodo] })
      throw new Error('Model unavailable')
    })
    await h.runtime.command('/goal Check')
    await h.runtime.goal.whenIdle()
    assert.equal(calls, 2)
    assert.equal(h.runtime.goal.manager.getSnapshot()?.status, 'paused')
    assert.ok(h.messages().some(message => message.role === 'tool_result' && message.toolUseId === 'plan' && !message.isError))
    await h.runtime.reset()
  })

  it('enforces 50 steps per automatic turn', async () => {
    let calls = 0
    const h = harness(async () => call(`read-${++calls}`, 'get_goal', {}))
    await h.runtime.command('/goal Keep inspecting')
    await h.runtime.goal.whenIdle()
    assert.equal(calls, 50)
    assert.equal(h.runtime.goal.manager.getSnapshot()?.status, 'paused')
    assert.match(h.runtime.goal.manager.getSnapshot()?.stopReason ?? '', /max_steps/)
    await h.runtime.reset()
  })

  it('reserves command names, preserves the objective, and clears only Goal state', async () => {
    const h = harness(async () => final)
    for (const input of ['/goal update changed', '/goal edit x', '/goal limit 5', '/goal resume extra']) {
      assert.ok(await h.runtime.command(input))
      assert.equal(h.runtime.goal.manager.getSnapshot(), undefined)
    }
    h.plan.update([completedTodo])
    await h.runtime.command('/goal Inspect')
    await h.runtime.goal.whenIdle()
    await assert.rejects(h.runtime.command('/goal Replace'), /already exists/)
    await h.runtime.command('/goal clear')
    assert.equal(h.runtime.goal.manager.getSnapshot(), undefined)
    assert.equal(h.plan.getSnapshot().todos.length, 1)
    await h.runtime.reset()
  })
})
