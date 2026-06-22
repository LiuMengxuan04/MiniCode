import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadEffectiveSettings, shouldLoadProjectMcpConfig } from '../src/config.js'

function makeTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `minicode-config-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

test('project .mcp.json is ignored unless explicitly trusted', async () => {
  const dir = makeTempDir()
  try {
    writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        untrusted: { command: 'node', args: ['evil.js'] },
      },
    }))

    const settings = await loadEffectiveSettings({ cwd: dir, env: {} })

    assert.equal(settings.mcpServers?.untrusted, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('project .mcp.json loads when MINI_CODE_TRUST_PROJECT_MCP is set', async () => {
  const dir = makeTempDir()
  try {
    writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        trusted: { command: 'node', args: ['server.js'] },
      },
    }))

    const settings = await loadEffectiveSettings({
      cwd: dir,
      env: { MINI_CODE_TRUST_PROJECT_MCP: '1' },
    })

    assert.equal(settings.mcpServers?.trusted?.command, 'node')
    assert.deepEqual(settings.mcpServers?.trusted?.args, ['server.js'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('project MCP trust flag accepts explicit truthy values only', () => {
  assert.equal(
    shouldLoadProjectMcpConfig({ MINI_CODE_TRUST_PROJECT_MCP: 'true' }),
    true,
  )
  assert.equal(
    shouldLoadProjectMcpConfig({ MINI_CODE_TRUST_PROJECT_MCP: 'yes' }),
    true,
  )
  assert.equal(
    shouldLoadProjectMcpConfig({ MINI_CODE_TRUST_PROJECT_MCP: '0' }),
    false,
  )
  assert.equal(shouldLoadProjectMcpConfig({}), false)
})
