import type { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import type { PlanManager } from '../plan/manager.js'
import { updatePlanSchema } from '../plan/types.js'

export function createUpdatePlanTool(plan: PlanManager): ToolDefinition<z.infer<typeof updatePlanSchema>> {
  return {
    name: 'update_plan',
    description: 'Update the current session Todo list. Send the complete list to add, edit, remove, reorder, or change status. Keep IDs for existing Todos; omit IDs for new ones. At most one Todo may be in_progress. An empty list clears the plan. This tool does not execute tasks or continue the conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Existing Todo ID. Omit for a new Todo.' },
              title: { type: 'string', minLength: 1 },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
            required: ['title', 'status'],
          },
        },
        explanation: { type: 'string', description: 'Optional brief reason for the update.' },
      },
      required: ['todos'],
    },
    schema: updatePlanSchema,
    async run(input) {
      try {
        const updated = plan.update(input.todos)
        return {
          ok: true,
          output: JSON.stringify({ ...updated, explanation: input.explanation }),
        }
      } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
