import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PlanManager } from '../plan/manager.js'

export type GoalDocument = {
  schemaVersion: 1
  id: string
  sessionId: string
  planId: string
  description: string
  completionCriteria: string[]
  status: 'active' | 'paused' | 'blocked' | 'completed'
  needsReplan: boolean
  stopReason?: string
  completion?: { summary: string; checks: string[]; checkedAt: string }
  updatedAt: string
}

const text = z.string().trim().min(1)
export const goalUpdateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set_criteria'), criteria: z.array(text).min(1) }).strict(),
  z.object({ action: z.literal('blocked'), reason: text }).strict(),
  z.object({ action: z.literal('completed'), summary: text, checks: z.array(text).min(1) }).strict(),
])

/** The user owns the objective; the model can only plan and report its outcome. */
export class GoalManager {
  private document?: GoalDocument
  private planPrepared = false
  private readonly unsubscribe: () => void

  constructor(readonly plan: PlanManager) {
    this.unsubscribe = plan.subscribe(() => {
      const goal = this.document
      if (!goal) return
      if (goal.planId !== plan.getSnapshot().id) {
        this.clear()
        return
      }
      this.planPrepared = true
      if (goal.status !== 'active') {
        this.change({ status: 'paused', needsReplan: true, completion: undefined,
          stopReason: 'Plan changed. Resume to review the plan and completion criteria.' })
      }
    })
  }

  getSnapshot(): GoalDocument | undefined {
    return this.document ? structuredClone(this.document) : undefined
  }

  create(description: string): GoalDocument {
    if (this.document) throw new Error('A Goal already exists. Use /goal clear first.')
    const plan = this.plan.getSnapshot()
    this.planPrepared = false
    this.document = {
      schemaVersion: 1, id: randomUUID(), sessionId: plan.sessionId, planId: plan.id,
      description: text.parse(description), completionCriteria: [], status: 'active',
      needsReplan: true, updatedAt: new Date().toISOString(),
    }
    return this.getSnapshot()!
  }

  update(input: z.infer<typeof goalUpdateSchema>): GoalDocument {
    const update = goalUpdateSchema.parse(input)
    const goal = this.requireGoal()
    if (goal.status !== 'active') throw new Error('Goal must be active to update it.')
    const plan = this.plan.getSnapshot()
    if (update.action === 'set_criteria') {
      if (!this.planPrepared || plan.todos.length === 0) {
        throw new Error('Call update_plan with a nonempty plan before setting completion criteria.')
      }
      this.change({ completionCriteria: update.criteria, needsReplan: false })
    } else if (update.action === 'blocked') {
      this.change({ status: 'blocked', stopReason: update.reason })
    } else {
      if (goal.needsReplan || !goal.completionCriteria.length || !plan.todos.length ||
        plan.todos.some(todo => todo.status !== 'completed')) {
        throw new Error('Complete planning and every Todo before completing the Goal.')
      }
      if (update.checks.length !== goal.completionCriteria.length) {
        throw new Error('Provide one check explanation for each completion criterion, in the same order.')
      }
      this.change({ status: 'completed', stopReason: undefined,
        completion: { summary: update.summary, checks: update.checks, checkedAt: new Date().toISOString() } })
    }
    return this.getSnapshot()!
  }

  pause(reason: string, force = false): void {
    if (this.document && (force || this.document.status !== 'completed')) {
      this.change({ status: 'paused', stopReason: reason, ...(force ? { completion: undefined } : {}) })
    }
  }

  resume(): void {
    const goal = this.requireGoal()
    if (goal.status === 'completed') throw new Error('This Goal is completed. Clear it before creating another.')
    this.change({ status: 'active', stopReason: undefined })
  }

  clear(): void { this.document = undefined; this.planPrepared = false }
  dispose(): void { this.unsubscribe() }

  private requireGoal(): GoalDocument {
    if (!this.document) throw new Error('No Goal. Use /goal <description> first.')
    return this.document
  }

  private change(patch: Partial<GoalDocument>): void {
    this.document = { ...this.requireGoal(), ...patch, updatedAt: new Date().toISOString() }
  }
}
