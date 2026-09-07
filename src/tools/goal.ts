import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import { GoalManager, goalUpdateSchema } from '../goal/manager.js'

export function createGoalTools(goal: GoalManager): ToolDefinition<unknown>[] {
  return [{
    name: 'get_goal', description: 'Read the current user-created Goal and its shared Plan.',
    schema: z.object({}).strict(), inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      return { ok: true, output: JSON.stringify({ goal: goal.getSnapshot(), plan: goal.plan.getSnapshot() }) }
    },
  }, {
    name: 'update_goal',
    description: 'Set completion criteria after updating the Plan, or explicitly report blocked/completed. Completion requires all Todos completed and one actual check explanation per criterion. Cannot create, edit the objective, pause, or resume a Goal.',
    schema: goalUpdateSchema,
    inputSchema: {
      type: 'object', properties: {
        action: { type: 'string', enum: ['set_criteria', 'blocked', 'completed'] },
        criteria: { type: 'array', items: { type: 'string' } },
        reason: { type: 'string' }, summary: { type: 'string' },
        checks: { type: 'array', items: { type: 'string' } },
      }, required: ['action'], additionalProperties: false,
    },
    async run(input) {
      try {
        const updated = goal.update(goalUpdateSchema.parse(input))
        return { ok: true, output: JSON.stringify(updated),
          stop: updated.status === 'completed' || updated.status === 'blocked' }
      } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : String(error) }
      }
    },
  }]
}
