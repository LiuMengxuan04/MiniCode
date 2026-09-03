import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  PermissionManager,
  type PermissionDecision,
} from '../src/permissions.js'

async function withWorkspace(
  prefix: string,
  run: (workspace: string) => Promise<void>,
): Promise<void> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), prefix))
  try {
    await run(workspace)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

describe('edit permission decisions', () => {
  it('prompts again for a revised diff after allow_once', async () => {
    await withWorkspace('minicode-allow-once-', async workspace => {
      const target = path.join(workspace, 'example.ts')
      const firstDiff = 'diff: first revision'
      const secondDiff = 'diff: second revision'
      const promptedDiffs: string[] = []
      const permissions = new PermissionManager(workspace, async request => {
        promptedDiffs.push(request.details.at(-1) ?? '')
        return { decision: 'allow_once' }
      })

      permissions.beginTurn()
      await permissions.ensureEdit(target, firstDiff)
      await permissions.ensureEdit(target, secondDiff)

      assert.deepEqual(promptedDiffs, [firstDiff, secondDiff])
    })
  })

  it('prompts again for a revised diff after deny_once', async () => {
    await withWorkspace('minicode-deny-once-', async workspace => {
      const target = path.join(workspace, 'example.ts')
      const firstDiff = 'diff: first rejection'
      const secondDiff = 'diff: second revision'
      const promptedDiffs: string[] = []
      const decisions: PermissionDecision[] = ['deny_once', 'allow_once']
      const permissions = new PermissionManager(workspace, async request => {
        const decision = decisions[promptedDiffs.length]
        assert.ok(decision)
        promptedDiffs.push(request.details.at(-1) ?? '')
        return { decision }
      })

      permissions.beginTurn()
      await assert.rejects(permissions.ensureEdit(target, firstDiff), /Edit denied/)
      await permissions.ensureEdit(target, secondDiff)

      assert.deepEqual(promptedDiffs, [firstDiff, secondDiff])
    })
  })

  it('limits allow_turn to its file and current turn', async () => {
    await withWorkspace('minicode-allow-turn-', async workspace => {
      const firstTarget = path.join(workspace, 'first.ts')
      const secondTarget = path.join(workspace, 'second.ts')
      const firstDiff = 'diff: first file initial'
      const revisedDiff = 'diff: first file revised'
      const otherFileDiff = 'diff: second file'
      const nextTurnDiff = 'diff: first file next turn'
      const promptedDiffs: string[] = []
      const decisions: PermissionDecision[] = [
        'allow_turn',
        'allow_once',
        'allow_once',
      ]
      const permissions = new PermissionManager(workspace, async request => {
        const decision = decisions[promptedDiffs.length]
        assert.ok(decision)
        promptedDiffs.push(request.details.at(-1) ?? '')
        return { decision }
      })

      permissions.beginTurn()
      await permissions.ensureEdit(firstTarget, firstDiff)
      await permissions.ensureEdit(firstTarget, revisedDiff)
      await permissions.ensureEdit(secondTarget, otherFileDiff)
      permissions.endTurn()
      permissions.beginTurn()
      await permissions.ensureEdit(firstTarget, nextTurnDiff)

      assert.deepEqual(promptedDiffs, [firstDiff, otherFileDiff, nextTurnDiff])
    })
  })
})
