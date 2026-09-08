import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { runAgentTurn } from './agent-loop.js'
import { ToolRegistry, type ToolDefinition } from './tool.js'
import type {
  AgentStep,
  AgentTraceEvent,
  ChatMessage,
  ModelAdapter,
} from './types.js'

const providerUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  source: z.string(),
}).strict()

const diagnosticsSchema = z.object({
  stopReason: z.string().optional(),
  blockTypes: z.array(z.string()).optional(),
  ignoredBlockTypes: z.array(z.string()).optional(),
}).strict()

const assistantStepSchema = z.object({
  type: z.literal('assistant'),
  content: z.string(),
  kind: z.enum(['final', 'progress']).optional(),
  diagnostics: diagnosticsSchema.optional(),
  usage: providerUsageSchema.optional(),
}).strict()

const toolCallsStepSchema = z.object({
  type: z.literal('tool_calls'),
  calls: z.array(z.object({
    id: z.string().min(1),
    toolName: z.string().min(1),
    input: z.unknown(),
  }).strict()).min(1),
  content: z.string().optional(),
  contentKind: z.literal('progress').optional(),
  diagnostics: diagnosticsSchema.optional(),
  usage: providerUsageSchema.optional(),
}).strict()

const replayCaseSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  systemPrompt: z.string().optional(),
  maxSteps: z.number().int().positive().optional(),
  modelSteps: z.array(
    z.discriminatedUnion('type', [assistantStepSchema, toolCallsStepSchema]),
  ).min(1),
  toolResults: z.array(z.object({
    toolName: z.string().min(1),
    ok: z.boolean(),
    output: z.string(),
    awaitUser: z.boolean().optional(),
  }).strict()).default([]),
  expect: z.object({
    outcome: z.enum([
      'completed',
      'awaiting_user',
      'max_steps',
      'failed',
      'aborted',
    ]).default('completed'),
    assistantIncludes: z.array(z.string()).default([]),
    toolSequence: z.array(z.string()).optional(),
    maxToolErrors: z.number().int().nonnegative().optional(),
    maxModelRequests: z.number().int().positive().optional(),
    maxTotalTokens: z.number().int().nonnegative().optional(),
  }).strict().default({ outcome: 'completed', assistantIncludes: [] }),
}).strict()

const replaySuiteSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  systemPrompt: z.string().default('You are running a deterministic agent evaluation.'),
  cases: z.array(replayCaseSchema).min(1),
}).strict().superRefine((suite, context) => {
  const ids = new Set<string>()
  suite.cases.forEach((testCase, index) => {
    if (ids.has(testCase.id)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate eval case id: ${testCase.id}`,
        path: ['cases', index, 'id'],
      })
    }
    ids.add(testCase.id)
  })
})

export type ReplayEvalSuite = z.infer<typeof replaySuiteSchema>

export type EvalCaseResult = {
  id: string
  passed: boolean
  outcome: string
  durationMs: number
  modelRequests: number
  toolCalls: number
  toolErrors: number
  totalTokens: number
  assistantChars: number
  failures: string[]
}

export type EvalReport = {
  schemaVersion: 1
  suite: string
  generatedAt: string
  summary: {
    total: number
    passed: number
    failed: number
    passRate: number
    durationMs: number
    modelRequests: number
    toolCalls: number
    toolErrors: number
    totalTokens: number
  }
  cases: EvalCaseResult[]
}

class ReplayModelAdapter implements ModelAdapter {
  private cursor = 0

  constructor(private readonly steps: AgentStep[]) {}

  async next(): Promise<AgentStep> {
    const step = this.steps[this.cursor++]
    if (!step) {
      throw new Error(`Replay exhausted after ${this.cursor - 1} model requests`)
    }
    return structuredClone(step)
  }

  get consumed(): number {
    return this.cursor
  }
}

function createReplayTools(
  modelSteps: AgentStep[],
  scriptedResults: ReplayEvalSuite['cases'][number]['toolResults'],
): { tools: ToolRegistry; consumedResults: () => number } {
  const names = new Set<string>()
  for (const step of modelSteps) {
    if (step.type === 'tool_calls') {
      for (const call of step.calls) names.add(call.toolName)
    }
  }
  for (const result of scriptedResults) names.add(result.toolName)

  let resultCursor = 0
  const definitions: ToolDefinition<unknown>[] = [...names].map(toolName => ({
    name: toolName,
    description: `Deterministic replay tool for ${toolName}`,
    inputSchema: {},
    schema: z.unknown(),
    async run() {
      const scripted = scriptedResults[resultCursor++]
      if (!scripted) {
        return {
          ok: false,
          output: `Replay has no scripted result for tool call ${toolName}`,
        }
      }
      if (scripted.toolName !== toolName) {
        return {
          ok: false,
          output: `Replay expected tool ${scripted.toolName}, received ${toolName}`,
        }
      }
      return {
        ok: scripted.ok,
        output: scripted.output,
        awaitUser: scripted.awaitUser,
      }
    },
  }))

  return {
    tools: new ToolRegistry(definitions),
    consumedResults: () => resultCursor,
  }
}

function lastAssistantContent(messages: ChatMessage[]): string {
  const message = [...messages]
    .reverse()
    .find(candidate => candidate.role === 'assistant')
  return message?.role === 'assistant' ? message.content : ''
}

function exactSequence(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
}

async function runCase(
  suite: ReplayEvalSuite,
  testCase: ReplayEvalSuite['cases'][number],
  cwd: string,
): Promise<EvalCaseResult> {
  const traceEvents: AgentTraceEvent[] = []
  const modelSteps = testCase.modelSteps as AgentStep[]
  const model = new ReplayModelAdapter(modelSteps)
  const replayTools = createReplayTools(modelSteps, testCase.toolResults)
  const startedAt = Date.now()
  let messages: ChatMessage[] = [
    {
      role: 'system',
      content: testCase.systemPrompt ?? suite.systemPrompt,
    },
    { role: 'user', content: testCase.prompt },
  ]
  let runtimeError: string | undefined

  try {
    messages = await runAgentTurn({
      model,
      tools: replayTools.tools,
      messages,
      cwd,
      maxSteps: testCase.maxSteps ?? Math.max(1, modelSteps.length + 1),
      onTrace: event => traceEvents.push(event),
    })
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error)
  }

  const assistant = lastAssistantContent(messages)
  const toolSequence = messages
    .filter(message => message.role === 'assistant_tool_call')
    .map(message => message.role === 'assistant_tool_call' ? message.toolName : '')
  const completed = [...traceEvents]
    .reverse()
    .find(event => event.type === 'turn_completed')
  const outcome = completed?.type === 'turn_completed'
    ? completed.outcome
    : 'failed'
  const modelEvents = traceEvents.filter(
    event => event.type === 'model_request_completed',
  )
  const totalTokens = modelEvents.reduce(
    (sum, event) => sum + (
      event.type === 'model_request_completed'
        ? event.usage?.totalTokens ?? 0
        : 0
    ),
    0,
  )
  const failures: string[] = []

  if (runtimeError) failures.push(`runtime error: ${runtimeError}`)
  if (outcome !== testCase.expect.outcome) {
    failures.push(`expected outcome=${testCase.expect.outcome}, received ${outcome}`)
  }
  for (const expectedText of testCase.expect.assistantIncludes) {
    if (!assistant.includes(expectedText)) {
      failures.push(`assistant response is missing ${JSON.stringify(expectedText)}`)
    }
  }
  if (
    testCase.expect.toolSequence &&
    !exactSequence(toolSequence, testCase.expect.toolSequence)
  ) {
    failures.push(
      `expected tool sequence ${JSON.stringify(testCase.expect.toolSequence)}, received ${JSON.stringify(toolSequence)}`,
    )
  }
  const toolErrors = completed?.type === 'turn_completed'
    ? completed.toolErrorCount
    : 0
  if (
    testCase.expect.maxToolErrors !== undefined &&
    toolErrors > testCase.expect.maxToolErrors
  ) {
    failures.push(
      `tool errors ${toolErrors} exceed limit ${testCase.expect.maxToolErrors}`,
    )
  }
  if (
    testCase.expect.maxModelRequests !== undefined &&
    model.consumed > testCase.expect.maxModelRequests
  ) {
    failures.push(
      `model requests ${model.consumed} exceed limit ${testCase.expect.maxModelRequests}`,
    )
  }
  if (
    testCase.expect.maxTotalTokens !== undefined &&
    totalTokens > testCase.expect.maxTotalTokens
  ) {
    failures.push(
      `total tokens ${totalTokens} exceed limit ${testCase.expect.maxTotalTokens}`,
    )
  }
  if (model.consumed !== modelSteps.length) {
    failures.push(
      `consumed ${model.consumed}/${modelSteps.length} scripted model steps`,
    )
  }
  if (replayTools.consumedResults() !== testCase.toolResults.length) {
    failures.push(
      `consumed ${replayTools.consumedResults()}/${testCase.toolResults.length} scripted tool results`,
    )
  }

  return {
    id: testCase.id,
    passed: failures.length === 0,
    outcome,
    durationMs: Date.now() - startedAt,
    modelRequests: model.consumed,
    toolCalls: completed?.type === 'turn_completed' ? completed.toolCallCount : 0,
    toolErrors,
    totalTokens,
    assistantChars: assistant.length,
    failures,
  }
}

export async function runReplayEval(
  input: unknown,
  options: { cwd?: string; now?: () => Date } = {},
): Promise<EvalReport> {
  const suite = replaySuiteSchema.parse(input)
  const startedAt = Date.now()
  const cases: EvalCaseResult[] = []
  for (const testCase of suite.cases) {
    cases.push(await runCase(suite, testCase, options.cwd ?? process.cwd()))
  }

  const passed = cases.filter(result => result.passed).length
  return {
    schemaVersion: 1,
    suite: suite.name,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    summary: {
      total: cases.length,
      passed,
      failed: cases.length - passed,
      passRate: passed / cases.length,
      durationMs: Date.now() - startedAt,
      modelRequests: cases.reduce((sum, result) => sum + result.modelRequests, 0),
      toolCalls: cases.reduce((sum, result) => sum + result.toolCalls, 0),
      toolErrors: cases.reduce((sum, result) => sum + result.toolErrors, 0),
      totalTokens: cases.reduce((sum, result) => sum + result.totalTokens, 0),
    },
    cases,
  }
}

export async function runReplayEvalFile(options: {
  suitePath: string
  cwd?: string
  outputPath?: string
}): Promise<EvalReport> {
  const content = await readFile(options.suitePath, 'utf8')
  const report = await runReplayEval(JSON.parse(content), { cwd: options.cwd })
  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true })
    await writeFile(
      options.outputPath,
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    )
  }
  return report
}

export function formatEvalReport(report: EvalReport): string {
  const lines = [
    `Eval ${report.suite}: ${report.summary.passed}/${report.summary.total} passed (${Math.round(report.summary.passRate * 100)}%)`,
  ]
  for (const result of report.cases) {
    const status = result.passed ? 'PASS' : 'FAIL'
    lines.push(
      `${status} ${result.id}  model=${result.modelRequests} tools=${result.toolCalls} errors=${result.toolErrors} tokens=${result.totalTokens} duration=${result.durationMs}ms`,
    )
    for (const failure of result.failures) lines.push(`  - ${failure}`)
  }
  return lines.join('\n')
}
