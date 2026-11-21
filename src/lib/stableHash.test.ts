/**
 * The signature hash (#66 §2, §10).
 *
 * A warning's whole reopen rule rests on this one function: an acknowledgement stores the
 * hash of the model fields the warning was measured from, and a different hash is what turns
 * `Seen ✓` back into `Reopened after change`. So the two things that would break the feature
 * silently are the two things asserted here — that the same string always gives the same
 * value, and that the value is a fixed shape a Backup can be compared against years later.
 *
 * The pinned values are the contract. They were computed once from `cyrb53` and written down;
 * if the algorithm is ever swapped for another, every one of them moves, and that diff is the
 * review the change deserves — an acknowledgement stored by an older BuildBox would otherwise
 * come back `reopened` for every warning in every Project, with nobody able to say why.
 */
import { describe, expect, it } from 'vitest'
import { stableHash } from './index'

describe('stableHash', () => {
  it('answers the same value for the same string, every time', () => {
    const first = stableHash('wall_crossing|w-2,w-5|existing')
    for (let run = 0; run < 5; run += 1) expect(stableHash('wall_crossing|w-2,w-5|existing')).toBe(first)
  })

  it('is exactly sixteen lower-case hex characters, whatever it is given', () => {
    for (const input of ['', 'a', 'W-2 crosses W-5 without a join', '負荷', 'x'.repeat(50_000)]) {
      expect(stableHash(input)).toMatch(/^[0-9a-f]{16}$/)
    }
  })

  it('hashes the pinned strings to the pinned values', () => {
    // One row per shape a signature actually takes: nothing, a short word, a warning key, a
    // canonical-JSON object, and text outside the Basic Multilingual Plane's first page.
    expect(stableHash('')).toBe('488bdcb81aee8d83')
    expect(stableHash('W-2')).toBe('982ca8bdb012e381')
    expect(stableHash('wall_crossing|w-2,w-5|existing')).toBe('c02b59abace62e84')
    expect(stableHash('{"a":1}')).toBe('de3034b77cc1d846')
    expect(stableHash('負荷')).toBe('a6400379933a7a05')
  })

  it('separates inputs that differ by one character', () => {
    // The case the feature lives on: a Wall moved by 200 mm changes one digit of one
    // coordinate, and that has to be a different signature.
    expect(stableHash('{"x":1000}')).not.toBe(stableHash('{"x":1200}'))
    expect(stableHash('{"thickness":100}')).not.toBe(stableHash('{"thickness":101}'))
  })

  it('hashes the empty string to something, not to nothing', () => {
    // A producer whose warning depends on no field at all still has a signature, and it must
    // not be the empty string — that is the value "no acknowledgement stored" would take.
    expect(stableHash('')).not.toBe('')
    expect(stableHash('')).not.toBe(stableHash('0'))
  })

  it('spreads a large set of near-identical inputs over distinct values', () => {
    // A collision here is a warning that fails to reopen. 20 000 signatures of one coordinate
    // walking by a millimetre is the shape of a real Project's worth of Walls.
    const seen = new Set<string>()
    for (let mm = 0; mm < 20_000; mm += 1) seen.add(stableHash(`{"x":${mm}}`))
    expect(seen.size).toBe(20_000)
  })
})
