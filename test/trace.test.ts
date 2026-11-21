import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { runAgentTurn } from '../src/agent-loop.js'
import { ToolRegistry } from '../src/tool.js'
import { createTraceRecorder } from '../src/trace.js'
import type { AgentStep, AgentTraceEvent, ModelAdapter } from '../src/types.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('runtime tracing', () => {
  it('writes ordered JSONL events with stable launch metadata', async () => {
    const traceRoot = await mkdtemp(path.join(os.tmpdir(), 'minicode-trace-'))
    temporaryDirectories.push(traceRoot)
    const recorder = await createTraceRecorder({
      cwd: '/workspace/demo',
      enabled: true,
      traceRoot,
      launchId: '12345678-fixed-launch-id',
      now: () => new Date('2026-09-09T00:00:00.000Z'),
    })

    recorder.record({
      type: 'turn_started',
      timestamp: '2026-09-09T00:00:01.000Z',
      messageCount: 2,
      toolCount: 1,
    }, { sessionId: 'session-1' })
    await recorder.flush()

    const status = recorder.status()
    assert.equal(status.enabled, true)
    assert.ok(status.filePath)
    const entries = (await readFile(status.filePath, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>)

    assert.deepEqual(entries.map(entry => entry.type), [
      'trace_started',
      'turn_started',
    ])
    assert.deepEqual(entries.map(entry => entry.sequence), [0, 1])
    assert.equal(entries[1].launchId, '12345678-fixed-launch-id')
    assert.equal(entries[1].sessionId, 'session-1')
  })

  it('captures timing and counts without recording model or tool payloads', async () => {
    const events: AgentTraceEvent[] = []
    let request = 0
    const model: ModelAdapter = {
      async next(): Promise<AgentStep> {
        request += 1
        if (request === 1) {
          return {
            type: 'tool_calls',
            calls: [{
              id: 'call-1',
              toolName: 'lookup',
              input: { query: 'SECRET_TOOL_INPUT' },
            }],
          }
        }
        return { type: 'assistant', content: 'SECRET_MODEL_RESPONSE' }
      },
    }
    const tools = new ToolRegistry([{
      name: 'lookup',
      description: 'Test tool',
      inputSchema: { type: 'object' },
      schema: z.object({ query: z.string() }),
      async run() {
        return { ok: true, output: 'SECRET_TOOL_OUTPUT' }
      },
    }])

    await runAgentTurn({
      model,
      tools,
      messages: [{ role: 'user', content: 'SECRET_USER_PROMPT' }],
      cwd: process.cwd(),
      onTrace: event => events.push(event),
    })

    assert.deepEqual(events.map(event => event.type), [
      'turn_started',
      'model_request_started',
      'model_request_completed',
      'tool_completed',
      'model_request_started',
      'model_request_completed',
      'turn_completed',
    ])
    const serialized = JSON.stringify(events)
    assert.doesNotMatch(serialized, /SECRET_USER_PROMPT/)
    assert.doesNotMatch(serialized, /SECRET_TOOL_INPUT/)
    assert.doesNotMatch(serialized, /SECRET_TOOL_OUTPUT/)
    assert.doesNotMatch(serialized, /SECRET_MODEL_RESPONSE/)

    const toolEvent = events.find(event => event.type === 'tool_completed')
    assert.equal(toolEvent?.type === 'tool_completed' ? toolEvent.outputChars : 0, 18)
    const turnEvent = events.at(-1)
    assert.equal(turnEvent?.type === 'turn_completed' ? turnEvent.outcome : '', 'completed')
    assert.equal(turnEvent?.type === 'turn_completed' ? turnEvent.toolCallCount : 0, 1)
  })

  it('does not let a trace listener failure break the agent turn', async () => {
    const result = await runAgentTurn({
      model: {
        async next() {
          return { type: 'assistant', content: 'done' }
        },
      },
      tools: new ToolRegistry([]),
      messages: [{ role: 'user', content: 'hello' }],
      cwd: process.cwd(),
      onTrace() {
        throw new Error('trace sink unavailable')
      },
    })

    assert.equal(result.at(-1)?.role, 'assistant')
  })

  it('contains recorder write failures instead of rejecting flush', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'minicode-trace-'))
    temporaryDirectories.push(directory)
    const blockedRoot = path.join(directory, 'not-a-directory')
    await writeFile(blockedRoot, 'file blocks mkdir', 'utf8')
    const recorder = await createTraceRecorder({
      cwd: '/workspace/demo',
      enabled: true,
      traceRoot: blockedRoot,
    })

    recorder.record({
      type: 'turn_started',
      timestamp: new Date().toISOString(),
      messageCount: 1,
      toolCount: 0,
    })
    await recorder.flush()

    assert.equal(recorder.status().enabled, true)
    assert.match(recorder.status().error ?? '', /not-a-directory|ENOTDIR|EEXIST/)
  })
})
