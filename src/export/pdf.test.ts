import { describe, expect, it } from 'vitest'
import { splitByGlyph } from './pdf'

describe('splitByGlyph', () => {
  it('leaves text the bundled face covers as one run', () => {
    expect(splitByGlyph('Base Cabinet 600', 3)).toEqual([
      { text: 'Base Cabinet 600', widthMm: expect.any(Number), missing: false },
    ])
  })

  it('cuts a character the face has no glyph for into a run of its own (#61 criterion 11)', () => {
    // The house is what the issue names. The face covers Latin-1, so it has nothing for it, and the
    // writer draws a box where the run falls rather than letting the character vanish.
    expect(splitByGlyph('Island 🏠', 3)).toEqual([
      { text: 'Island ', widthMm: expect.any(Number), missing: false },
      { text: '🏠', widthMm: 0, missing: true },
    ])
  })

  it('keeps the runs in the order the label read', () => {
    expect(splitByGlyph('🏠 Bench 🔧', 3).map((run) => run.missing)).toEqual([true, false, true])
    expect(splitByGlyph('🏠 Bench 🔧', 3).map((run) => run.text).join('')).toBe('🏠 Bench 🔧')
  })
})
