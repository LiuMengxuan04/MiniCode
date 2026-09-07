import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PlanManager } from '../src/plan/manager.js'
import { formatPlan, withPlanContext } from '../src/plan/context.js'
import { createUpdatePlanTool } from '../src/tools/plan.js'
import { ToolRegistry } from '../src/tool.js'
import { tryHandleLocalCommand, completeSlashCommand } from '../src/cli-commands.js'
import { renderTranscriptLines } from '../src/tui/transcript.js'
import { stringDisplayWidth } from '../src/tui/chrome.js'
import type { TodoInput } from '../src/plan/types.js'
import type { ChatMessage } from '../src/types.js'

describe('PlanManager', () => {
  it('adds, edits, reorders, removes, completes and reopens Todos with stable IDs', () => {
    const plan = new PlanManager('session-a')
    const initial = plan.getSnapshot()
    const created = plan.update([
      { title: ' Inspect code ', status: 'in_progress' },
      { title: 'Run tests', status: 'pending' },
    ])
    assert.equal(created.id, initial.id)
    assert.equal(created.sessionId, 'session-a')
    const [inspect, tests] = created.todos
    assert.ok(inspect.id)
    assert.notEqual(inspect.id, tests.id)
    assert.equal(inspect.title, 'Inspect code')

    const reordered = plan.update([
      { ...tests, title: 'Run regression tests', status: 'in_progress' },
      { ...inspect, status: 'completed' },
    ])
    assert.deepEqual(reordered.todos, [
      { id: tests.id, title: 'Run regression tests', status: 'in_progress' },
      { id: inspect.id, title: 'Inspect code', status: 'completed' },
    ])
    const completed = plan.update(reordered.todos.map(todo => ({ ...todo, status: 'completed' })))
    assert.equal(completed.todos.length, 2, 'completed lists remain visible')
    assert.deepEqual(plan.update([{ ...inspect, status: 'pending' }]).todos, [
      { ...inspect, status: 'pending' },
    ])
    assert.deepEqual(plan.update([]).todos, [])
    assert.equal(plan.getSnapshot().id, initial.id)
  })

  it('rejects invalid replacements without changing or notifying the plan', () => {
    const plan = new PlanManager('session-a')
    const before = plan.update([{ title: 'Keep me', status: 'pending' }])
    let updates = 0
    plan.subscribe(() => { updates++ })
    const todo = before.todos[0]
    const invalid: TodoInput[][] = [
      [{ title: 'One', status: 'in_progress' }, { title: 'Two', status: 'in_progress' }],
      [todo, todo],
      [{ ...todo, id: 'unknown' }],
      [{ ...todo, title: ' \n ' }],
      [{ ...todo, status: 'active' as TodoInput['status'] }],
    ]
    for (const todos of invalid) {
      assert.throws(() => plan.update(todos))
      assert.deepEqual(plan.getSnapshot(), before)
    }
    assert.equal(updates, 0)
  })

  it('isolates snapshots and notifies subscribers only until unsubscribe', () => {
    const plan = new PlanManager('session-a')
    let updates = 0
    const unsubscribe = plan.subscribe(() => { updates++ })
    const input: TodoInput[] = [{ title: 'Original', status: 'pending' }]
    const saved = plan.update(input)
    input[0].title = 'Mutated input'
    saved.todos[0].title = 'Mutated result'
    plan.getSnapshot().todos.splice(0)
    assert.equal(plan.getSnapshot().todos[0].title, 'Original')
    assert.equal(updates, 1)
    unsubscribe()
    plan.update([])
    assert.equal(updates, 1)
  })

  it('starts fresh on session changes and does not accept IDs from the previous plan', () => {
    const plan = new PlanManager('session-a')
    const old = plan.update([{ title: 'Old session', status: 'in_progress' }])
    for (const sessionId of ['session-new', 'session-resumed', 'session-forked']) {
      plan.reset(sessionId)
      assert.equal(plan.getSnapshot().sessionId, sessionId)
      assert.notEqual(plan.getSnapshot().id, old.id)
      assert.deepEqual(plan.getSnapshot().todos, [])
      assert.throws(() => plan.update(old.todos), /Unknown Todo ID/)
    }
    assert.deepEqual(new PlanManager('session-a').getSnapshot().todos, [])
  })
})

