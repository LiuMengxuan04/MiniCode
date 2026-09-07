import crypto from 'node:crypto'
import readline from 'node:readline'
import process from 'node:process'
import { AnthropicModelAdapter } from './anthropic-adapter.js'
import {
  completeSlashCommand,
  findMatchingSlashCommands,
  tryHandleLocalCommand,
} from './cli-commands.js'
import { loadRuntimeConfig } from './config.js'
import { forkSession } from './session.js'
import { maybeHandleManagementCommand } from './manage-cli.js'
import { summarizeMcpServers } from './mcp-status.js'
import { MockModelAdapter } from './mock-model.js'
import { PermissionManager } from './permissions.js'
import { buildSystemPrompt } from './prompt.js'
import { PlanManager } from './plan/manager.js'
import {
  createDefaultToolRegistry,
  hydrateMcpTools,
  SUB_AGENT_TOOL_NAMES,
} from './tools/index.js'
import { createSubAgentTools } from './tools/sub-agents.js'
import { SubAgentManager } from './agents/manager.js'
import type { ChatMessage } from './types.js'
import { renderBanner } from './ui.js'
import { runTtyApp } from './tty-app.js'
import { SessionRuntime } from './runtime/session-runtime.js'
import { runAgentTurnWithOutcome } from './agent-loop.js'
import {
  applyContextCollapseIfNeeded,
  createContextCollapseState,
} from './compact/context-collapse.js'
import { createContentReplacementState } from './utils/tool-result-storage.js'

