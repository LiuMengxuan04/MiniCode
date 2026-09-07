import { z } from 'zod'

export const todoInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().trim().min(1),
  status: z.enum(['pending', 'in_progress', 'completed']),
})

export const updatePlanSchema = z.object({
  todos: z.array(todoInputSchema).refine(
    todos => todos.filter(todo => todo.status === 'in_progress').length <= 1,
    'A plan can have at most one in_progress Todo.',
  ),
  explanation: z.string().trim().optional(),
})

export type TodoInput = z.infer<typeof todoInputSchema>
export type TodoStatus = TodoInput['status']
export type Todo = TodoInput & { id: string }

export type PlanDocument = {
  schemaVersion: 1
  id: string
  sessionId: string
  todos: Todo[]
  updatedAt: string
}
