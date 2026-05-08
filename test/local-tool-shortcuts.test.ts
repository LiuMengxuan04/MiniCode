import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseLocalToolShortcut } from '../src/local-tool-shortcuts.js'

describe('parseLocalToolShortcut', () => {
  it('parses /ls with an optional path', () => {
    assert.deepEqual(parseLocalToolShortcut('/ls'), {
      toolName: 'list_files',
      input: {},
    })
    assert.deepEqual(parseLocalToolShortcut('/ls src'), {
      toolName: 'list_files',
      input: { path: 'src' },
    })
  })

  it('does not treat adjacent command text as an /ls path', () => {
    assert.equal(parseLocalToolShortcut('/lsfoo'), null)
  })

  it('rejects file edit shortcuts with blank paths', () => {
    assert.equal(parseLocalToolShortcut('/write ::content'), null)
    assert.equal(parseLocalToolShortcut('/modify ::content'), null)
    assert.equal(parseLocalToolShortcut('/edit   ::before::after'), null)
  })
})
