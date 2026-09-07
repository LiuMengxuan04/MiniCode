import { throwIfAborted } from '../abort.js'
import { runAgentTurn } from '../agent-loop.js'
import type { ToolRegistry } from '../tool.js'
import type { ChatMessage, ModelAdapter } from '../types.js'
import {
  MAX_SUB_AGENTS,
  MAX_SUB_AGENT_STEPS,
  type SubAgentSnapshot,
  type WaitForSubAgentsResult,
} from './types.js'
import { buildSubAgentPrompt } from './worker-prompt.js'

type SubAgentRecord = SubAgentSnapshot & {
  controller: AbortController
  completion: Promise<void>
}

type SubAgentManagerOptions = {
  model: ModelAdapter
  tools: ToolRegistry
  cwd: string
}

export class SubAgentManager {
  readonly maxConcurrent = MAX_SUB_AGENTS

  private readonly records = new Map<string, SubAgentRecord>()
  private readonly listeners = new Set<() => void>()
  private nextId = 1

  constructor(private readonly options: SubAgentManagerOptions) {}

  spawn(task: string, parentSignal?: AbortSignal): SubAgentSnapshot {
    throwIfAborted(parentSignal)
    const normalizedTask = task.trim()
    if (!normalizedTask) {
      throw new Error('Sub-agent task cannot be empty')
    }
    if (this.runningCount >= this.maxConcurrent) {
      throw new Error(
        `At most ${this.maxConcurrent} sub-agents may run at the same time`,
      )
    }

    const record: SubAgentRecord = {
      id: `agent_${this.nextId++}`,
      task: normalizedTask,
      status: 'running',
      startedAt: Date.now(),
      controller: new AbortController(),
      completion: Promise.resolve(),
    }
    this.records.set(record.id, record)
    const cancel = () => {
      record.status = 'closed'
      record.controller.abort(parentSignal?.reason)
      this.notify()
    }
    parentSignal?.addEventListener('abort', cancel, { once: true })
    record.completion = this.run(record).finally(() => parentSignal?.removeEventListener('abort', cancel))
    this.notify()
    return this.snapshot(record)
  }

  get runningCount(): number {
    return [...this.records.values()].filter(
      record => record.status === 'running',
    ).length
  }

  list(): SubAgentSnapshot[] {
    return [...this.records.values()].map(record => this.snapshot(record))
  }

  async wait(
    agentIds: string[],
    timeoutMs = 30_000,
  ): Promise<WaitForSubAgentsResult> {
    const records = agentIds.map(id => this.requireRecord(id))
    const running = records.filter(record => record.status === 'running')
    if (running.length === 0) {
      return {
        timedOut: false,
        agents: records.map(record => this.snapshot(record)),
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const completed = Promise.all(running.map(record => record.completion)).then(
      () => false,
    )
    const timedOut = await Promise.race([
      completed,
      new Promise<true>(resolve => {
        timer = setTimeout(() => resolve(true), Math.max(0, timeoutMs))
      }),
    ])
    if (timer) {
      clearTimeout(timer)
    }

    return {
      timedOut,
      agents: records.map(record => this.snapshot(record)),
    }
  }

  async close(agentId: string): Promise<SubAgentSnapshot> {
    const record = this.requireRecord(agentId)
    if (record.status === 'running') {
      record.status = 'closed'
      record.controller.abort(new Error('Sub-agent closed by root agent'))
      this.notify()
    }
    await record.completion
    return this.snapshot(record)
  }

  async closeAll(): Promise<void> {
    const runningIds = [...this.records.values()]
      .filter(record => record.status === 'running')
      .map(record => record.id)
    await Promise.all(runningIds.map(id => this.close(id)))
    await Promise.all([...this.records.values()].map(record => record.completion))
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async run(record: SubAgentRecord): Promise<void> {
    try {
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: await buildSubAgentPrompt(this.options.cwd),
        },
        { role: 'user', content: record.task },
      ]
      const result = await runAgentTurn({
        model: this.options.model,
        tools: this.options.tools,
        messages,
        cwd: this.options.cwd,
        maxSteps: MAX_SUB_AGENT_STEPS,
        signal: record.controller.signal,
      })

      if (record.status !== 'closed') {
        record.status = 'completed'
        record.result = this.lastAssistantMessage(result)
      }
    } catch (error) {
      if (record.status !== 'closed') {
        record.status = 'failed'
        record.error = error instanceof Error ? error.message : String(error)
      }
    } finally {
      record.finishedAt = Date.now()
      this.notify()
    }
  }

  private lastAssistantMessage(messages: ChatMessage[]): string {
    const message = [...messages]
      .reverse()
      .find(candidate => candidate.role === 'assistant')
    return message?.role === 'assistant'
      ? message.content
      : 'Sub-agent finished without an assistant report.'
  }

  private requireRecord(agentId: string): SubAgentRecord {
    const record = this.records.get(agentId)
    if (!record) {
      throw new Error(`Unknown sub-agent: ${agentId}`)
    }
    return record
  }

  private snapshot(record: SubAgentRecord): SubAgentSnapshot {
    return {
      id: record.id,
      task: record.task,
      status: record.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      result: record.result,
      error: record.error,
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
