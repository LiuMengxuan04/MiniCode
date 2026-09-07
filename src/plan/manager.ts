import { randomUUID } from 'node:crypto'
import { updatePlanSchema, type PlanDocument, type TodoInput } from './types.js'

function emptyPlan(sessionId: string): PlanDocument {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    sessionId,
    todos: [],
    updatedAt: new Date().toISOString(),
  }
}

/** One in-memory plan for the current session; updates never run the agent. */
export class PlanManager {
  private document: PlanDocument
  private readonly listeners = new Set<() => void>()

  constructor(sessionId: string) {
    this.document = emptyPlan(sessionId)
  }

  getSnapshot(): PlanDocument {
    return { ...this.document, todos: this.document.todos.map(todo => ({ ...todo })) }
  }

  update(todos: TodoInput[]): PlanDocument {
    const parsed = updatePlanSchema.parse({ todos })
    const existingIds = new Set(this.document.todos.map(todo => todo.id))
    const seenIds = new Set<string>()
    const nextTodos = parsed.todos.map(todo => {
      if (todo.id !== undefined) {
        if (!existingIds.has(todo.id)) {
          throw new Error(`Unknown Todo ID: ${todo.id}. Omit the ID for a new Todo.`)
        }
        if (seenIds.has(todo.id)) {
          throw new Error(`Duplicate Todo ID: ${todo.id}.`)
        }
      }
      const id = todo.id ?? randomUUID()
      seenIds.add(id)
      return { ...todo, id }
    })

    this.document = {
      ...this.document,
      todos: nextTodos,
      updatedAt: new Date().toISOString(),
    }
    this.notify()
    return this.getSnapshot()
  }

  reset(sessionId: string): void {
    this.document = emptyPlan(sessionId)
    this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
