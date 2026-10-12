import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderContextBadge } from '../src/tui/chrome.js'

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, '')
}

describe('renderContextBadge', () => {
  it('renders normal level badge', () => {
    const result = renderContextBadge({
      utilization: 0.23,
      warningLevel: 'normal',
      remainingTokens: 142_000,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('ctx'), 'should contain ctx label')
    assert.ok(plain.includes('23%'), 'should show 23%')
    assert.ok(plain.includes('\u2593'), 'should contain filled blocks')
    assert.ok(plain.includes('\u2591'), 'should contain empty blocks')
  })

  it('renders warning level badge', () => {
    const result = renderContextBadge({
      utilization: 0.68,
      warningLevel: 'warning',
      remainingTokens: 59_000,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('68%'))
    assert.ok(plain.includes('ctx'))
  })

  it('renders critical level badge', () => {
    const result = renderContextBadge({
      utilization: 0.89,
      warningLevel: 'critical',
      remainingTokens: 20_000,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('89%'))
  })

  it('renders blocked level badge', () => {
    const result = renderContextBadge({
      utilization: 0.96,
      warningLevel: 'blocked',
      remainingTokens: 0,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('96%'))
  })

  it('renders 0% utilization correctly', () => {
    const result = renderContextBadge({
      utilization: 0,
      warningLevel: 'normal',
      remainingTokens: 184_000,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('0%'))
  })

  it('renders 100% utilization correctly', () => {
    const result = renderContextBadge({
      utilization: 1,
      warningLevel: 'blocked',
      remainingTokens: 0,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('100%'))
  })

  it('shows provider usage plus estimate source', () => {
    const result = renderContextBadge({
      utilization: 0.82,
      warningLevel: 'warning',
      remainingTokens: 18_000,
      accounting: {
        providerUsageTokens: 70_000,
        estimatedTokens: 12_000,
        source: 'provider_usage_plus_estimate',
      },
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('82%'))
    assert.ok(plain.includes('18K left'))
    assert.ok(plain.includes('usage+est'))
  })

  it('shows compact remaining context headroom', () => {
    const result = renderContextBadge({
      utilization: 0.68,
      warningLevel: 'warning',
      remainingTokens: 59_200,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('59K left'))
  })

  it('shows small remaining context headroom without a suffix', () => {
    const result = renderContextBadge({
      utilization: 0.94,
      warningLevel: 'critical',
      remainingTokens: 999,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('999 left'))
  })

  it('shows million-scale remaining context headroom compactly', () => {
    const result = renderContextBadge({
      utilization: 0.12,
      warningLevel: 'normal',
      remainingTokens: 1_234_000,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('1.2M left'))
  })

  it('promotes rounded 1000K headroom to million-scale display', () => {
    const result = renderContextBadge({
      utilization: 0.12,
      warningLevel: 'normal',
      remainingTokens: 999_500,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('1M left'))
  })

  it('shows zero remaining headroom when context is blocked', () => {
    const result = renderContextBadge({
      utilization: 1,
      warningLevel: 'blocked',
      remainingTokens: 0,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('0 left'))
  })

  it('uses correct block characters for utilization', () => {
    const result = renderContextBadge({
      utilization: 0.5,
      warningLevel: 'warning',
      remainingTokens: 92_000,
    })
    const plain = stripAnsi(result)
    // 50% → 5 filled blocks out of 10
    const filledCount = (plain.match(/\u2593/g) || []).length
    const emptyCount = (plain.match(/\u2591/g) || []).length
    assert.equal(filledCount, 5, `expected 5 filled blocks, got ${filledCount}`)
    assert.equal(emptyCount, 5, `expected 5 empty blocks, got ${emptyCount}`)
  })
})
