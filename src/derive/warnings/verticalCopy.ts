/**
 * The one builder that turns a vertical relation into copy (#76 §3, behaviour 22).
 *
 * Every warning that says something about heights — Placed Items against each other now, Beams,
 * Skirting and Services in #77–#79 — says it in these three sentences, and a second builder that
 * words them slightly differently is a review blocker: the same overlap would read one way beside
 * a Wall and another way beside a Beam. The builder is pure and lives in `derive`, so it emits a
 * `messageKey` and raw params, never a sentence — the rounding and the edge words belong to
 * `ui/strings`, where every measurement becomes a word the same way.
 *
 * The subject of a symmetric pair is the entity with the higher bottom, then the higher top, then
 * the lower stable ID; an asymmetric pair names its subject in the pair table and passes it in
 * already chosen. The builder never re-picks: it words what it is handed.
 */
import type { EntityId } from '../../domain'
import type { WarningMeasured, WarningParams } from './types'

/** The kinds §3 gives edge words; #77–#79 add their own to the same table. */
export type VerticalKind = 'placedItem' | 'opening' | 'skirting' | 'service' | 'wall' | 'beam'

/** A Vertical Extent (#74): the bottom and the top of one entity, in millimetres. */
export interface VerticalExtent {
  readonly bottom: number
  readonly top: number
}

/** One entity of a vertical relation: what it is, what it is called, how high it reaches. */
export interface VerticalSubject {
  readonly id: EntityId
  readonly kind: VerticalKind
  /** The full display name: `Wall cabinet #1`, `Wall W-1`, `Window WND-1`. */
  readonly label: string
  readonly extent: VerticalExtent
}

/** What the builder answers: the same triple a producer puts in its candidate. */
export interface VerticalCopy {
  readonly messageKey: string
  readonly params: WarningParams
  /** The unrounded millimetres, for `measured_mm` in the Warnings List (#76 §3). */
  readonly measured: WarningMeasured
}

/** Every key this builder can name; `ui/strings` carries a row for each. */
export const VERTICAL_MESSAGE_KEYS = [
  'vertical_above',
  'vertical_below',
  'vertical_overlap_height',
  'floor_limit_above',
  'floor_limit_below',
  'host_range_above',
  'host_range_below',
] as const

/**
 * The subject-first ordering of a symmetric pair (§3): higher bottom, then higher top, then the
 * lower stable ID, so one overlap always reads with the same subject however the model lists it.
 */
export function chooseVerticalSubject(a: VerticalSubject, b: VerticalSubject): readonly [VerticalSubject, VerticalSubject] {
  if (a.extent.bottom !== b.extent.bottom) return a.extent.bottom > b.extent.bottom ? [a, b] : [b, a]
  if (a.extent.top !== b.extent.top) return a.extent.top > b.extent.top ? [a, b] : [b, a]
  return a.id <= b.id ? [a, b] : [b, a]
}

/**
 * The height overlap of two extents: how many millimetres of one are level with the other.
 *
 * Zero for a pair that only touches, negative for a pair that misses — a producer warns only when
 * this is greater than zero, within the geometry tolerance.
 */
export function verticalOverlap(s: VerticalExtent, o: VerticalExtent): number {
  return Math.min(s.top, o.top) - Math.max(s.bottom, o.bottom)
}

/**
 * The §3 relation copy for a pair whose extents overlap (`verticalOverlap` > 0).
 *
 * - S starts and ends below O: "`<S>` top is `<S.top − O.bottom>` mm above `<O>` <O's bottom word>."
 * - S starts and ends above O: "`<S>` <S's bottom word> is `<O.top − S.bottom>` mm below `<O>` top."
 * - otherwise one contains the other's end: "`<S>` overlaps `<O>` over `<o>` mm of height."
 */
export function verticalRelationCopy(s: VerticalSubject, o: VerticalSubject): VerticalCopy {
  const params = { a: s.label, b: o.label, aKind: s.kind, bKind: o.kind }
  if (s.extent.bottom < o.extent.bottom && s.extent.top < o.extent.top) {
    const mm = s.extent.top - o.extent.bottom
    return { messageKey: 'vertical_above', params: { ...params, mm }, measured: { mm } }
  }
  if (s.extent.bottom > o.extent.bottom && s.extent.top > o.extent.top) {
    const mm = o.extent.top - s.extent.bottom
    return { messageKey: 'vertical_below', params: { ...params, mm }, measured: { mm } }
  }
  const mm = verticalOverlap(s.extent, o.extent)
  return { messageKey: 'vertical_overlap_height', params: { ...params, mm }, measured: { mm } }
}

/**
 * The §3 Floor-limit copy: a thing reaching above the upper limit or under the lower one.
 * `d` is the overshoot in millimetres, unrounded; the limit that is not set never gets here.
 */
export function floorLimitCopy(s: VerticalSubject, side: 'above' | 'below', d: number): VerticalCopy {
  return {
    messageKey: `floor_limit_${side}`,
    params: { a: s.label, aKind: s.kind, mm: d },
    measured: { mm: d },
  }
}

/**
 * The §3 host-range copy: an Opening reaching past its host Wall's top or base.
 * `d` is the overshoot in millimetres, unrounded.
 */
export function hostRangeCopy(s: VerticalSubject, wallLabel: string, side: 'above' | 'below', d: number): VerticalCopy {
  return {
    messageKey: `host_range_${side}`,
    params: { a: s.label, b: wallLabel, aKind: s.kind, mm: d },
    measured: { mm: d },
  }
}
