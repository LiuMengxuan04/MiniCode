export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = {
  id: number
  description: string
  status: TaskStatus
  createdAt: string
  updatedAt: string
}

export type TaskState = {
  tasks: Task[]
  nextId: number
}

export type TaskSnapshot = {
  tasks: Task[]
  nextId: number
  timestamp: string
}

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress', 'completed'],
  in_progress: ['completed', 'pending'],
  completed: [],
}

const MAX_DISPLAYED_TASKS = 20

export function createTaskState(): TaskState {
  return { tasks: [], nextId: 1 }
}

export function addTask(state: TaskState, description: string): Task {
  const now = new Date().toISOString()
  const task: Task = {
    id: state.nextId,
    description,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }
  state.tasks.push(task)
  state.nextId += 1
  return task
}

export function transitionTask(
  state: TaskState,
  id: number,
  status: TaskStatus,
): Task {
  const task = state.tasks.find(t => t.id === id)
  if (!task) {
    throw new Error(`Task #${id} not found`)
  }

  const allowed = VALID_TRANSITIONS[task.status]
  if (!allowed.includes(status)) {
    throw new Error(
      `Task #${id} is ${task.status} and cannot transition to ${status}`,
    )
  }

  task.status = status
  task.updatedAt = new Date().toISOString()
  return task
}

export function toSnapshot(state: TaskState): TaskSnapshot {
  return {
    tasks: state.tasks.map(t => ({ ...t })),
    nextId: state.nextId,
    timestamp: new Date().toISOString(),
  }
}

export function fromSnapshot(snapshot: TaskSnapshot): TaskState {
  return {
    tasks: snapshot.tasks.map(t => ({ ...t })),
    nextId: snapshot.nextId,
  }
}

export function formatTaskList(state: TaskState): string {
  if (state.tasks.length === 0) {
    return 'No tasks tracked in this session.'
  }

  const completed = state.tasks.filter(t => t.status === 'completed').length
  const total = state.tasks.length
  const header = `Tasks (${completed}/${total} completed):`

  const displayed = state.tasks.slice(0, MAX_DISPLAYED_TASKS)
  const lines = displayed.map(task => {
    const icon =
      task.status === 'completed' ? 'x'
      : task.status === 'in_progress' ? '~'
      : ' '
    return `  #${task.id} [${icon}] ${task.description}`
  })

  if (state.tasks.length > MAX_DISPLAYED_TASKS) {
    lines.push(`  ... and ${state.tasks.length - MAX_DISPLAYED_TASKS} more`)
  }

  return [header, ...lines].join('\n')
}
