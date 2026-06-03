import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import {
  type TaskState,
  addTask,
  transitionTask,
  formatTaskList,
} from '../task-state.js'

type Input = {
  action: 'create' | 'update_status' | 'complete' | 'list'
  description?: string
  id?: number
  status?: 'pending' | 'in_progress' | 'completed'
}

export function createTaskTrackerTool(
  taskState: TaskState,
): ToolDefinition<Input> {
  const schema = z.object({
    action: z.enum(['create', 'update_status', 'complete', 'list']),
    description: z.string().optional(),
    id: z.number().int().positive().optional(),
    status: z.enum(['pending', 'in_progress', 'completed']).optional(),
  })

  return {
    name: 'task_tracker',
    description:
      'Manage a lightweight task list for tracking multi-step work progress. Actions: create (add a new task), update_status (change task status), complete (mark task done), list (show all tasks).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update_status', 'complete', 'list'],
          description: 'The action to perform.',
        },
        description: {
          type: 'string',
          description: 'Task description. Required for action "create".',
        },
        id: {
          type: 'number',
          description: 'Task ID. Required for actions "update_status" and "complete".',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'New status. Required for action "update_status".',
        },
      },
      required: ['action'],
    },
    schema,
    async run(input) {
      try {
        switch (input.action) {
          case 'create': {
            if (!input.description) {
              return { ok: false, output: 'description is required for action "create".' }
            }
            const task = addTask(taskState, input.description)
            return {
              ok: true,
              output: `Task #${task.id} created: ${task.description}`,
            }
          }
          case 'update_status': {
            if (input.id === undefined) {
              return { ok: false, output: 'id is required for action "update_status".' }
            }
            if (!input.status) {
              return { ok: false, output: 'status is required for action "update_status".' }
            }
            const existing = taskState.tasks.find(t => t.id === input.id)
            const oldStatus = existing?.status ?? 'unknown'
            const task = transitionTask(taskState, input.id, input.status)
            return {
              ok: true,
              output: `Task #${task.id} status: ${oldStatus} -> ${input.status}`,
            }
          }
          case 'complete': {
            if (input.id === undefined) {
              return { ok: false, output: 'id is required for action "complete".' }
            }
            const task = transitionTask(taskState, input.id, 'completed')
            return {
              ok: true,
              output: `Task #${task.id} completed: ${task.description}`,
            }
          }
          case 'list': {
            return {
              ok: true,
              output: formatTaskList(taskState),
            }
          }
        }
      } catch (error) {
        return {
          ok: false,
          output: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
