import type { ToolRegistry } from './tool.js'
import type { ChatMessage, ModelAdapter, StepDiagnostics, ToolCall } from './types.js'
import type { RuntimeConfig } from './config.js'

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: string; [key: string]: unknown }

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

function isTextBlock(block: AnthropicContentBlock): block is Extract<AnthropicContentBlock, {
  type: 'text'
}> {
  return block.type === 'text' && typeof block.text === 'string'
}

function isToolUseBlock(block: AnthropicContentBlock): block is Extract<AnthropicContentBlock, {
  type: 'tool_use'
}> {
  return (
    block.type === 'tool_use' &&
    typeof block.id === 'string' &&
    typeof block.name === 'string'
  )
}

function parseAssistantText(content: string): {
  content: string
  kind?: 'final' | 'progress'
} {
  const trimmed = content.trim()
  if (!trimmed) {
    return { content: '' }
  }

  const markers: Array<{
    prefix: string
    kind: 'final' | 'progress'
  }> = [
    { prefix: '<final>', kind: 'final' },
    { prefix: '[FINAL]', kind: 'final' },
    { prefix: '<progress>', kind: 'progress' },
    { prefix: '[PROGRESS]', kind: 'progress' },
  ]

  for (const marker of markers) {
    if (trimmed.startsWith(marker.prefix)) {
      const rawContent = trimmed.slice(marker.prefix.length).trim()
      const closingTag =
        marker.kind === 'progress'
          ? /<\/progress>/gi
          : /<\/final>/gi
      return {
        content: rawContent.replace(closingTag, '').trim(),
        kind: marker.kind,
      }
    }
  }

  return { content: trimmed }
}

function toTextBlock(text: string): AnthropicContentBlock {
  return { type: 'text', text }
}

function toAssistantText(message: Extract<ChatMessage, {
  role: 'assistant' | 'assistant_progress' | 'context_summary'
}>): string {
  if (message.role === 'assistant_progress') {
    return `<progress>\n${message.content}\n</progress>`
  }

  if (message.role === 'context_summary') {
    return [
      '<context_summary>',
      message.content,
      '</context_summary>',
    ].join('\n')
  }

  return message.content
}

function pushAnthropicMessage(
  messages: AnthropicMessage[],
  role: 'user' | 'assistant',
  block: AnthropicContentBlock,
): void {
  const last = messages.at(-1)
  if (last?.role === role) {
    last.content.push(block)
    return
  }

  messages.push({ role, content: [block] })
}

function toAnthropicMessages(messages: ChatMessage[]): {
  system: string
  messages: AnthropicMessage[]
} {
  const system = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n\n')

  const converted: AnthropicMessage[] = []

  for (const message of messages) {
    if (message.role === 'system') continue

    if (message.role === 'user') {
      pushAnthropicMessage(converted, 'user', toTextBlock(message.content))
      continue
    }

    if (
      message.role === 'assistant' ||
      message.role === 'assistant_progress' ||
      message.role === 'context_summary'
    ) {
      pushAnthropicMessage(
        converted,
        'assistant',
        toTextBlock(toAssistantText(message)),
      )
      continue
    }

    if (message.role === 'assistant_tool_call') {
      pushAnthropicMessage(converted, 'assistant', {
        type: 'tool_use',
        id: message.toolUseId,
        name: message.toolName,
        input: message.input,
      })
      continue
    }

    pushAnthropicMessage(converted, 'user', {
      type: 'tool_result',
      tool_use_id: message.toolUseId,
      content: message.content,
      is_error: message.isError,
    })
  }

  return { system, messages: converted }
}

export class AnthropicModelAdapter implements ModelAdapter {
  constructor(
    private readonly tools: ToolRegistry,
    private readonly getRuntimeConfig: () => Promise<RuntimeConfig>,
  ) {}

  private async request(
    runtime: RuntimeConfig,
    payload: {
      system: string
      messages: AnthropicMessage[]
      tools?: Array<Record<string, unknown>>
      maxTokens?: number
    },
  ) {
    const url = `${runtime.baseUrl.replace(/\/$/, '')}/v1/messages`

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    }

