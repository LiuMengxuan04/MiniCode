import {
  CLAUDE_SETTINGS_PATH,
  MINI_CODE_MCP_PATH,
  MINI_CODE_PERMISSIONS_PATH,
  MINI_CODE_SETTINGS_PATH,
  loadRuntimeConfig,
  saveMiniCodeSettings,
} from './config.js'
import type { ToolRegistry } from './tool.js'

export type SlashCommand = {
  name: string
  usage: string
  description: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/help',
    usage: '/help',
    description: 'Show available slash commands.',
  },
  {
    name: '/tools',
    usage: '/tools',
    description: 'List tools available to the coding agent and tool shortcuts.',
  },
  {
    name: '/status',
    usage: '/status',
    description: 'Show current model and config source.',
  },
  {
    name: '/model',
    usage: '/model',
    description: 'Show the current model.',
  },
  {
    name: '/model',
    usage: '/model <model-name>',
    description: 'Persist a model override into ~/.mini-code/settings.json.',
  },
  {
    name: '/config-paths',
    usage: '/config-paths',
    description: 'Show mini-code and Claude fallback settings paths.',
  },
  {
    name: '/skills',
    usage: '/skills',
    description: 'List discovered SKILL.md workflows.',
  },
  {
    name: '/mcp',
    usage: '/mcp',
    description: 'Show configured MCP servers and connection state.',
  },
  {
    name: '/resume',
    usage: '/resume',
    description: 'Resume a saved session (interactive picker, or /resume <id>).',
  },
  {
    name: '/rename',
    usage: '/rename <name>',
    description: 'Rename the current session.',
  },
  {
    name: '/new',
    usage: '/new',
    description: 'Clear saved session and start fresh.',
  },
  {
    name: '/fork',
    usage: '/fork',
    description: 'Fork current session into a new independent session.',
  },
  {
    name: '/permissions',
    usage: '/permissions',
    description: 'Show mini-code permission storage path.',
  },
  {
    name: '/exit',
    usage: '/exit',
    description: 'Exit mini-code.',
  },
  {
    name: '/ls',
    usage: '/ls [path]',
    description: 'List files in a directory.',
  },
  {
    name: '/grep',
    usage: '/grep <pattern>::[path]',
    description: 'Search text in files.',
  },
  {
    name: '/read',
    usage: '/read <path>',
    description: 'Read a file directly.',
  },
  {
    name: '/write',
    usage: '/write <path>::<content>',
    description: 'Write a file directly.',
  },
  {
    name: '/modify',
    usage: '/modify <path>::<content>',
    description: 'Replace a file, showing a reviewable diff before applying it.',
  },
  {
    name: '/edit',
    usage: '/edit <path>::<search>::<replace>',
    description: 'Edit a file by exact replacement.',
  },
  {
    name: '/patch',
    usage: '/patch <path>::<search1>::<replace1>::<search2>::<replace2>...',
    description: 'Apply multiple replacements to one file in one command.',
  },
  {
    name: '/cmd',
    usage: '/cmd [cwd::]<command> [args...]',
    description: 'Run an allowed development command directly, optionally in another directory.',
  },
  {
    name: '/compact',
    usage: '/compact',
    description: 'Compress conversation context to free up context window space.',
  },
]

export function formatSlashCommands(): string {
  return SLASH_COMMANDS.map(command => `${command.usage}  ${command.description}`).join('\n')
}

export function findMatchingSlashCommands(input: string): string[] {
  return SLASH_COMMANDS
    .map(command => command.usage)
    .filter(command => command.startsWith(input))
}

export async function tryHandleLocalCommand(
  input: string,
  context?: {
    tools?: ToolRegistry
  },
): Promise<string | null> {
  if (input === '/') {
    return formatSlashCommands()
  }

  if (input === '/help') {
    return formatSlashCommands()
  }

  if (input === '/config-paths') {
    return [
      `mini-code settings: ${MINI_CODE_SETTINGS_PATH}`,
      `mini-code permissions: ${MINI_CODE_PERMISSIONS_PATH}`,
      `mini-code mcp: ${MINI_CODE_MCP_PATH}`,
      `compat fallback: ${CLAUDE_SETTINGS_PATH}`,
    ].join('\n')
  }

  if (input === '/permissions') {
    return `permission store: ${MINI_CODE_PERMISSIONS_PATH}`
  }

  if (input === '/skills') {
    const skills = context?.tools?.getSkills() ?? []
    if (skills.length === 0) {
      return 'No skills discovered. Add skills under ~/.mini-code/skills/<name>/SKILL.md, .mini-code/skills/<name>/SKILL.md, .claude/skills/<name>/SKILL.md, or ~/.claude/skills/<name>/SKILL.md.'
    }

    return skills
      .map(
        skill =>
          `${skill.name}  ${skill.description}  [${skill.source}]`,
      )
      .join('\n')
  }

  if (input === '/mcp') {
    const servers = context?.tools?.getMcpServers() ?? []
    if (servers.length === 0) {
      return 'No MCP servers configured. Add mcpServers to ~/.mini-code/settings.json, ~/.mini-code/mcp.json, or project .mcp.json.'
    }

    return servers
      .map(server => {
        const suffix = server.error ? `  error=${server.error}` : ''
        const protocol = server.protocol ? `  protocol=${server.protocol}` : ''
        const resources =
          server.resourceCount !== undefined
            ? `  resources=${server.resourceCount}`
            : ''
        const prompts =
          server.promptCount !== undefined
            ? `  prompts=${server.promptCount}`
            : ''
        return `${server.name}  status=${server.status}  tools=${server.toolCount}${resources}${prompts}${protocol}${suffix}`
      })
      .join('\n')
  }

  if (input === '/status') {
    const runtime = await loadRuntimeConfig()
    return [
      `model: ${runtime.model}`,
      `baseUrl: ${runtime.baseUrl}`,
      `auth: ${runtime.authToken ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY'}`,
      `mcp servers: ${Object.keys(runtime.mcpServers).length}`,
      runtime.sourceSummary,
    ].join('\n')
  }

  if (input === '/model') {
    const runtime = await loadRuntimeConfig()
    return `current model: ${runtime.model}`
  }

  if (input.startsWith('/model ')) {
    const model = input.slice('/model '.length).trim()
    if (!model) {
      return '用法: /model <model-name>'
    }

    await saveMiniCodeSettings({ model })
    return `saved model=${model} to ${MINI_CODE_SETTINGS_PATH}`
  }

  return null
}

export function completeSlashCommand(line: string): [string[], string] {
  const hits = SLASH_COMMANDS
    .map(command => command.usage)
    .filter(command => command.startsWith(line))

  return [hits.length > 0 ? hits : SLASH_COMMANDS.map(command => command.usage), line]
}
