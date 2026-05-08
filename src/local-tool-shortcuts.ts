export type LocalToolShortcut =
  | { toolName: 'list_files'; input: { path?: string } }
  | { toolName: 'grep_files'; input: { pattern: string; path?: string } }
  | { toolName: 'read_file'; input: { path: string } }
  | { toolName: 'write_file'; input: { path: string; content: string } }
  | { toolName: 'modify_file'; input: { path: string; content: string } }
  | { toolName: 'edit_file'; input: { path: string; search: string; replace: string } }
  | {
      toolName: 'patch_file'
      input: {
        path: string
        replacements: Array<{ search: string; replace: string; replaceAll?: boolean }>
      }
    }
  | { toolName: 'run_command'; input: { command: string; args?: string[]; cwd?: string } }

export function parseLocalToolShortcut(input: string): LocalToolShortcut | null {
  if (input === '/ls' || input.startsWith('/ls ')) {
    const dir = input.slice('/ls'.length).trim()
    return {
      toolName: 'list_files',
      input: dir ? { path: dir } : {},
    }
  }

  if (input.startsWith('/grep ')) {
    const payload = input.slice('/grep '.length).trim()
    const [pattern, searchPath] = payload.split('::')
    if (!pattern?.trim()) return null
    return {
      toolName: 'grep_files',
      input: {
        pattern: pattern.trim(),
        path: searchPath?.trim() || undefined,
      },
    }
  }

  if (input.startsWith('/read ')) {
    const filePath = input.slice('/read '.length).trim()
    if (!filePath) return null
    return {
      toolName: 'read_file',
      input: { path: filePath },
    }
  }

  if (input.startsWith('/write ')) {
    const payload = input.slice('/write '.length)
    const splitAt = payload.indexOf('::')
    if (splitAt === -1) return null
    const targetPath = payload.slice(0, splitAt).trim()
    if (!targetPath) return null
    return {
      toolName: 'write_file',
      input: {
        path: targetPath,
        content: payload.slice(splitAt + 2),
      },
    }
  }

  if (input.startsWith('/modify ')) {
    const payload = input.slice('/modify '.length)
    const splitAt = payload.indexOf('::')
    if (splitAt === -1) return null
    const targetPath = payload.slice(0, splitAt).trim()
    if (!targetPath) return null
    return {
      toolName: 'modify_file',
      input: {
        path: targetPath,
        content: payload.slice(splitAt + 2),
      },
    }
  }

  if (input.startsWith('/edit ')) {
    const payload = input.slice('/edit '.length)
    const [targetPath, search, replace] = payload.split('::')
    const trimmedPath = targetPath?.trim()
    if (!trimmedPath || search === undefined || replace === undefined) {
      return null
    }
    return {
      toolName: 'edit_file',
      input: {
        path: trimmedPath,
        search,
        replace,
      },
    }
  }

  if (input.startsWith('/cmd ')) {
    const payload = input.slice('/cmd '.length).trim()
    const splitAt = payload.indexOf('::')
    const commandText = splitAt === -1 ? payload : payload.slice(splitAt + 2).trim()
    const commandCwd = splitAt === -1 ? undefined : payload.slice(0, splitAt).trim()
    const parts = commandText.split(/\s+/)
    const [command, ...args] = parts
    if (!command) return null
    return {
      toolName: 'run_command',
      input: { command, args, cwd: commandCwd || undefined },
    }
  }

  if (input.startsWith('/patch ')) {
    const payload = input.slice('/patch '.length)
    const [targetPath, ...ops] = payload.split('::')
    if (!targetPath?.trim() || ops.length < 2 || ops.length % 2 !== 0) {
      return null
    }

    const replacements = []
    for (let i = 0; i < ops.length; i += 2) {
      replacements.push({
        search: ops[i] ?? '',
        replace: ops[i + 1] ?? '',
      })
    }

    return {
      toolName: 'patch_file',
      input: {
        path: targetPath.trim(),
        replacements,
      },
    }
  }

  return null
}
