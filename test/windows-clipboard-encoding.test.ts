import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const ttyAppModulePromise = import('../src/tty-app.ts')

describe('Windows clipboard encoding', () => {
  it('encodes clipboard text as UTF-16LE with BOM on win32', async () => {
    const ttyAppModule = await ttyAppModulePromise
    const encodeClipboardTextForPlatform =
      (ttyAppModule as {
        encodeClipboardTextForPlatform?: (platform: NodeJS.Platform, text: string) => string | Buffer
      }).encodeClipboardTextForPlatform

    assert.equal(typeof encodeClipboardTextForPlatform, 'function')

    const encoded = encodeClipboardTextForPlatform!('win32', '这是一个最小骨架版本。')

    assert.ok(Buffer.isBuffer(encoded))
    assert.equal(encoded[0], 0xff)
    assert.equal(encoded[1], 0xfe)
    assert.equal(encoded.subarray(2).toString('utf16le'), '这是一个最小骨架版本。')
  })
})