async function main(): Promise<void> {
  const cwd = process.cwd()
  const argv = process.argv.slice(2)

  let resumeTarget: string | 'picker' | undefined
  const resumeIndex = argv.indexOf('--resume')
  if (resumeIndex !== -1) {
    argv.splice(resumeIndex, 1)
    const nextArg = argv[resumeIndex]
    if (nextArg && !nextArg.startsWith('-')) {
      resumeTarget = nextArg
      argv.splice(resumeIndex, 1)
    } else {
      resumeTarget = 'picker'
    }
  }

  let forkTarget: string | undefined
  const forkIndex = argv.indexOf('--fork')
  if (forkIndex !== -1) {
    argv.splice(forkIndex, 1)
    const nextArg = argv[forkIndex]
    if (nextArg && !nextArg.startsWith('-')) {
      forkTarget = nextArg
      argv.splice(forkIndex, 1)
    }
  }

  if (await maybeHandleManagementCommand(cwd, argv)) {
    return
  }

  const isInteractiveTerminal = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  let runtime = null
  try {
    runtime = await loadRuntimeConfig()
  } catch {
    runtime = null
  }

  let sessionId = crypto.randomUUID().slice(0, 8)
  const plan = new PlanManager(sessionId)
  const tools = await createDefaultToolRegistry({
    cwd,
    runtime,
    plan,
  })
  const mcpHydration = hydrateMcpTools({
    cwd,
    runtime,
    tools,
  }).catch(() => {
    // Keep startup resilient even if some MCP servers fail.
  })
  const permissions = new PermissionManager(cwd)
  await permissions.whenReady()
  const model =
    process.env.MINI_CODE_MODEL_MODE === 'mock'
      ? new MockModelAdapter()
      : new AnthropicModelAdapter(tools, loadRuntimeConfig)
  const subAgents = new SubAgentManager({
    model,
    tools: tools.subset(SUB_AGENT_TOOL_NAMES),
    cwd,
  })
  tools.addTools(createSubAgentTools(subAgents))
  let messages: ChatMessage[] = [
    {
      role: 'system',
      content: await buildSystemPrompt(cwd, permissions.getSummary(), {
        skills: tools.getSkills(),
        mcpServers: tools.getMcpServers(),
        subAgents: { maxConcurrent: subAgents.maxConcurrent },
      }),
    },
  ]
  const contentReplacementState = createContentReplacementState()
  const contextCollapseState = createContextCollapseState()

  async function refreshSystemPrompt(): Promise<void> {
    messages[0] = {
      role: 'system',
      content: await buildSystemPrompt(cwd, permissions.getSummary(), {
        skills: tools.getSkills(),
        mcpServers: tools.getMcpServers(),
        subAgents: { maxConcurrent: subAgents.maxConcurrent },
      }),
    }
  }

  try {
    if (isInteractiveTerminal) {
      let resolvedResumeTarget = resumeTarget

      if (forkTarget) {
        const forkedId = await forkSession(cwd, forkTarget)
        if (forkedId) {
          sessionId = forkedId
          plan.reset(sessionId)
          resolvedResumeTarget = forkedId
        } else {
          console.error(`Session ${forkTarget} not found or empty.`)
        }
      }

      await runTtyApp({
        runtime,
        tools,
        model,
        subAgents,
        plan,
        messages,
        cwd,
        permissions,
        contentReplacementState,
        contextCollapseState,
        sessionId,
        alreadySavedCount: 0,
        resumeTarget: resolvedResumeTarget,
      })
      return
    }

    const mcpStatus = summarizeMcpServers(tools.getMcpServers())
    console.log(
      renderBanner(runtime, cwd, permissions.getSummary(), {
        transcriptCount: 0,
        messageCount: messages.length,
        skillCount: tools.getSkills().length,
        mcpTotalCount: mcpStatus.total,
        mcpConnectedCount: mcpStatus.connected,
        mcpConnectingCount: mcpStatus.connecting,
        mcpErrorCount: mcpStatus.error,
      }),
    )
    console.log('')

    let localBusy = false
    const execution = new SessionRuntime({
      plan, tools, isBusy: () => localBusy,
      async execute(request) {
        await refreshSystemPrompt()
        messages = [...messages, request.input]
        permissions.beginTurn(request.signal)
        try {
          const result = await runAgentTurnWithOutcome({
            model, tools: execution.toolsFor(request.mode), plan, messages, cwd, permissions,
            runtimeContext: () => execution.contextFor(request.mode),
            signal: request.signal, maxSteps: request.mode ? 50 : undefined,
            stopOnFatalToolError: !!request.mode,
            modelName: runtime?.model ?? '', contentReplacementState, contextCollapseState,
            onAssistantMessage: content => console.log(`\n${content}\n`),
          })
          messages = result.messages
          if (result.error) console.log(`\n${result.error}\n`)
          return result
        } finally {
          permissions.endTurn()
        }
      },
      async recordAnswer(input) { messages.push(input) },
      notice: message => console.log(`\n${message}\n`),
      settleWorkers: () => subAgents.closeAll(),
    })
    const stopOnInterrupt = () => { void execution.stop() }
    process.on('SIGINT', stopOnInterrupt)

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: completeSlashCommand,
    })

    for await (const rawInput of rl) {
      const input = rawInput.trim()
      if (!input) {
        continue
      }
      if (input === '/exit') break

      try {
        try {
          const runtimeReply = await execution.command(input)
          if (runtimeReply !== null) {
            console.log(`\n${runtimeReply}\n`)
            continue
          }
          if (input === '/plan') {
            console.log(await tryHandleLocalCommand(input, { plan }))
            continue
          }
          if (execution.turns.busy || execution.goal.running || execution.loop.running) {
            console.log('Current turn is running. Use /goal pause, /loop stop, or /exit.')
            continue
          }
          localBusy = true
          if (input === '/tools') {
            console.log(
              `\n${tools.list().map(tool => `${tool.name}: ${tool.description}`).join('\n')}\n`,
            )
            continue
          }

          if (input === '/collapse') {
            if (!runtime?.model) {
              console.log('\nNo model configured. Cannot collapse context.\n')
              continue
            }

            const result = await applyContextCollapseIfNeeded(
              messages,
              runtime.model,
              model,
              contextCollapseState,
              {
                utilizationThreshold: 0,
                reason: 'manual',
              },
            )
            contextCollapseState.spans = [...result.state.spans]
            contextCollapseState.enabled = result.state.enabled
            contextCollapseState.consecutiveFailures = result.state.consecutiveFailures

            if (!result.collapsed) {
              console.log(
                result.state.enabled
                  ? '\nNothing safe to collapse.\n'
                  : '\nContext collapse is disabled after repeated summary failures.\n',
              )
              continue
            }

            const savedTokens = result.spans.reduce(
              (sum, span) => sum + Math.max(0, span.tokensBefore - span.tokensAfter),
              0,
            )
            console.log(
              `\nContext collapse projected ${result.spans.length} span${result.spans.length === 1 ? '' : 's'} into model-visible summaries, saving ~${Math.round(savedTokens)} tokens. Original transcript is preserved.\n`,
            )
            continue
          }

          const localCommandResult = await tryHandleLocalCommand(input, {
            cwd,
            tools,
            plan,
            permissionSummary: permissions.getSummary(),
          })
          if (localCommandResult !== null) {
            console.log(`\n${localCommandResult}\n`)
            continue
          }

          if (input.startsWith('/')) {
            const matches = findMatchingSlashCommands(input)
            if (matches.length > 0) {
              console.log(`\n未识别命令。你是不是想输入：\n${matches.join('\n')}\n`)
            } else {
              console.log(`\n未识别命令。输入 /help 查看可用命令。\n`)
            }
            continue
          }
        } catch (error) {
          console.log(
            `\n${error instanceof Error ? error.message : String(error)}\n`,
          )
          continue
        }

        try {
          await execution.submit(input)
        } catch (error) {
          console.log(error instanceof Error ? error.message : String(error))
        }
      } finally {
        localBusy = false
        execution.notifyIdle()
      }
    }

    await execution.stop()
    execution.goal.manager.dispose()
    process.off('SIGINT', stopOnInterrupt)

    try {
      rl.close()
    } catch {
      // Ignore double-close during EOF teardown.
    }
  } finally {
    await subAgents.closeAll()
    await mcpHydration
    await tools.dispose()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
