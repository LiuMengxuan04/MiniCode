import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeEnv } from '../src/config.js'

describe('mergeEnv', () => {
  test('settings env overrides process env for the same key', () => {
    const env = mergeEnv(
      { ANTHROPIC_BASE_URL: 'https://settings.example.com' },
      { ANTHROPIC_BASE_URL: 'https://process.example.com' },
    )
    assert.equal(env.ANTHROPIC_BASE_URL, 'https://settings.example.com')
  })

  test('process env values are preserved when not present in settings', () => {
    const env = mergeEnv(
      { ANTHROPIC_MODEL: 'custom-model' },
      { HOME: '/home/user', PATH: '/usr/bin' },
    )
    assert.equal(env.HOME, '/home/user')
    assert.equal(env.PATH, '/usr/bin')
    assert.equal(env.ANTHROPIC_MODEL, 'custom-model')
  })

  test('undefined settings env yields process env only', () => {
    const env = mergeEnv(undefined, { PATH: '/bin' })
    assert.equal(env.PATH, '/bin')
  })

  test('empty settings env does not drop process env', () => {
    const env = mergeEnv({}, { ANTHROPIC_API_KEY: 'sk-test' })
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-test')
  })
})
