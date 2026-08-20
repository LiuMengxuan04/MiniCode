import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderContextBadge } from '../src/tui/chrome.js'

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, '')
}

describe('renderContextBadge', () => {
  it('renders normal level badge', () => {
    const result = renderContextBadge({ utilization: 0.23, warningLevel: 'normal' })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('ctx'), 'should contain ctx label')
    assert.ok(plain.includes('23%'), 'should show 23%')
    assert.ok(plain.includes('\u2593'), 'should contain filled blocks')
    assert.ok(plain.includes('\u2591'), 'should contain empty blocks')
  })

  it('renders warning level badge', () => {
    const result = renderContextBadge({ utilization: 0.68, warningLevel: 'warning' })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('68%'))
    assert.ok(plain.includes('ctx'))
  })

  it('renders critical level badge', () => {
    const result = renderContextBadge({ utilization: 0.89, warningLevel: 'critical' })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('89%'))
  })

  it('renders blocked level badge', () => {
    const result = renderContextBadge({ utilization: 0.96, warningLevel: 'blocked' })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('96%'))
  })

  it('renders 0% utilization correctly', () => {
    const result = renderContextBadge({ utilization: 0, warningLevel: 'normal' })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('0%'))
  })

  it('renders 100% utilization correctly', () => {
    const result = renderContextBadge({ utilization: 1, warningLevel: 'blocked' })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('100%'))
  })

  it('shows provider usage plus estimate source', () => {
    const result = renderContextBadge({
      utilization: 0.82,
      warningLevel: 'warning',
      accounting: {
        providerUsageTokens: 70_000,
        estimatedTokens: 12_000,
        source: 'provider_usage_plus_estimate',
      },
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('82%'))
    assert.ok(plain.includes('usage+est'))
  })

  it('uses correct block characters for utilization', () => {
    const result = renderContextBadge({ utilization: 0.5, warningLevel: 'warning' })
    const plain = stripAnsi(result)
    // 50% → 5 filled blocks out of 10
    const filledCount = (plain.match(/\u2593/g) || []).length
    const emptyCount = (plain.match(/\u2591/g) || []).length
    assert.equal(filledCount, 5, `expected 5 filled blocks, got ${filledCount}`)
    assert.equal(emptyCount, 5, `expected 5 empty blocks, got ${emptyCount}`)
  })

  it('shows remaining headroom when effectiveInput and totalTokens are provided', () => {
    const result = renderContextBadge({
      utilization: 0.4,
      warningLevel: 'normal',
      effectiveInput: 20_000,
      totalTokens: 8_000,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('12.0k left'), `expected headroom in: ${plain}`)
  })

  it('shows raw token count for small headroom', () => {
    const result = renderContextBadge({
      utilization: 0.95,
      warningLevel: 'critical',
      effectiveInput: 20_000,
      totalTokens: 19_500,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('500 left'), `expected headroom in: ${plain}`)
  })

  it('shows zero headroom when context is exhausted', () => {
    const result = renderContextBadge({
      utilization: 1,
      warningLevel: 'blocked',
      effectiveInput: 10_000,
      totalTokens: 10_000,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('0 left'), `expected headroom in: ${plain}`)
  })

  it('does not show headroom when token counts are missing', () => {
    const result = renderContextBadge({ utilization: 0.4, warningLevel: 'normal' })
    const plain = stripAnsi(result)
    assert.ok(!plain.includes('left'))
  })

  it('clamps negative headroom to zero', () => {
    const result = renderContextBadge({
      utilization: 1.05,
      warningLevel: 'blocked',
      effectiveInput: 10_000,
      totalTokens: 12_000,
    })
    const plain = stripAnsi(result)
    assert.ok(plain.includes('0 left'), `expected clamped headroom in: ${plain}`)
  })
})
