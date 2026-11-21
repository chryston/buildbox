/**
 * The Door / window tool's aim (#65 §10).
 *
 * Everything the tool decides before a click lives here, as a function of the pointer rather
 * than as state in a component: which Wall the pointer is over, where the Opening would sit,
 * whether it fits, and the one sentence that says why it does not. The fit answer comes from
 * the same `fitOpening` the handlers call, and the ghost symbol from the same `wallOpenings`
 * the Plan View draws with, so the preview cannot promise a position the Intent will refuse —
 * which is the whole reason this file is a function of the pointer and not a copy of the rules.
 */
import type { OpeningSymbol, OpeningStyle } from '../../../drawing'
import { wallOpenings } from '../../../drawing'
import type { Opening, Wall, WallJunction } from '../../../domain'
import type { UsableGap, UsableInterval } from '../../../derive'
import { fitOpening, openingEnd, refDistance, refParamAt } from '../../../derive'
import { placementFitMessage } from '../../strings'
import { resolveOpeningPreset } from './openingPresets'
import type { OpeningPresetRow } from './openingPresets'

/** The id the ghost carries, so the drawing can name what it drew without inventing a store id. */
export const OPENING_PREVIEW_ID = 'opening-preview'

/** What the tool remembers between pointer moves: the row picked and the number typed. */
export interface OpeningDraft {
  readonly presetId: string
  /** Which end a typed distance is measured from (#65 §10). */
  readonly from: 'start' | 'end'
  /** The distance typed from that end, in millimetres; `null` until a number is typed. */
  readonly typed: number | null
}

/** The draft the tool starts with: the bedroom door, measured from the Wall's own start. */
export const emptyOpeningDraft = (presetId: string): OpeningDraft => ({ presetId, from: 'start', typed: null })

/** Picking another row starts the position again: a 1,800 mm sliding door is not a 900 door. */
export const withPreset = (draft: OpeningDraft, presetId: string): OpeningDraft => ({
  ...draft,
  presetId,
  typed: null,
})

/** `Distance from ▸ the other end`: the same number, read backwards. */
export const withEnd = (draft: OpeningDraft, from: 'start' | 'end'): OpeningDraft => ({
  ...draft,
  from,
  typed: null,
})

/** A typed distance along the face, in millimetres. */
export const withTypedDistance = (draft: OpeningDraft, typed: number | null): OpeningDraft => ({
  ...draft,
  typed,
})

/** What the pointer is aiming at, or `null` when it is aiming at nothing. */
export interface OpeningAim {
  hostWallId: string
  /** `W-3`, the Wall the message names. */
  hostRef: string
  /** Millimetres along the host's reference line to the near jamb. */
  start: number
  /** The far jamb: `start + width` on a straight Wall, more along an arc. */
  end: number
  width: number
  fits: boolean
  /** The stretch that would be violated, marked between its ends when it does not fit. */
  violated: UsableGap | null
  /** The one sentence that says why it does not fit, or `null` when it does. */
  message: string | null
  /** The room left to each usable end, already in display units: `820 mm`, `1,380 mm`. */
  chip: { fromStart: string; fromEnd: string }
  /** The ghost the Plan View draws. */
  symbol: OpeningSymbol
}

export interface OpeningAimInput {
  readonly walls: readonly Wall[]
  readonly junctions: readonly WallJunction[]
  /** Every Wall's usable interval, from `usableIntervals` — computed once per edit, not per move. */
  readonly usable: ReadonlyMap<string, UsableInterval>
  readonly preset: OpeningPresetRow
  /** The host Wall's own height: what a removed section's top resolves to. */
  readonly hostHeightOf: (wallId: string) => number
  /** How far from a face the pointer still counts as being over that Wall, in millimetres. */
  readonly reach: number
  readonly refOf: (wallId: string) => string
  /** A readout in the Project's display unit and precision: `1,380 mm`. */
  readonly format: (mm: number) => string
}

/** The gap of `usable` that holds `at`, or `null` when the pointer is standing on a block. */
const gapHolding = (usable: UsableInterval, at: number): UsableGap | null =>
  usable.gaps.find((gap) => at >= gap.from && at <= gap.to) ?? null

/** The widest gap a Wall offers, for a Wall too short to hold anything at all. */
const widestGap = (usable: UsableInterval): UsableGap | null =>
  usable.gaps.reduce<UsableGap | null>(
    (best, gap) => (best === null || gap.to - gap.from > best.to - best.from ? gap : best),
    null,
  )

/** The Wall the pointer is over: the nearest reference line within half a thickness plus `reach`. */
function hostAt(walls: readonly Wall[], cursor: { x: number; y: number }, reach: number): Wall | null {
  let best: Wall | null = null
  let bestDistance = Infinity
  for (const wall of walls) {
    const grab = refDistance(wall.line, cursor) - wall.thickness / 2
    if (grab < bestDistance) {
      bestDistance = grab
      best = wall
    }
  }
  return best !== null && bestDistance <= reach ? best : null
}

/**
 * Where the Opening would go, whether it fits, and what to say about it.
 *
 * `null` means the pointer is over empty canvas: no host, no ghost, no message, and a click
 * that does nothing (#65 §10).
 */
export function openingAim(cursor: { x: number; y: number } | null, draft: OpeningDraft, input: OpeningAimInput): OpeningAim | null {
  if (cursor === null) return null
  const host = hostAt(input.walls, cursor, input.reach)
  if (host === null) return null
  const usable = input.usable.get(host.id)
  if (usable === undefined) return null

  const preset = resolveOpeningPreset(input.preset, input.hostHeightOf(host.id))
  const projection = refParamAt(host.line, cursor)
  const aimed = gapHolding(usable, projection) ?? widestGap(usable)
  // A typed number is a distance from one end of the gap the pointer is standing in, which is
  // the only gap whose ends the chip is showing. Without one, the pointer's own projection wins.
  const start = draft.typed === null || aimed === null
    ? projection - preset.width / 2
    : draft.from === 'start'
      ? aimed.from + draft.typed
      : aimed.to - draft.typed - preset.width

  const fit = fitOpening(host.line, usable, start, preset.width)
  const end = openingEnd(host.line, start, preset.width)
  const mark = aimed ?? fit.gap ?? widestGap(usable)
  const ghost: Opening = {
    id: OPENING_PREVIEW_ID,
    floorId: host.floorId,
    hostWallId: host.id,
    kind: preset.kind,
    label: input.preset.name,
    start,
    width: preset.width,
    sill: preset.sill,
    head: preset.head,
    ...(preset.swing === undefined ? {} : { swing: preset.swing, hingeSide: 'start' as const }),
  }
  const [entry] = wallOpenings([host], input.junctions, [ghost])
  const symbol = entry?.symbols[0]
  if (symbol === undefined) return null

  return {
    hostWallId: host.id,
    hostRef: input.refOf(host.id),
    start,
    end,
    width: preset.width,
    fits: fit.fits,
    violated: fit.fits ? null : mark,
    message: fit.fits
      ? null
      : placementFitMessage(input.preset.name, preset.kind, preset.width, input.refOf(host.id), fit, input.refOf),
    chip: {
      fromStart: input.format(mark === null ? 0 : start - mark.from),
      fromEnd: input.format(mark === null ? 0 : mark.to - end),
    },
    symbol,
  }
}

/** The style the ghost is drawn in: the accent while it fits, the danger colour while it does not. */
export const openingAimStyle = (fits: boolean): OpeningStyle =>
  fits ? 'opening:preview' : 'opening:preview-blocked'