    if (runtime.authToken) {
      headers.Authorization = `Bearer ${runtime.authToken}`
    } else if (runtime.apiKey) {
      headers['x-api-key'] = runtime.apiKey
    }

    const requestBody = {
      model: runtime.model,
      system: payload.system,
      messages: payload.messages,
      ...(payload.tools ? { tools: payload.tools } : {}),
      ...(payload.maxTokens !== undefined
        ? { max_tokens: payload.maxTokens }
        : runtime.maxOutputTokens !== undefined
          ? { max_tokens: runtime.maxOutputTokens }
          : {}),
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    })

    const data = (await response.json()) as {
      error?: { message?: string }
      stop_reason?: string
      content?: AnthropicContentBlock[]
    }

    if (!response.ok) {
      throw new Error(data.error?.message || `Model request failed: ${response.status}`)
    }

    return data
  }

  async next(messages: ChatMessage[]) {
    const runtime = await this.getRuntimeConfig()
    const payload = toAnthropicMessages(messages)
    const data = await this.request(runtime, {
      system: payload.system,
      messages: payload.messages,
      tools: this.tools.list().map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
    })

    const toolCalls: ToolCall[] = []
    const textParts: string[] = []
    const blockTypes: string[] = []
    const ignoredBlockTypes = new Set<string>()

    for (const block of data.content ?? []) {
      blockTypes.push(block.type)

      if (isTextBlock(block)) {
        textParts.push(block.text)
        continue
      }

      if (isToolUseBlock(block)) {
        toolCalls.push({
          id: block.id,
          toolName: block.name,
          input: block.input,
        })
        continue
      }

      ignoredBlockTypes.add(block.type)
    }

    const parsedText = parseAssistantText(textParts.join('\n').trim())
    const diagnostics: StepDiagnostics = {
      stopReason: data.stop_reason,
      blockTypes,
      ignoredBlockTypes: [...ignoredBlockTypes],
    }

    if (toolCalls.length > 0) {
      return {
        type: 'tool_calls' as const,
        calls: toolCalls,
        content: parsedText.content || undefined,
        contentKind:
          parsedText.kind === 'progress'
            ? ('progress' as const)
            : undefined,
        diagnostics,
      }
    }

    return {
      type: 'assistant' as const,
      content: parsedText.content,
      kind: parsedText.kind,
      diagnostics,
    }
  }

  async summarizeConversation(messages: ChatMessage[]): Promise<string> {
    const runtime = await this.getRuntimeConfig()
    const transcript = messages
      .map(message => {
        switch (message.role) {
          case 'user':
            return `[user]\n${message.content}`
          case 'assistant':
            return `[assistant]\n${message.content}`
          case 'assistant_progress':
            return `[assistant progress]\n${message.content}`
          case 'context_summary':
            return `[earlier summary]\n${message.content}`
          case 'assistant_tool_call':
            return `[tool call:${message.toolName}]\n${JSON.stringify(message.input)}`
          case 'tool_result':
            return `[tool result:${message.toolName}${message.isError ? ' error' : ''}]\n${message.content}`
          case 'system':
            return null
        }
      })
      .filter((value): value is string => Boolean(value))
      .join('\n\n')

    const data = await this.request(runtime, {
      system: [
        'You are summarizing earlier conversation context for a coding agent.',
        'Produce a compact factual summary that preserves only information needed to continue the task.',
        'Include: user goals, decisions made, relevant files or paths, important tool results, active skills or MCP usage, and any unresolved next steps.',
        'Do not restate long file contents. Do not add new instructions. Keep it concise and structured.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: transcript,
            },
          ],
        },
      ],
      maxTokens: 2048,
    })

    const text = (data.content ?? [])
      .filter(isTextBlock)
      .map(block => block.text)
      .join('\n')
      .trim()

    return text
  }
}
