import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  formatEvalReport,
  runReplayEval,
  runReplayEvalFile,
} from '../src/eval.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

function passingSuite(): unknown {
  return {
    schemaVersion: 1,
    name: 'smoke',
    cases: [{
      id: 'read-then-answer',
      prompt: 'Read the package metadata.',
      modelSteps: [
        {
          type: 'tool_calls',
          calls: [{
            id: 'call-1',
            toolName: 'read_file',
            input: { path: 'package.json' },
          }],
          usage: {
            inputTokens: 80,
            outputTokens: 20,
            totalTokens: 100,
            source: 'fixture',
          },
        },
        {
          type: 'assistant',
          content: 'The package is mini-code.',
          usage: {
            inputTokens: 120,
            outputTokens: 30,
            totalTokens: 150,
            source: 'fixture',
          },
        },
      ],
      toolResults: [{
        toolName: 'read_file',
        ok: true,
        output: '{"name":"mini-code"}',
      }],
      expect: {
        assistantIncludes: ['mini-code'],
        toolSequence: ['read_file'],
        maxToolErrors: 0,
        maxModelRequests: 2,
        maxTotalTokens: 300,
      },
    }],
  }
}

describe('replay evaluation', () => {
  it('replays the agent loop and aggregates trace-backed metrics', async () => {
    const report = await runReplayEval(passingSuite(), {
      cwd: process.cwd(),
      now: () => new Date('2026-09-09T00:00:00.000Z'),
    })

    assert.equal(report.generatedAt, '2026-09-09T00:00:00.000Z')
    assert.deepEqual(report.summary, {
      total: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      durationMs: report.summary.durationMs,
      modelRequests: 2,
      toolCalls: 1,
      toolErrors: 0,
      totalTokens: 250,
    })
    assert.equal(report.cases[0].outcome, 'completed')
    assert.deepEqual(report.cases[0].failures, [])
    assert.match(formatEvalReport(report), /PASS read-then-answer/)
  })

  it('turns behavioral and budget regressions into actionable failures', async () => {
    const suite = passingSuite() as {
      cases: Array<{
        modelSteps: Array<{ content?: string }>
        expect: {
          assistantIncludes: string[]
          toolSequence: string[]
          maxTotalTokens: number
        }
      }>
    }
    suite.cases[0].modelSteps[1].content = 'A different answer'
    suite.cases[0].expect.toolSequence = ['grep_files']
    suite.cases[0].expect.maxTotalTokens = 200

    const report = await runReplayEval(suite)

    assert.equal(report.summary.failed, 1)
    assert.equal(report.cases[0].passed, false)
    assert.ok(report.cases[0].failures.some(failure =>
      failure.includes('assistant response is missing'),
    ))
    assert.ok(report.cases[0].failures.some(failure =>
      failure.includes('expected tool sequence'),
    ))
    assert.ok(report.cases[0].failures.some(failure =>
      failure.includes('total tokens 250 exceed limit 200'),
    ))
  })

  it('validates suites and writes machine-readable reports', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'minicode-eval-'))
    temporaryDirectories.push(directory)
    const suitePath = path.join(directory, 'suite.json')
    const reportPath = path.join(directory, 'reports', 'result.json')
    await writeFile(suitePath, JSON.stringify(passingSuite()), 'utf8')

    const report = await runReplayEvalFile({
      suitePath,
      outputPath: reportPath,
      cwd: directory,
    })
    const persisted = JSON.parse(await readFile(reportPath, 'utf8')) as {
      summary: { passed: number }
    }

    assert.equal(report.summary.passed, 1)
    assert.equal(persisted.summary.passed, 1)
    const invalid = passingSuite() as { cases: Array<{ id: string }> }
    invalid.cases.push({ ...invalid.cases[0] })
    await assert.rejects(() => runReplayEval(invalid), /Duplicate eval case id/)
  })
})
