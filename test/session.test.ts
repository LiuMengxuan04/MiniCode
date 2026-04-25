import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  saveSession,
  loadSession,
  clearSession,
  listSessions,
  renameSession,
  appendCompactBoundary,
  loadTranscript,
  forkSession,
  cleanupExpiredSessions,
  listAllProjects,
} from '../src/session.js'
import { MINI_CODE_PROJECTS_DIR } from '../src/config.js'
import type { ChatMessage } from '../src/types.js'

const testDir = path.join(os.tmpdir(), 'minicode-session-test')

function makeMessages(count: number): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
  ]
  for (let i = 0; i < count; i++) {
    messages.push({ role: 'user', content: `User message ${i}` })
    messages.push({ role: 'assistant', content: `Assistant response ${i}` })
  }
  return messages
}

function projectDirName(cwd: string): string {
  return cwd.replace(/[/\\:]+/g, '-').replace(/^-+/, '')
}

async function cleanupAll() {
  try { await rm(MINI_CODE_PROJECTS_DIR, { recursive: true, force: true }) } catch {}
}

describe('session persistence', () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
    await cleanupAll()
  })

  it('round-trips messages and excludes system prompt', async () => {
    const cwd = path.join(testDir, 'project-a')
    const messages = makeMessages(3)

    await saveSession(cwd, 'abc12345', messages)
    const loaded = await loadSession(cwd, 'abc12345')

    assert.notEqual(loaded, null)
    assert.equal(loaded!.length, 6)
    assert.equal(loaded![0].role, 'user')
    assert.equal(loaded![0].content, 'User message 0')
    assert.equal(loaded![5].role, 'assistant')
    assert.equal(loaded![5].content, 'Assistant response 2')
  })

  it('returns null for nonexistent session', async () => {
    const cwd = path.join(testDir, 'no-such-project')
    const loaded = await loadSession(cwd, 'nonexist')
    assert.equal(loaded, null)
  })

  it('clears an existing session', async () => {
    const cwd = path.join(testDir, 'project-b')
    await saveSession(cwd, 'sess0001', makeMessages(1))
    assert.notEqual(await loadSession(cwd, 'sess0001'), null)

    await clearSession(cwd, 'sess0001')
    assert.equal(await loadSession(cwd, 'sess0001'), null)
  })

  it('clearSession does not throw for nonexistent session', async () => {
    const cwd = path.join(testDir, 'no-such-project')
    await assert.doesNotReject(() => clearSession(cwd, 'nonexist'))
  })

  it('saveSession skips save when only system prompt exists', async () => {
    const cwd = path.join(testDir, 'empty-project')
    await saveSession(cwd, 'skip0001', [{ role: 'system', content: 'system' }])
    assert.equal(await loadSession(cwd, 'skip0001'), null)
  })

  it('preserves all ChatMessage role types', async () => {
    const cwd = path.join(testDir, 'all-types')
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'assistant_tool_call', toolUseId: 'c1', toolName: 'read_file', input: { path: '/a.ts' } },
      { role: 'tool_result', toolUseId: 'c1', toolName: 'read_file', content: 'file contents', isError: false },
      { role: 'context_summary', content: 'summary text', compressedCount: 5, timestamp: 12345 },
    ]

    await saveSession(cwd, 'types001', messages)
    const loaded = await loadSession(cwd, 'types001')

    assert.equal(loaded!.length, 5)
    assert.equal(loaded![0].role, 'user')
    assert.equal(loaded![1].role, 'assistant')
    assert.equal(loaded![2].role, 'assistant_tool_call')
    assert.equal(loaded![3].role, 'tool_result')
    assert.equal(loaded![4].role, 'context_summary')
  })

  it('stores events in envelope jsonl format', async () => {
    const cwd = path.join(testDir, 'envelope-check')
    await saveSession(cwd, 'env0001', makeMessages(1))

    const pdir = path.join(MINI_CODE_PROJECTS_DIR, projectDirName(cwd))
    const filePath = path.join(pdir, 'env0001.jsonl')
    const content = await readFile(filePath, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)

    assert.equal(lines.length, 2)
    const first = JSON.parse(lines[0]!)
    assert.equal(first.type, 'user')
    assert.equal(first.message.role, 'user')
    assert.ok(first.uuid)
    assert.ok(first.timestamp)
    assert.equal(first.sessionId, 'env0001')
    assert.ok(first.cwd)
  })

  it('uses path-based directory name', async () => {
    const cwd = path.join(testDir, 'my-cool-project')
    await saveSession(cwd, 'path001', makeMessages(1))

    const pdir = path.join(MINI_CODE_PROJECTS_DIR, projectDirName(cwd))
    const filePath = path.join(pdir, 'path001.jsonl')
    const content = await readFile(filePath, 'utf8')
    assert.ok(content.length > 0)
  })

  it('appends only new messages with alreadySavedCount', async () => {
    const cwd = path.join(testDir, 'append-test')
    const msgs1 = makeMessages(1)
    await saveSession(cwd, 'append001', msgs1, 0)

    // Add more messages — only the new ones should be appended
    const msgs2: ChatMessage[] = [
      ...msgs1,
      { role: 'user', content: 'extra user' },
      { role: 'assistant', content: 'extra assistant' },
    ]
    await saveSession(cwd, 'append001', msgs2, 2) // already saved 2

    const loaded = await loadSession(cwd, 'append001')
    assert.equal(loaded!.length, 4)
    assert.equal(loaded![2].content, 'extra user')
    assert.equal(loaded![3].content, 'extra assistant')

    // Verify file has exactly 4 event lines (no duplicates)
    const pdir = path.join(MINI_CODE_PROJECTS_DIR, projectDirName(cwd))
    const content = await readFile(path.join(pdir, 'append001.jsonl'), 'utf8')
    assert.equal(content.trim().split('\n').filter(Boolean).length, 4)
  })

  it('listSessions returns multiple sessions for same cwd', async () => {
    const cwd = path.join(testDir, 'multi-project')
    await saveSession(cwd, 'sess0001', makeMessages(2))
    await new Promise(r => setTimeout(r, 5))
    await saveSession(cwd, 'sess0002', makeMessages(3))

    const sessions = await listSessions(cwd)

    assert.equal(sessions.length, 2)
    assert.equal(sessions[0]!.id, 'sess0002')
    assert.equal(sessions[0]!.messageCount, 6)
    assert.equal(sessions[1]!.id, 'sess0001')
    assert.equal(sessions[1]!.messageCount, 4)
  })

  it('listSessions isolates sessions by cwd', async () => {
    const cwdA = path.join(testDir, 'project-a')
    const cwdB = path.join(testDir, 'project-b')
    await saveSession(cwdA, 'onlyA0001', makeMessages(1))
    await saveSession(cwdB, 'onlyB0001', makeMessages(1))

    const sessionsA = await listSessions(cwdA)
    const sessionsB = await listSessions(cwdB)

    assert.equal(sessionsA.length, 1)
    assert.equal(sessionsA[0]!.id, 'onlyA0001')
    assert.equal(sessionsB.length, 1)
    assert.equal(sessionsB[0]!.id, 'onlyB0001')
  })

  it('listSessions returns empty array when no sessions exist', async () => {
    const cwd = path.join(testDir, 'no-sessions')
    const sessions = await listSessions(cwd)
    assert.equal(sessions.length, 0)
  })

  it('saveSession extracts first user message as title', async () => {
    const cwd = path.join(testDir, 'title-test')
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Fix the login bug in auth.ts' },
      { role: 'assistant', content: 'OK' },
    ]
    await saveSession(cwd, 'title001', messages)
    const sessions = await listSessions(cwd)
    assert.equal(sessions[0]!.title, 'Fix the login bug in auth.ts')
  })

  it('saveSession truncates long title to 60 chars', async () => {
    const cwd = path.join(testDir, 'long-title')
    const longMsg = 'A'.repeat(120)
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: longMsg },
    ]
    await saveSession(cwd, 'longtit01', messages)
    const sessions = await listSessions(cwd)
    assert.equal(sessions[0]!.title!.length, 63) // 60 + '...'
  })

  it('renameSession updates title', async () => {
    const cwd = path.join(testDir, 'rename-test')
    await saveSession(cwd, 'rename001', makeMessages(1))
    const ok = await renameSession(cwd, 'rename001', 'My Custom Name')
    assert.equal(ok, true)
    const sessions = await listSessions(cwd)
    assert.equal(sessions[0]!.title, 'My Custom Name')
  })

  it('renameSession returns false for nonexistent session', async () => {
    const cwd = path.join(testDir, 'no-rename')
    const result = await renameSession(cwd, 'nonexist', 'Name')
    assert.equal(result, false)
  })

  it('appendCompactBoundary writes boundary + summary events', async () => {
    const cwd = path.join(testDir, 'compact-test')
    await saveSession(cwd, 'cmp001', makeMessages(2), 0)

    await appendCompactBoundary(cwd, 'cmp001', 'Summary of previous context', 'auto', 100000, 5000)

    const pdir = path.join(MINI_CODE_PROJECTS_DIR, projectDirName(cwd))
    const content = await readFile(path.join(pdir, 'cmp001.jsonl'), 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)

    // 4 original + 1 boundary + 1 summary = 6
    assert.equal(lines.length, 6)

    const boundary = JSON.parse(lines[4]!)
    assert.equal(boundary.type, 'compact_boundary')
    assert.equal(boundary.compactMetadata.trigger, 'auto')
    assert.equal(boundary.compactMetadata.preTokens, 100000)
    assert.equal(boundary.compactMetadata.postTokens, 5000)

    const summary = JSON.parse(lines[5]!)
    assert.equal(summary.type, 'user')
    assert.equal(summary.message.content, 'Summary of previous context')
  })

  it('loadSession only loads from last compact_boundary', async () => {
    const cwd = path.join(testDir, 'compact-load')

    // Save 4 messages
    await saveSession(cwd, 'cmp002', makeMessages(2), 0)

    // Compact: adds boundary + summary
    await appendCompactBoundary(cwd, 'cmp002', 'Summary of 4 messages', 'manual', 50000, 3000)

    // Save 2 more messages after compact
    const postCompact: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'after compact user' },
      { role: 'assistant', content: 'after compact assistant' },
    ]
    await saveSession(cwd, 'cmp002', postCompact, 0)

    // loadSession should return: summary + 2 post-compact messages = 3
    const loaded = await loadSession(cwd, 'cmp002')
    assert.equal(loaded!.length, 3)
    assert.equal(loaded![0].content, 'Summary of 4 messages')
    assert.equal(loaded![1].content, 'after compact user')
    assert.equal(loaded![2].content, 'after compact assistant')
  })

  it('loadTranscript rebuilds from session envelopes', async () => {
    const cwd = path.join(testDir, 'tx-rebuild')
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'assistant_tool_call', toolUseId: 't1', toolName: 'read_file', input: { path: '/a.ts' } },
      { role: 'tool_result', toolUseId: 't1', toolName: 'read_file', content: 'file', isError: false },
    ]
    await saveSession(cwd, 'tx001', messages)

    const transcript = await loadTranscript(cwd, 'tx001')
    assert.notEqual(transcript, null)
    assert.equal(transcript!.length, 3) // user + assistant + tool_call
    assert.equal(transcript![0]!.kind, 'user')
    assert.equal(transcript![1]!.kind, 'assistant')
    assert.equal(transcript![2]!.kind, 'tool')
  })

  it('loadTranscript returns null for nonexistent session', async () => {
    const cwd = path.join(testDir, 'no-tx')
    const loaded = await loadTranscript(cwd, 'nonexist')
    assert.equal(loaded, null)
  })

  it('saveSession writes parentUuid chain linking consecutive events', async () => {
    const cwd = path.join(testDir, 'parent-chain')
    await saveSession(cwd, 'chain001', makeMessages(2), 0)

    const pdir = path.join(MINI_CODE_PROJECTS_DIR, projectDirName(cwd))
    const content = await readFile(path.join(pdir, 'chain001.jsonl'), 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)

    // 4 events: user0, assistant0, user1, assistant1
    assert.equal(lines.length, 4)

    const events = lines.map(l => JSON.parse(l!))

    // First event: parentUuid is null (root of the tree)
    assert.equal(events[0].parentUuid, null)
    assert.ok(events[0].uuid)

    // Each subsequent event's parentUuid points to previous event's uuid
    for (let i = 1; i < events.length; i++) {
      assert.equal(events[i].parentUuid, events[i - 1].uuid,
        `Event ${i} parentUuid should point to event ${i - 1} uuid`)
      assert.ok(events[i].uuid)
    }
  })

  it('diff-append continues parentUuid chain from last event in file', async () => {
    const cwd = path.join(testDir, 'parent-append')
    const msgs1 = makeMessages(1)
    await saveSession(cwd, 'append001', msgs1, 0)

    const pdir = path.join(MINI_CODE_PROJECTS_DIR, projectDirName(cwd))
    let content = await readFile(path.join(pdir, 'append001.jsonl'), 'utf8')
    let lines = content.trim().split('\n').filter(Boolean)
    const lastUuidOfFirstBatch = JSON.parse(lines[lines.length - 1]!).uuid

    // Append more messages
    const msgs2: ChatMessage[] = [
      ...msgs1,
      { role: 'user', content: 'extra user' },
      { role: 'assistant', content: 'extra assistant' },
    ]
    await saveSession(cwd, 'append001', msgs2, 2)

    content = await readFile(path.join(pdir, 'append001.jsonl'), 'utf8')
    lines = content.trim().split('\n').filter(Boolean)
    assert.equal(lines.length, 4)

    const events = lines.map(l => JSON.parse(l!))

    // First new event should chain from last event of first batch
    assert.equal(events[2].parentUuid, lastUuidOfFirstBatch)
    assert.equal(events[3].parentUuid, events[2].uuid)
  })

  it('compact_boundary has null parentUuid and logicalParentUuid pointing to last event', async () => {
    const cwd = path.join(testDir, 'parent-compact')
    await saveSession(cwd, 'cmpch001', makeMessages(1), 0)

    const pdir = path.join(MINI_CODE_PROJECTS_DIR, projectDirName(cwd))
    let content = await readFile(path.join(pdir, 'cmpch001.jsonl'), 'utf8')
    let lines = content.trim().split('\n').filter(Boolean)
    const lastEventUuid = JSON.parse(lines[lines.length - 1]!).uuid

    await appendCompactBoundary(cwd, 'cmpch001', 'Summary text', 'manual', 50000, 3000)

    content = await readFile(path.join(pdir, 'cmpch001.jsonl'), 'utf8')
    lines = content.trim().split('\n').filter(Boolean)

    const boundary = JSON.parse(lines[2]!)
    assert.equal(boundary.type, 'compact_boundary')
    assert.equal(boundary.parentUuid, null)
    assert.equal(boundary.logicalParentUuid, lastEventUuid)

    // Summary after boundary chains from boundary
    const summary = JSON.parse(lines[3]!)
    assert.equal(summary.type, 'user')
    assert.equal(summary.parentUuid, boundary.uuid)
  })

  it('forkSession creates new session with copy of messages', async () => {
    const cwd = path.join(testDir, 'fork-basic')
    const msgs = makeMessages(2)
    await saveSession(cwd, 'orig001', msgs)

    const forkId = await forkSession(cwd, 'orig001')

    // Fork has a different ID
    assert.notEqual(forkId, 'orig001')
    assert.ok(forkId.length > 0)

    // Fork loads the same messages (excluding system prompt)
    const forked = await loadSession(cwd, forkId)
    const original = await loadSession(cwd, 'orig001')
    assert.equal(forked!.length, original!.length)
    assert.equal(forked![0].content, original![0].content)
    assert.equal(forked![3].content, original![3].content)

    // Original unchanged
    assert.notEqual(await loadSession(cwd, 'orig001'), null)
  })

  it('forkSession creates independent session — modifications do not affect original', async () => {
    const cwd = path.join(testDir, 'fork-indep')
    await saveSession(cwd, 'orig002', makeMessages(1))

    const forkId = await forkSession(cwd, 'orig002')

    // Append to fork
    const forkMsgs: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'fork only message' },
    ]
    await saveSession(cwd, forkId, forkMsgs, 0)

    // Original should not have the new message
    const original = await loadSession(cwd, 'orig002')
    assert.equal(original!.length, 2)
    assert.equal(original![1].content, 'Assistant response 0')

    // Fork should have original + new
    const forked = await loadSession(cwd, forkId)
    assert.equal(forked!.length, 3)
    assert.equal(forked![2].content, 'fork only message')
  })

  it('forkSession preserves parentUuid chain in new file', async () => {
    const cwd = path.join(testDir, 'fork-parentuuid')
    await saveSession(cwd, 'orig003', makeMessages(1))

    const forkId = await forkSession(cwd, 'orig003')

    const pdir = path.join(MINI_CODE_PROJECTS_DIR, projectDirName(cwd))
    const content = await readFile(path.join(pdir, `${forkId}.jsonl`), 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    const events = lines.map(l => JSON.parse(l!))
    const messageEvents = events.filter(e => e.type !== 'rename')

    // First message event should be root (parentUuid null)
    assert.equal(messageEvents[0].parentUuid, null)
    // Chain should be valid across message events
    for (let i = 1; i < messageEvents.length; i++) {
      assert.equal(messageEvents[i].parentUuid, messageEvents[i - 1].uuid)
    }
  })

  it('forkSession returns null for nonexistent session', async () => {
    const cwd = path.join(testDir, 'fork-noexist')
    const result = await forkSession(cwd, 'nonexist')
    assert.equal(result, null)
  })

  it('forkSession appends _fork1 to original title', async () => {
    const cwd = path.join(testDir, 'fork-title')
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Fix the login bug' },
      { role: 'assistant', content: 'OK' },
    ]
    await saveSession(cwd, 'title001', msgs)

    const forkId = await forkSession(cwd, 'title001')

    const sessions = await listSessions(cwd)
    const forked = sessions.find(s => s.id === forkId)
    assert.equal(forked!.title, 'Fix the login bug_fork1')
  })

  it('forkSession increments fork number for multiple forks', async () => {
    const cwd = path.join(testDir, 'fork-multi')
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Hello world' },
      { role: 'assistant', content: 'Hi' },
    ]
    await saveSession(cwd, 'multi001', msgs)

    const fork1 = await forkSession(cwd, 'multi001')
    const fork2 = await forkSession(cwd, 'multi001')

    const sessions = await listSessions(cwd)
    const f1 = sessions.find(s => s.id === fork1)
    const f2 = sessions.find(s => s.id === fork2)
    assert.equal(f1!.title, 'Hello world_fork1')
    assert.equal(f2!.title, 'Hello world_fork2')
  })

  it('cleanupExpiredSessions removes old sessions, keeps recent ones', async () => {
    const cwd = path.join(testDir, 'expiry-test')
    await saveSession(cwd, 'recent001', makeMessages(1))
    await saveSession(cwd, 'recent002', makeMessages(1))

    // Make old001's file mtime old by touching it to past
    const pdir = path.join(MINI_CODE_PROJECTS_DIR, projectDirName(cwd))
    const oldPath = path.join(pdir, 'old001.jsonl')
    await saveSession(cwd, 'old001', makeMessages(1))
    // Set mtime to 31 days ago
    const oldTime = Date.now() - 31 * 24 * 60 * 60 * 1000
    const { utimes } = await import('node:fs/promises')
    await utimes(oldPath, new Date(oldTime), new Date(oldTime))

    const removed = await cleanupExpiredSessions(cwd, 30 * 24 * 60 * 60 * 1000)

    assert.equal(removed, 1)
    assert.equal(await loadSession(cwd, 'old001'), null)
    assert.notEqual(await loadSession(cwd, 'recent001'), null)
    assert.notEqual(await loadSession(cwd, 'recent002'), null)
  })

  it('listAllProjects returns all projects with sessions', async () => {
    const cwdA = path.join(testDir, 'proj-a')
    const cwdB = path.join(testDir, 'proj-b')
    await saveSession(cwdA, 'sessA001', makeMessages(1))
    await saveSession(cwdB, 'sessB001', makeMessages(1))

    const projects = await listAllProjects()
    assert.ok(projects.length >= 2)
    const dirs = projects.map(p => p.dir)
    assert.ok(dirs.some(d => d.includes('proj-a')))
    assert.ok(dirs.some(d => d.includes('proj-b')))
    // Each project has sessionCount
    const projA = projects.find(p => p.dir.includes('proj-a'))
    assert.equal(projA!.sessionCount, 1)
  })

  it('listAllProjects skips empty directories', async () => {
    const projects = await listAllProjects()
    // Should not include directories with no jsonl files
    for (const p of projects) {
      assert.ok(p.sessionCount > 0)
    }
  })
})
