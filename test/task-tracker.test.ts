import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTaskState,
  addTask,
  transitionTask,
  toSnapshot,
  fromSnapshot,
  formatTaskList,
} from '../src/task-state.js'

describe('createTaskState', () => {
  it('returns empty state with nextId 1', () => {
    const state = createTaskState()
    assert.deepEqual(state.tasks, [])
    assert.equal(state.nextId, 1)
  })
})

describe('addTask', () => {
  it('creates a pending task with auto-incrementing id', () => {
    const state = createTaskState()
    const t1 = addTask(state, 'First task')
    const t2 = addTask(state, 'Second task')

    assert.equal(t1.id, 1)
    assert.equal(t1.description, 'First task')
    assert.equal(t1.status, 'pending')
    assert.ok(t1.createdAt)
    assert.ok(t1.updatedAt)

    assert.equal(t2.id, 2)
    assert.equal(state.tasks.length, 2)
    assert.equal(state.nextId, 3)
  })
})

describe('transitionTask', () => {
  it('transitions pending -> in_progress', () => {
    const state = createTaskState()
    addTask(state, 'Task')
    const updated = transitionTask(state, 1, 'in_progress')
    assert.equal(updated.status, 'in_progress')
  })

  it('transitions pending -> completed', () => {
    const state = createTaskState()
    addTask(state, 'Task')
    const updated = transitionTask(state, 1, 'completed')
    assert.equal(updated.status, 'completed')
  })

  it('transitions in_progress -> completed', () => {
    const state = createTaskState()
    addTask(state, 'Task')
    transitionTask(state, 1, 'in_progress')
    const updated = transitionTask(state, 1, 'completed')
    assert.equal(updated.status, 'completed')
  })

  it('transitions in_progress -> pending', () => {
    const state = createTaskState()
    addTask(state, 'Task')
    transitionTask(state, 1, 'in_progress')
    const updated = transitionTask(state, 1, 'pending')
    assert.equal(updated.status, 'pending')
  })

  it('rejects completed -> pending', () => {
    const state = createTaskState()
    addTask(state, 'Task')
    transitionTask(state, 1, 'completed')
    assert.throws(
      () => transitionTask(state, 1, 'pending'),
      /cannot transition/,
    )
  })

  it('rejects completed -> in_progress', () => {
    const state = createTaskState()
    addTask(state, 'Task')
    transitionTask(state, 1, 'completed')
    assert.throws(
      () => transitionTask(state, 1, 'in_progress'),
      /cannot transition/,
    )
  })

  it('throws for unknown task id', () => {
    const state = createTaskState()
    assert.throws(
      () => transitionTask(state, 99, 'completed'),
      /not found/,
    )
  })

  it('updates the updatedAt timestamp', () => {
    const state = createTaskState()
    const task = addTask(state, 'Task')
    const before = task.updatedAt
    const updated = transitionTask(state, 1, 'in_progress')
    assert.ok(updated.updatedAt >= before)
  })
})

describe('toSnapshot / fromSnapshot', () => {
  it('round-trips state through snapshot', () => {
    const state = createTaskState()
    addTask(state, 'First')
    addTask(state, 'Second')
    transitionTask(state, 1, 'completed')

    const snapshot = toSnapshot(state)
    assert.ok(snapshot.timestamp)

    const restored = fromSnapshot(snapshot)
    assert.equal(restored.nextId, state.nextId)
    assert.equal(restored.tasks.length, 2)
    assert.equal(restored.tasks[0]!.status, 'completed')
    assert.equal(restored.tasks[1]!.status, 'pending')
  })

  it('produces independent copies', () => {
    const state = createTaskState()
    addTask(state, 'Task')

    const snapshot = toSnapshot(state)
    const restored = fromSnapshot(snapshot)

    addTask(state, 'Another')
    assert.equal(state.tasks.length, 2)
    assert.equal(restored.tasks.length, 1)
  })
})

describe('formatTaskList', () => {
  it('returns placeholder for empty state', () => {
    const state = createTaskState()
    assert.equal(formatTaskList(state), 'No tasks tracked in this session.')
  })

  it('formats tasks with correct icons', () => {
    const state = createTaskState()
    addTask(state, 'Do thing A')
    addTask(state, 'Do thing B')
    addTask(state, 'Do thing C')
    transitionTask(state, 1, 'completed')
    transitionTask(state, 2, 'in_progress')

    const output = formatTaskList(state)
    assert.ok(output.includes('Tasks (1/3 completed):'))
    assert.ok(output.includes('#1 [x] Do thing A'))
    assert.ok(output.includes('#2 [~] Do thing B'))
    assert.ok(output.includes('#3 [ ] Do thing C'))
  })

  it('truncates at 20 tasks', () => {
    const state = createTaskState()
    for (let i = 0; i < 25; i++) {
      addTask(state, `Task ${i}`)
    }
    const output = formatTaskList(state)
    assert.ok(output.includes('... and 5 more'))
    assert.ok(!output.includes('#21'))
  })
})
