import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runAgentTurn } from '../src/agent-loop.js'
import { PlanManager } from '../src/plan/manager.js'
import { createUpdatePlanTool } from '../src/tools/plan.js'
import { createDefaultToolRegistry, SUB_AGENT_TOOL_NAMES } from '../src/tools/index.js'
import { askUserTool } from '../src/tools/ask-user.js'
import { ToolRegistry } from '../src/tool.js'
import { compactConversation } from '../src/compact/compact.js'
import type { AgentStep, ChatMessage, ModelAdapter } from '../src/types.js'
import type { PlanDocument } from '../src/plan/types.js'

function requestPlan(messages: ChatMessage[]): PlanDocument {
  const system = messages.find(message => message.role === 'system')
  assert.ok(system?.role === 'system')
  return JSON.parse(system.content.split('\n').at(-1)!) as PlanDocument
}

describe('Plan in the agent turn', () => {
  it('refreshes state after tools and across turns, while ordinary final still stops', async () => {
    const plan = new PlanManager('session-a')
    const tools = new ToolRegistry([createUpdatePlanTool(plan)])
    const requests: PlanDocument[] = []
    const model: ModelAdapter = {
      async next(messages): Promise<AgentStep> {
        requests.push(requestPlan(messages))
        if (requests.length === 1) {
          return { type: 'tool_calls', calls: [{
            id: 'plan-start', toolName: 'update_plan', input: {
              todos: [{ title: 'Inspect code', status: 'in_progress' }],
            },
          }] }
        }
        assert.deepEqual(requestPlan(messages), plan.getSnapshot())
        return { type: 'assistant', content: 'This turn is finished.' }
      },
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Base instructions' },
      { role: 'user', content: 'Plan the work' },
    ]
    const first = await runAgentTurn({ model, tools, plan, messages, cwd: process.cwd() })
    assert.equal(requests.length, 2)
    assert.deepEqual(requests[0].todos, [])
    assert.equal(requests[1].todos[0].title, 'Inspect code')
    assert.equal(plan.getSnapshot().todos[0].status, 'in_progress')
    assert.deepEqual(first[0], messages[0], 'dynamic state is not copied into saved history')
    assert.deepEqual(first.at(-1), { role: 'assistant', content: 'This turn is finished.' })

    plan.update(plan.getSnapshot().todos.map(todo => ({ ...todo, status: 'completed' })))
    await runAgentTurn({ model, tools, plan, messages: first, cwd: process.cwd() })
    assert.equal(requests.length, 3, 'completed Todos do not trigger another turn')
    assert.equal(requests[2].todos[0].status, 'completed')
  })

  it('asks the user and returns without another model request', async () => {
    const plan = new PlanManager('session-a')
    const tools = new ToolRegistry([createUpdatePlanTool(plan), askUserTool])
    let calls = 0
    const messages = await runAgentTurn({
      plan, tools, cwd: process.cwd(), messages: [],
      model: { async next(): Promise<AgentStep> {
        calls++
        return { type: 'tool_calls', calls: [{
          id: 'question', toolName: 'ask_user', input: { question: 'Which package?' },
        }] }
      } },
    })
    assert.equal(calls, 1)
    assert.deepEqual(messages.at(-1), { role: 'assistant', content: 'Which package?' })
  })

  it('injects the live plan after conversation compression instead of reconstructing it from old messages', async () => {
    const plan = new PlanManager('session-a')
    plan.update([{ title: 'Current task after compression', status: 'pending' }])
    const history: ChatMessage[] = [{ role: 'system', content: 'Base instructions' }]
    for (let i = 0; i < 20; i++) {
      history.push({ role: 'user', content: `Old request ${i}` })
      history.push({ role: 'assistant', content: `Old response ${i}` })
    }
    const compacted = await compactConversation(history, {
      async next() { return { type: 'assistant', content: '<summary>Earlier work</summary>' } },
    })
    assert.ok(compacted)
    assert.ok(compacted.removedCount > 0)
    await runAgentTurn({
      plan, tools: new ToolRegistry([createUpdatePlanTool(plan)]),
      cwd: process.cwd(), messages: compacted.messages,
      model: { async next(messages) {
        assert.deepEqual(requestPlan(messages), plan.getSnapshot())
        return { type: 'assistant', content: 'done' }
      } },
    })
    assert.equal(plan.getSnapshot().todos[0].title, 'Current task after compression')
  })

  it('registers update_plan for the root and keeps it out of read-only workers', async () => {
    const plan = new PlanManager('session-a')
    const tools = await createDefaultToolRegistry({ cwd: process.cwd(), runtime: null, plan })
    assert.ok(tools.find('update_plan'))
    const workers = tools.subset(SUB_AGENT_TOOL_NAMES)
    assert.equal(workers.find('update_plan'), undefined)
    const denied = await workers.execute('update_plan', { todos: [] }, { cwd: process.cwd() })
    assert.equal(denied.ok, false)
    assert.deepEqual(plan.getSnapshot().todos, [])
  })
})