describe('Plan tool and display', () => {
  it('returns the current list and IDs, validates input, and shares state with /plan', async () => {
    const plan = new PlanManager('session-a')
    const tools = new ToolRegistry([createUpdatePlanTool(plan)])
    const result = await tools.execute('update_plan', {
      todos: [{ title: 'Inspect code', status: 'in_progress' }],
      explanation: 'Start with the entry point',
    }, { cwd: process.cwd() })
    assert.equal(result.ok, true)
    assert.deepEqual(JSON.parse(result.output), {
      ...plan.getSnapshot(), explanation: 'Start with the entry point',
    })
    assert.equal(await tryHandleLocalCommand('/plan', { plan }), formatPlan(plan.getSnapshot()))
    const before = plan.getSnapshot()
    const invalid = await tools.execute('update_plan', {
      todos: [{ title: 'One', status: 'in_progress' }, { title: 'Two', status: 'in_progress' }],
    }, { cwd: process.cwd() })
    assert.equal(invalid.ok, false)
    assert.match(invalid.output, /at most one/)
    assert.deepEqual(plan.getSnapshot(), before)
    const unknown = await tools.execute('update_plan', {
      todos: [{ id: 'stale', title: 'Old item', status: 'pending' }],
    }, { cwd: process.cwd() })
    assert.equal(unknown.ok, false)
    assert.match(unknown.output, /Unknown Todo ID/)
    assert.deepEqual(plan.getSnapshot(), before)
  })

  it('shows an empty plan and keeps manual edit commands out of this stage', async () => {
    const plan = new PlanManager('session-a')
    assert.equal(await tryHandleLocalCommand('/plan', { plan }), 'Plan is empty.')
    assert.match((await tryHandleLocalCommand('/plan add work', { plan }))!, /view only/)
    assert.deepEqual(plan.getSnapshot().todos, [])
    assert.ok(completeSlashCommand('/pl')[0].includes('/plan'))
  })

  it('renders all three markers and wraps long CJK titles in the existing transcript', () => {
    const plan = new PlanManager('session-a')
    const snapshot = plan.update([
      { title: '等待执行的任务'.repeat(12), status: 'pending' },
      { title: 'Working', status: 'in_progress' },
      { title: 'Finished', status: 'completed' },
    ])
    const body = formatPlan(snapshot)
    const width = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true })
    try {
      const lines = renderTranscriptLines([{ id: 1, kind: 'assistant', body }])
        .map(line => line.replace(/\u001b\[[\d;]*[A-Za-z]/g, ''))
      const rendered = lines.join('\n')
      assert.match(rendered, /Plan: 1\/3 completed/)
      for (const marker of ['[ ]', '[>]', '[x]']) assert.ok(rendered.includes(marker))
      assert.ok(lines.every(line => stringDisplayWidth(line) <= 56))
    } finally {
      if (width) Object.defineProperty(process.stdout, 'columns', width)
      else delete process.stdout.columns
    }
  })

  it('adds current plan context without modifying history or duplicating system messages', () => {
    const plan = new PlanManager('session-a')
    const snapshot = plan.update([{ title: 'Read source', status: 'pending' }])
    const messages: ChatMessage[] = [{ role: 'system', content: 'Base instructions' }]
    const projected = withPlanContext(messages, snapshot)
    assert.deepEqual(messages, [{ role: 'system', content: 'Base instructions' }])
    assert.equal(projected.filter(message => message.role === 'system').length, 1)
    assert.match((projected[0] as { content: string }).content, /Read source/)
    assert.equal(withPlanContext([], snapshot)[0].role, 'system')
  })
})
