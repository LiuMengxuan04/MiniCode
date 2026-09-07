import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { runAgentTurnWithOutcome } from '../src/agent-loop.js'
import { ToolRegistry } from '../src/tool.js'
import { TurnRunner } from '../src/runtime/turn-runner.js'
import { PermissionManager } from '../src/permissions.js'
import { writeFileTool } from '../src/tools/write-file.js'
import { SubAgentManager } from '../src/agents/manager.js'
import type { AgentStep } from '../src/types.js'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('Root turn cancellation and structured outcomes', () => {
  it('cancels an uncooperative model promptly and keeps earlier tool results', async () => {
    const controller = new AbortController()
    const started = deferred()
    let requests = 0
    const pending = runAgentTurnWithOutcome({
      messages: [], cwd: process.cwd(), signal: controller.signal,
      tools: new ToolRegistry([{ name: 'read', description: '', schema: z.object({}), inputSchema: {},
        async run() { return { ok: true, output: 'read result' } } }]),
      model: { async next(): Promise<AgentStep> {
        if (++requests === 1) return { type: 'tool_calls', calls: [{ id: 'read-1', toolName: 'read', input: {} }] }
        started.resolve()
        return new Promise(() => {})
      } },
    })
    await started.promise
    controller.abort(new Error('User paused'))
    const result = await pending
    assert.equal(result.outcome, 'aborted')
    assert.equal(requests, 2)
    assert.ok(result.messages.some(message => message.role === 'tool_result' && message.content === 'read result'))
  })

  it('waits for an already-started tool and saving, rejects overlap, and cancels remaining batch calls', async () => {
    const started = deferred()
    const finishTool = deferred()
    const saving = deferred()
    const finishSave = deferred()
    const runner = new TurnRunner()
    let executions = 0
    const work = runner.run(async signal => {
      const result = await runAgentTurnWithOutcome({
        messages: [], cwd: process.cwd(), signal,
        tools: new ToolRegistry([{ name: 'work', description: '', schema: z.object({}), inputSchema: {},
          async run() { executions++; started.resolve(); await finishTool.promise; return { ok: true, output: 'effect recorded' } } }]),
        model: { async next() { return { type: 'tool_calls', calls: [
          { id: 'one', toolName: 'work', input: {} }, { id: 'two', toolName: 'work', input: {} },
        ] } } },
      })
      saving.resolve()
      await finishSave.promise
      return result
    })
    await started.promise
    const stop = runner.stop()
    await assert.rejects(runner.run(async () => ({ messages: [], outcome: 'final', toolCalls: 0 })), /still running/)
    assert.equal(runner.busy, true)
    finishTool.resolve()
    await saving.promise
    assert.equal(runner.busy, true)
    finishSave.resolve()
    await stop
    const result = await work
    assert.equal(executions, 1)
    assert.equal(result.outcome, 'aborted')
    assert.deepEqual(result.messages.filter(message => message.role === 'tool_result').map(message => message.content), ['effect recorded', 'Cancelled before execution.'])
    assert.equal(runner.busy, false)
  })

  it('cancels approval without applying a file change or accepting a late allow decision', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'minicode-approval-'))
    const controller = new AbortController()
    const prompt = deferred()
    const approval = deferred<{ decision: 'allow_once' }>()
    const permissions = new PermissionManager(cwd, async (_request, signal) => {
      assert.equal(signal, controller.signal)
      prompt.resolve()
      return approval.promise
    })
    permissions.beginTurn(controller.signal)
    try {
      const pending = runAgentTurnWithOutcome({
        messages: [], cwd, signal: controller.signal, permissions,
        tools: new ToolRegistry([writeFileTool]),
        model: { async next() { return { type: 'tool_calls', calls: [{ id: 'write', toolName: 'write_file', input: { path: 'result.txt', content: 'do not write' } }] } } },
      })
      await prompt.promise
      controller.abort(new Error('Pause during approval'))
      const result = await pending
      assert.equal(result.outcome, 'aborted')
      approval.resolve({ decision: 'allow_once' })
      await assert.rejects(readFile(path.join(cwd, 'result.txt')), /ENOENT/)
    } finally {
      permissions.endTurn()
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('stops after unhandled tool errors and pairs every call with a result', async () => {
    const result = await runAgentTurnWithOutcome({
      messages: [], cwd: process.cwd(), stopOnFatalToolError: true,
      tools: new ToolRegistry([{ name: 'broken', description: '', schema: z.object({}), inputSchema: {},
        async run() { throw new Error('Unexpected failure') } }]),
      model: { async next() { return { type: 'tool_calls', calls: [
        { id: 'failed', toolName: 'broken', input: {} }, { id: 'cancelled', toolName: 'broken', input: {} },
      ] } } },
    })
    assert.equal(result.outcome, 'failed')
    assert.equal(result.toolCalls, 1)
    assert.equal(result.messages.filter(message => message.role === 'tool_result').length, 2)
  })

  it('propagates root cancellation to read-only workers', async () => {
    const started = deferred()
    const manager = new SubAgentManager({ cwd: process.cwd(), tools: new ToolRegistry([]),
      model: { async next(): Promise<AgentStep> { started.resolve(); return new Promise(() => {}) } } })
    const controller = new AbortController()
    const worker = manager.spawn('Inspect files', controller.signal)
    await started.promise
    controller.abort(new Error('Root stopped'))
    await manager.closeAll()
    assert.equal(manager.list().find(agent => agent.id === worker.id)?.status, 'closed')
    assert.equal(manager.runningCount, 0)
  })
})
