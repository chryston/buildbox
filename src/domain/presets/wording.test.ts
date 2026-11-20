/**
 * What the pack is allowed to say (#63 criterion 6).
 *
 * A preset is a starting point, not a rule: the pack must never read as a regulation, a
 * rating or a check, and it must not use the drawing room's jargon. #19 §12 bans the words
 * that would do that, and #63 adds the two families this pack is most likely to reach for —
 * the drawing's own names for shapes, and anything that sounds like a requirement.
 *
 * The scan is over every string in the pack object: names, IDs, hints, source clauses and
 * field names alike, because a homeowner reads whatever the panel shows them and the panel
 * is not going to reword it.
 */
import { describe, expect, it } from 'vitest'
import { getPresetPack } from '../index'
import { BANNED_WORDS, bannedWordsIn, mentionsWord } from '../../lib'

const pack = getPresetPack('hdb-bto-typical')

/** Every string the pack carries, with where it sits, so a failure names its row. */
function stringsOf(value: unknown, path = 'pack'): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((child, index) => stringsOf(child, `${path}[${index}]`))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => stringsOf(child, `${path}.${key}`))
  }
  return []
}

const everyString = stringsOf(pack)

/** Which of `words` any pack string says, each named by where it sits. */
function offendersFor(strings: [string, string][], words: readonly string[]): string[] {
  return strings
    .flatMap(([path, text]) =>
      words.filter((word) => mentionsWord(text, word)).map((word) => `${path} says "${word}"`),
    )
    .sort()
}

describe('the pack’s wording', () => {
  it('carries strings at every level, so the scan below is not empty', () => {
    expect(everyString.length).toBeGreaterThan(60)
    expect(everyString.filter(([, text]) => text.includes('door'))).not.toHaveLength(0)
  })

  it('says no word #19 §12 bans', () => {
    const offenders = everyString
      .flatMap(([path, text]) => bannedWordsIn(text).map((word) => `${path} says "${word}"`))
      .sort()
    expect(offenders).toEqual([])
  })

  it('never says code, even inside another word', () => {
    // `code` is the one banned word that hides in ordinary English — `enclosed`, `decoded` —
    // so here it is a substring, not a word. A homeowner should never wonder whether a
    // sentence about their flat is quoting a standard.
    const offenders = everyString
      .filter(([, text]) => text.toLowerCase().includes('code'))
      .map(([path, text]) => `${path} says "${text}"`)
    expect(offenders).toEqual([])
  })

  it('uses no word that reads as a regulation or a check', () => {
    // The two families #63 names beyond #19 §12: an obligation BuildBox cannot impose, and
    // a verdict it has no authority to give.
    const REGULATORY = [
      'regulation',
      'requirement',
      'requires',
      'shall',
      'minimum',
      'maximum',
      'verified',
      'validated',
      'not allowed',
    ]
    const offenders = offendersFor(everyString, REGULATORY)
    expect(offenders).toEqual([])
  })

  it('uses no drawing-room jargon', () => {
    const JARGON = ['ell', 'bbox', 'face L', 'RC', 'HS', 'SOR']
    expect(offendersFor(everyString, JARGON)).toEqual([])
  })

  it('says the same plain line wherever a value is soft', () => {
    const entryHints = pack.entries.flatMap((entry) => (entry.hint === undefined ? [] : [entry.hint]))
    const hints = new Set([pack.hint, ...entryHints])
    expect([...hints].sort()).toEqual(['Starting point — check your HDB floor plan.', 'Typical size — measure yours.'])
  })

  it('keeps the shared list it is checked against', () => {
    // The list lives in `lib` because the UI copy check reads the same one (#19 §12): a word
    // added for the panels has to reach the panels' own check too.
    expect(BANNED_WORDS).toContain('load-bearing')
    expect(BANNED_WORDS).toContain('code')
  })
})
