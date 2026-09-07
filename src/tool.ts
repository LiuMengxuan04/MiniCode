import { z } from 'zod'
import type { PermissionManager } from './permissions.js'
import type { SkillSummary } from './skills.js'
import type { McpServerSummary } from './mcp.js'
import { throwIfAborted } from './abort.js'

export type ToolContext = {
  cwd: string
  permissions?: PermissionManager
  signal?: AbortSignal
}

export type BackgroundTaskResult = {
  taskId: string
  type: 'local_bash'
  command: string
  pid: number
  status: 'running' | 'completed' | 'failed'
  startedAt: number
}

export type ToolResult = {
  ok: boolean
  output: string
  backgroundTask?: BackgroundTaskResult
  awaitUser?: boolean
  stop?: boolean
  fatal?: boolean
}

export type ToolDefinition<TInput> = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  schema: z.ZodType<TInput>
  run(input: TInput, context: ToolContext): Promise<ToolResult>
}

type ToolRegistryMetadata = {
  skills?: SkillSummary[]
  mcpServers?: McpServerSummary[]
}

export class ToolRegistry {
  private readonly toolsStore: ToolDefinition<unknown>[]
  private metadataStore: ToolRegistryMetadata
  private readonly disposers: Array<() => Promise<void>> = []

  constructor(
    tools: ToolDefinition<unknown>[],
    metadata: ToolRegistryMetadata = {},
    disposer?: () => Promise<void>,
  ) {
    this.toolsStore = [...tools]
    this.metadataStore = metadata
    if (disposer) {
      this.disposers.push(disposer)
    }
  }

  list(): ToolDefinition<unknown>[] {
    return this.toolsStore
  }

  subset(names: readonly string[]): ToolRegistry {
    const allowedNames = new Set(names)
    return new ToolRegistry(
      this.toolsStore.filter(tool => allowedNames.has(tool.name)),
    )
  }

  getSkills(): SkillSummary[] {
    return this.metadataStore.skills ?? []
  }

  getMcpServers(): McpServerSummary[] {
    return this.metadataStore.mcpServers ?? []
  }

  setMcpServers(servers: McpServerSummary[]): void {
    this.metadataStore = {
      ...this.metadataStore,
      mcpServers: [...servers],
    }
  }

  addTools(nextTools: ToolDefinition<unknown>[]): void {
    const existingNames = new Set(this.toolsStore.map(tool => tool.name))
    for (const tool of nextTools) {
      if (existingNames.has(tool.name)) {
        continue
      }
      this.toolsStore.push(tool)
      existingNames.add(tool.name)
    }
  }

  addDisposer(disposer: () => Promise<void>): void {
    this.disposers.push(disposer)
  }

  find(name: string): ToolDefinition<unknown> | undefined {
    return this.toolsStore.find(tool => tool.name === name)
  }

  async execute(
    toolName: string,
    input: unknown,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.find(toolName)
    if (!tool) {
      return {
        ok: false,
        output: `Unknown tool: ${toolName}`,
      }
    }

    const parsed = tool.schema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        output: parsed.error.message,
      }
    }

    try {
      throwIfAborted(context.signal)
      return await tool.run(parsed.data, context)
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : String(error),
        fatal: true,
      }
    }
  }

  async dispose(): Promise<void> {
    await Promise.all(this.disposers.map(disposer => disposer()))
  }
}
