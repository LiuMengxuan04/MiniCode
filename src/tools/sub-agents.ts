import { z } from 'zod'
import type { SubAgentManager } from '../agents/manager.js'
import type { SubAgentSnapshot } from '../agents/types.js'
import type { ToolDefinition } from '../tool.js'

function displayAgent(agent: SubAgentSnapshot): Record<string, unknown> {
  return {
    id: agent.id,
    task: agent.task,
    status: agent.status,
    result: agent.result,
    error: agent.error,
  }
}

export function createSubAgentTools(
  manager: SubAgentManager,
): ToolDefinition<unknown>[] {
  const spawnAgentTool: ToolDefinition<{ task: string }> = {
    name: 'spawn_agent',
    description:
      'Start a read-only sub-agent for one independent research task. It runs in the background and cannot edit code. At most 3 sub-agents may run concurrently.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'A specific, self-contained investigation task.',
        },
      },
      required: ['task'],
    },
    schema: z.object({ task: z.string().min(1) }),
    async run(input, context) {
      const agent = manager.spawn(input.task, context.signal)
      return {
        ok: true,
        output: JSON.stringify({
          agent: displayAgent(agent),
          running: manager.runningCount,
          max_concurrent: manager.maxConcurrent,
        }, null, 2),
      }
    },
  }

  const listAgentsTool: ToolDefinition<Record<string, never>> = {
    name: 'list_agents',
    description:
      'List all sub-agents created in this MiniCode process and their current status.',
    inputSchema: { type: 'object', properties: {} },
    schema: z.object({}),
    async run() {
      return {
        ok: true,
        output: JSON.stringify({
          running: manager.runningCount,
          max_concurrent: manager.maxConcurrent,
          agents: manager.list().map(displayAgent),
        }, null, 2),
      }
    },
  }

  const waitAgentTool: ToolDefinition<{
    agent_ids: string[]
    timeout_ms?: number
  }> = {
    name: 'wait_agent',
    description:
      'Wait for selected sub-agents to finish and return their reports. A timeout returns their latest states without closing them.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Sub-agent IDs returned by spawn_agent.',
        },
        timeout_ms: {
          type: 'number',
          description: 'Maximum wait time in milliseconds. Defaults to 30000.',
        },
      },
      required: ['agent_ids'],
    },
    schema: z.object({
      agent_ids: z.array(z.string().min(1)).min(1),
      timeout_ms: z.number().int().min(0).max(120_000).optional(),
    }),
    async run(input) {
      const result = await manager.wait(input.agent_ids, input.timeout_ms)
      return {
        ok: true,
        output: JSON.stringify({
          timed_out: result.timedOut,
          agents: result.agents.map(displayAgent),
        }, null, 2),
      }
    },
  }

  const closeAgentTool: ToolDefinition<{ agent_id: string }> = {
    name: 'close_agent',
    description:
      'Stop one running sub-agent. Use this when it is looping, no longer needed, or should not continue consuming model calls.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The sub-agent ID to stop.',
        },
      },
      required: ['agent_id'],
    },
    schema: z.object({ agent_id: z.string().min(1) }),
    async run(input) {
      const agent = await manager.close(input.agent_id)
      return {
        ok: true,
        output: JSON.stringify({ agent: displayAgent(agent) }, null, 2),
      }
    },
  }

  return [spawnAgentTool, listAgentsTool, waitAgentTool, closeAgentTool]
}
