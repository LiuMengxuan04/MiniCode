import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { McpServerSummary } from './mcp.js'
import type { SkillSummary } from './skills.js'

async function maybeRead(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

export async function buildSystemPrompt(
  cwd: string,
  permissionSummary: string[] = [],
  extras?: {
    skills?: SkillSummary[]
    mcpServers?: McpServerSummary[]
  },
): Promise<string> {
  const globalClaudeMd = await maybeRead(path.join(os.homedir(), '.claude', 'CLAUDE.md'))
  const projectClaudeMd = await maybeRead(path.join(cwd, 'CLAUDE.md'))

  const parts = [
    'You are mini-code, a terminal coding assistant.',
    'Default behavior: inspect the repository, use tools, make code changes when appropriate, and explain results clearly.',
    'Prefer reading files, searching code, editing files, and running verification commands over giving purely theoretical advice.',
    `Current cwd: ${cwd}`,
    'You can inspect or modify paths outside the current cwd when the user asks, but tool permissions may pause for approval first.',
    'When making code changes, keep them minimal, practical, and working-oriented.',
    'If the user clearly asked you to build, modify, optimize, or generate something, do the work instead of stopping at a plan.',
    'If you need user clarification, call the ask_user tool with one concise question and wait for the user reply. Do not ask clarifying questions as plain assistant text.',
    'Do not choose subjective preferences such as colors, visual style, copy tone, or naming unless the user explicitly told you to decide yourself.',
    'When using read_file, pay attention to the header fields. If it says TRUNCATED: yes, continue reading with a larger offset before concluding that the file itself is cut off.',
    'If the user names a skill or clearly asks for a workflow that matches a listed skill, call load_skill before following it.',
    'Structured response protocol:',
    '- When you are still working and will continue with more tool calls, start your text with <progress>.',
    '- Only when the task is actually complete and you are ready to hand control back, start your text with <final>.',
    '- Use ask_user when clarification is required; that tool ends the turn and waits for user input.',
    '- Do not stop after a progress update. After a <progress> message, continue the task in the next step.',
    '- Plain assistant text without <progress> is treated as a completed assistant message for this turn.',
    'Task tracking:',
    '- You have a task_tracker tool for maintaining a lightweight task list during multi-step work.',
    '- Only use task_tracker when the work involves 3 or more distinct steps. Skip it for simple single-step requests.',
    '- At the start of a multi-step task, create tasks for each major step using task_tracker with action="create".',
    '- Before starting work on a task, mark it in_progress with action="update_status".',
    '- After completing a task, mark it completed with action="complete" or action="update_status" status="completed".',
    '- Use action="list" to review the current task list at any time.',
    '- Keep tasks at a high level (3-10 items). Do not create subtasks or micro-steps.',
    '- The task list is shown to the user in the header banner and via /tasks.',
  ]

  if (permissionSummary.length > 0) {
    parts.push(`Permission context:\n${permissionSummary.join('\n')}`)
  }

  const skills = extras?.skills ?? []
  if (skills.length > 0) {
    parts.push(
      `Available skills:\n${skills
        .map(skill => `- ${skill.name}: ${skill.description}`)
        .join('\n')}`,
    )
  } else {
    parts.push('Available skills:\n- none discovered')
  }

  const mcpServers = extras?.mcpServers ?? []
  if (mcpServers.length > 0) {
    parts.push(
      `Configured MCP servers:\n${mcpServers
        .map(server => {
          const suffix = server.error ? ` (${server.error})` : ''
          const protocol = server.protocol ? `, protocol=${server.protocol}` : ''
          const resources =
            server.resourceCount !== undefined
              ? `, resources=${server.resourceCount}`
              : ''
          const prompts =
            server.promptCount !== undefined
              ? `, prompts=${server.promptCount}`
              : ''
          return `- ${server.name}: ${server.status}, tools=${server.toolCount}${resources}${prompts}${protocol}${suffix}`
        })
        .join('\n')}`,
    )
    const connectedServers = mcpServers.filter(server => server.status === 'connected')
    if (connectedServers.length > 0) {
      const hasPublishedResources = connectedServers.some(
        server => (server.resourceCount ?? 0) > 0,
      )
      const hasPublishedPrompts = connectedServers.some(
        server => (server.promptCount ?? 0) > 0,
      )
      const capabilityHints = [
        'Connected MCP tools are already exposed in the tool list with names prefixed like mcp__server__tool. To discover callable MCP integrations, inspect the tool list or use /mcp.',
      ]
      if (hasPublishedResources) {
        capabilityHints.push(
          'Some connected MCP servers also publish resources, so list_mcp_resources/read_mcp_resource can be useful for reading server-provided content.',
        )
      }
      if (hasPublishedPrompts) {
        capabilityHints.push(
          'Some connected MCP servers also publish prompts, so list_mcp_prompts/get_mcp_prompt can be useful for fetching server-provided prompt templates.',
        )
      }
      parts.push(capabilityHints.join(' '))
    }
  }

  if (globalClaudeMd) {
    parts.push(`Global instructions from ~/.claude/CLAUDE.md:\n${globalClaudeMd}`)
  }

  if (projectClaudeMd) {
    parts.push(`Project instructions from ${path.join(cwd, 'CLAUDE.md')}:\n${projectClaudeMd}`)
  }

  return parts.join('\n\n')
}
