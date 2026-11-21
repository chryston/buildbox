/**
 * The one banned-word list (#63 criterion 3).
 *
 * #19 §12 keeps compliance and engineering language out of everything BuildBox writes, and
 * #63 asks for the same list to be read by the copy snapshot, the preset pack and the CI
 * scan. One list means one place to widen, but it also means one place to get wrong for
 * everyone, so the matcher is tested here rather than trusted by three callers.
 */
import { describe, expect, it } from 'vitest'
import { BANNED_WORDS, bannedWordsIn, mentionsWord } from './index'

describe('the banned-word list', () => {
  it('holds the twenty-eight entries #19 §12 and #27 §12 give, each once', () => {
    expect(BANNED_WORDS).toHaveLength(28)
    expect(new Set(BANNED_WORDS).size).toBe(BANNED_WORDS.length)
    expect(BANNED_WORDS).toContain('load-bearing')
    expect(BANNED_WORDS).toContain('code')
    // The two families: the compliance claim, and the topic the interface must not open.
    expect(BANNED_WORDS).toContain('gas-safety')
    expect(BANNED_WORDS).toContain('not connected')
  })

  it('holds only text the matcher can drop into a pattern as it stands', () => {
    // `mentionsWord` builds a `RegExp` from the entry, so a stray metacharacter would turn a
    // word into a rule nobody intended.
    for (const word of BANNED_WORDS) expect(word).toMatch(/^[\w -]+$/)
  })
})

describe('the matcher', () => {
  it('reads whole words, in any case', () => {
    expect(bannedWordsIn('Load-Bearing wall')).toEqual(['load-bearing'])
    expect(bannedWordsIn('CODE')).toEqual(['code'])
    expect(bannedWordsIn('Built to code')).toEqual(['code', 'to code'])
  })

  it('does not fail a word that merely contains one', () => {
    expect(bannedWordsIn('Enclosed yard, decoded plan, securely rated')).toEqual(['rated'])
  })

  it('reads a phrase as a phrase', () => {
    expect(bannedWordsIn('This wall cannot span that opening')).toEqual(['cannot span'])
    expect(bannedWordsIn('Nothing here spans anything')).toEqual([])
    expect(bannedWordsIn('Sized for the load')).toEqual(['sized for'])
    expect(bannedWordsIn('Not sized')).toEqual([])
  })

  it('names every word it finds, in list order', () => {
    expect(bannedWordsIn('Engineered, certified and safe')).toEqual(['safe', 'certified', 'engineered'])
  })

  it('answers for any word, not only the banned ones', () => {
    // The pack's own wording test checks families of its own with the same matcher.
    expect(mentionsWord('Measure yours.', 'measure')).toBe(true)
    expect(mentionsWord('Measurement says otherwise', 'measure')).toBe(false)
  })
})
