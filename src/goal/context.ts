import type { GoalManager } from './manager.js'
import { formatPlan } from '../plan/context.js'

export function formatGoal(manager: GoalManager, waiting = false): string {
  const goal = manager.getSnapshot()
  if (!goal) return 'No Goal. Use /goal <description> to create one.'
  return [
    `Goal: ${goal.status}${waiting ? ' (waiting for your answer)' : ''}`,
    goal.description,
    ...goal.completionCriteria.map((criterion, i) => `${i + 1}. ${criterion}`),
    goal.needsReplan ? 'Planning required.' : '',
    goal.stopReason ?? '', goal.completion?.summary ?? '',
    formatPlan(manager.plan.getSnapshot()),
  ].filter(Boolean).join('\n')
}

export function goalContext(manager: GoalManager): string {
  return [
    '<current_goal>', JSON.stringify(manager.getSnapshot()), '</current_goal>',
    'This is a user-created Goal. Follow its original description and the latest Plan.',
    'If needsReplan is true, call update_plan with a nonempty plan, then update_goal set_criteria.',
    'An ordinary final ends this turn, not the Goal. Active Goals continue in another turn.',
    'Use ask_user for missing information. Use update_goal blocked with a reason when unable to proceed.',
    'When all Todos and criteria are satisfied, use update_goal completed with a summary and one concrete check explanation per criterion.',
    'Check explanations must describe actual results; this MVP checks structure, not evidence references.',
    'Never change the original objective, invent user approval, or treat Todo completion alone as Goal completion.',
  ].join('\n')
}
