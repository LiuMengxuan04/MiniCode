import type { ChatMessage } from '../types.js'

export function withRuntimeContext(messages: ChatMessage[], context: string): ChatMessage[] {
  const index = messages.findIndex(message => message.role === 'system')
  if (index < 0) return [{ role: 'system', content: context }, ...messages]
  return messages.map((message, i) => i === index && message.role === 'system'
    ? { ...message, content: `${message.content}\n\n${context}` }
    : message)
}
