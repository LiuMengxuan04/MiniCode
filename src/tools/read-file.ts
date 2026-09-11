import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import { resolveToolPath } from '../workspace.js'

type Input = {
  path: string
  offset?: number
  limit?: number
  fresh?: boolean
}

type ReadSignature = {
  offset: number
  limit: number
  totalChars: number
  contentHash: string
}

const DEFAULT_READ_LIMIT = 8000
const MAX_READ_LIMIT = 20000
export const READ_CACHE_LIMIT = 256

/**
 * Dedup cache: maps a resolved absolute path to the signature of the most
 * recent read. When the same file region is read again with unchanged
 * content, the tool returns a lightweight marker instead of the full text,
 * so repeated reads do not keep consuming context space.
 */
const readCache = new Map<string, ReadSignature>()

/** Clear the in-memory read dedup cache (used by tests). */
export function resetReadCache(): void {
  readCache.clear()
}

function dedupEnabled(): boolean {
  return process.env.MINI_CODE_READ_DEDUP !== '0'
}

function cacheRead(target: string, signature: ReadSignature): void {
  if (!readCache.has(target) && readCache.size >= READ_CACHE_LIMIT) {
    const oldest = readCache.keys().next()
    if (!oldest.done) readCache.delete(oldest.value)
  }
  readCache.set(target, signature)
}

function contentHash(chunk: string): string {
  return createHash('sha1').update(chunk).digest('hex')
}

function dedupMarker(filePath: string): string {
  return [
    `FILE: ${filePath}`,
    'STATUS: already read (content unchanged)',
    'CONTENT: [Previously read. Use fresh: true if earlier content is no longer in context.]',
  ].join('\n')
}

export const readFileTool: ToolDefinition<Input> = {
  name: 'read_file',
  description:
    'Read a UTF-8 text file relative to the workspace root. Large files can be read in chunks via offset and limit.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      offset: { type: 'number' },
      limit: { type: 'number' },
      fresh: {
        type: 'boolean',
        description:
          'Return the full content even when this unchanged region was read before.',
      },
    },
    required: ['path'],
  },
  schema: z.object({
    path: z.string(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(MAX_READ_LIMIT).optional(),
    fresh: z.boolean().optional(),
  }),
  async run(input, context) {
    const target = await resolveToolPath(context, input.path, 'read')
    const content = await readFile(target, 'utf8')
    const offset = Math.max(0, input.offset ?? 0)
    const limit = Math.min(MAX_READ_LIMIT, input.limit ?? DEFAULT_READ_LIMIT)
    const end = Math.min(content.length, offset + limit)
    const chunk = content.slice(offset, end)
    const truncated = end < content.length

    if (dedupEnabled()) {
      const hash = contentHash(chunk)
      const prev = readCache.get(target)
      if (
        !input.fresh &&
        prev &&
        prev.offset === offset &&
        prev.limit === limit &&
        prev.totalChars === content.length &&
        prev.contentHash === hash
      ) {
        return {
          ok: true,
          output: dedupMarker(input.path),
        }
      }
      cacheRead(target, {
        offset,
        limit,
        totalChars: content.length,
        contentHash: hash,
      })
    }

    const header = [
      `FILE: ${input.path}`,
      `OFFSET: ${offset}`,
      `END: ${end}`,
      `TOTAL_CHARS: ${content.length}`,
      truncated
        ? `TRUNCATED: yes - call read_file again with offset ${end}`
        : 'TRUNCATED: no',
      '',
    ].join('\n')

    return {
      ok: true,
      output: header + chunk,
    }
  },
}
