/**
 * Every sentence the interface speaks, in one file, checked as a whole (#51 criterion 5).
 *
 * The snapshot is the point rather than a convenience. #51's acceptance is that no component holds
 * a literal, and the only way to notice a sentence that has quietly moved into one is to look at
 * the entire vocabulary at once — a per-string assertion would have to be written for each new
 * line, and nobody writes those for the line they were trying to get on screen.
 *
 * It also freezes the two records that map a state to a sentence. `recoveryReason` and
 * `saveFailureReason` are indexed by unions owned by `session` and `persistence`, so a new kind
 * there is a type error here; a new *word* here is a snapshot diff, which is the review the copy
 * deserves.
 */
import { describe, expect, it } from 'vitest'
import { STRINGS, WARNING_COPY } from './index'
import { WARNING_PRODUCERS } from '../../derive'

/**
 * The words #19 §12 keeps out of user-facing copy, carried forward by #24, #27 and ADR-0008.
 *
 * `code` and `must` are ordinary English in a developer's sentence and promises in a user's:
 * "Browser storage is full" is a fact, "the browser must be updated" is an instruction about a
 * thing the interface has no authority to demand. `sized for` and `rated` are the structural
 * claims the beam and skirting labels were banned for in ADR-0008, and they are just as false
 * here — BuildBox has not certified anything.
 */
const BANNED = ['compliant', 'safe', 'rated', 'approved', 'code', 'sized for', 'must', 'required']

/** Every string the table can produce, including the ones behind its copy functions. */
function everyString(value: unknown, key = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[key, value]]
  if (typeof value === 'function') {
    // Each function is called with the widest arguments it will accept: the shapes it can return
    // are a string, or the three pieces of a sentence split around a bold time.
    const produced: Array<[string, string]> = []
    for (const args of [
      ['', '', ''],
      [0, 0, 0],
      [1, 1, 1],
      [2, 3, 4],
    ]) {
      let out: unknown
      try {
        out = (value as (...a: unknown[]) => unknown)(...args)
      } catch {
        continue
      }
      produced.push(...everyString(out, key))
    }
    return produced
  }
  if (Array.isArray(value)) return value.flatMap((entry, index) => everyString(entry, `${key}[${index}]`))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([child, entry]) => everyString(entry, key === '' ? child : `${key}.${child}`))
  }
  return []
}

describe('the copy', () => {
  it('is the whole vocabulary of the interface', () => {
    expect(STRINGS).toMatchSnapshot()
  })

  it('keeps the banned words out of every sentence (#52 criterion 21)', () => {
    const offenders = everyString(STRINGS)
      .flatMap(([key, text]) =>
        BANNED.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(text)).map((word) => `${key}: "${word}" in ${text}`),
      )
      .sort()
    expect(offenders).toEqual([])
  })

  it('has copy for every warning the producers can raise', () => {
    // The strip holds no `if (type === …)`; the copy table is the only extension point (#66
    // §12). So the pair — the producers that are registered and the rows that are written —
    // has to be checked against each other here, where both are visible. A producer's
    // `messageKey` is its `type` by construction, so the registered types are exactly the keys
    // the strip will be asked to say. A producer added by #67 or #76–#79 without a row fails
    // this test rather than meeting the user with a sentence that says it has no wording.
    for (const producer of WARNING_PRODUCERS) {
      expect(WARNING_COPY[producer.type], `${producer.type} has no copy`).toBeTypeOf('function')
    }
    expect(WARNING_PRODUCERS.length).toBeGreaterThan(0)
  })

  it('says each warning sentence the way its issue writes it', () => {
    // The producers measure and the table words, so the exact sentences belong here — `derive`
    // may not import `ui` (#20 §2) and cannot assert what it only hands over as numbers.
    expect(WARNING_COPY.wall_crossing?.({ a: 'W-2', b: 'W-5', mm: 100 })).toBe(
      'W-2 crosses W-5 without a join: 100 mm overlap.',
    )
    expect(WARNING_COPY.wall_overlap?.({ a: 'W-2', b: 'W-5', mm: 450 })).toBe(
      'W-2 runs along W-5 for 450 mm without a join.',
    )
    expect(WARNING_COPY.item_crosses_room?.({ a: 'Base 600 #2', b: 'Bedroom', m2: 0.05, pct: 20.833_333 })).toBe(
      'Base 600 #2 crosses Bedroom: 0.05 m² (21%) of its footprint is outside.',
    )
  })
})
