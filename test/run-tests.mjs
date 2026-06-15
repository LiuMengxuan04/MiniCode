import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const testDir = path.join(root, 'test')
const entries = await readdir(testDir)
const testFiles = entries
  .filter(name => name.endsWith('.test.ts'))
  .sort()
  .map(name => path.join(testDir, name))

if (testFiles.length === 0) {
  console.error('No test files found in test/*.test.ts')
  process.exit(1)
}

let activeChild = null

const forwardedSignals = ['SIGINT', 'SIGTERM']
const forwardSignal = signal => {
  if (activeChild && !activeChild.killed) {
    activeChild.kill(signal)
  }
}

for (const signal of forwardedSignals) {
  process.on(signal, forwardSignal)
}

async function runTestFile(filePath) {
  const miniCodeHome = await mkdtemp(path.join(os.tmpdir(), 'minicode-test-home-'))

  try {
    const exit = await new Promise(resolve => {
      activeChild = spawn(
        process.execPath,
        ['--import', 'tsx', '--test', filePath],
        {
          stdio: 'inherit',
          env: {
            ...process.env,
            MINI_CODE_HOME: miniCodeHome,
          },
        },
      )

      activeChild.once('close', (code, signal) => {
        resolve({ code, signal })
      })
    })

    if (exit.signal) {
      process.kill(process.pid, exit.signal)
      return false
    }

    return (exit.code ?? 1) === 0
  } finally {
    activeChild = null
    await rm(miniCodeHome, { recursive: true, force: true })
  }
}

let allPassed = true
for (const filePath of testFiles) {
  const ok = await runTestFile(filePath)
  if (!ok) {
    allPassed = false
  }
}

for (const signal of forwardedSignals) {
  process.off(signal, forwardSignal)
}

process.exit(allPassed ? 0 : 1)
