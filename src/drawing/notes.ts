/**
 * The Notes overlay (#80 §7).
 *
 * A pin is screen chrome, exactly like the warning badge in `badges.ts`: it is a second display list
 * keyed by the Comments the caller has already filtered, not a layer of the Floor's own, and **the
 * export never sees this module**. A note is a remark about a building, not a line on a drawing of it,
 * and #84's Comment Register is the surface that prints notes.
 *
 * Two marks, because two questions are being answered:
 *
 * - **A pin** answers *where is this note about*. It stands at the point the Anchor resolves to, and
 *   it is filled by the note's priority — High, Normal, Low — or grey once the note is Resolved,
 *   because a resolved note is still somewhere and is no longer something to act on.
 * - **A `✎n` badge** answers *how many notes is this thing under*. It belongs to an Item Design, which
 *   is shared by every placement of it, so the number rides on each placement rather than becoming
 *   one pin per copy (§12).
 *
 * Both are placed by the same rule the warning badge uses: eight outward candidates in a fixed order,
 * the first that covers no label, no handle, no warning and no mark already placed wins, and when
 * nothing fits the mark goes one diameter further out with a hairline leader back to its subject. A
 * note silently dropped to avoid a collision is a note nobody will ever see (§7.4).
 *
 * The disc is filled and takes the pointer, for the same reason the badge's disc does: a stroke-only
 * shape is the one kind of target Firefox will not deliver `pointerdown` on, and a pin nobody can
 * click cannot select its row.
 */
import { affineApply, affineTranslate } from '../derive'
import { layoutText, measureRect } from './font/layoutText'
import { lineCommands, roundedRectCommands } from './path'
import { resolveSize } from './styles'
import type { Affine } from '../derive'
import type { DisplayItem, DisplayList, Rect, Sizing, StyleKey } from './types'

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** The priority band a pin is filled with, or `resolved` for a note that is closed. */
export type NotePinTone = 'high' | 'normal' | 'low' | 'resolved'

/** One note with a place: the point its Anchor resolves to, in Floor millimetres. */
export interface NotePinSubject {
  readonly id: string
  readonly at: { x: number; y: number }
  readonly tone: NotePinTone
  /** The note's reference: the accessible name of the mark, and the text the pin wears. */
  readonly reference: string
}

/** One placement of an Item Design that has notes: the `✎n` badge's subject. */
export interface NoteBadgeSubject {
  readonly id: string
  readonly bounds: Rect
  readonly count: number
}

export interface NoteOptions {
  readonly sizing: Sizing
  /** Every box a mark must not cover: labels, handles, the chip, the warning badges (§7.4). */
  readonly obstacles?: readonly Rect[]
}

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && b.y < b.y + b.h && a.y < b.y + b.h

const covered = (box: Rect, obstacles: readonly Rect[]): boolean =>
  obstacles.some((one) => intersects(box, one))

/** The eight outward centres around `b`: four corners, then four edge midpoints. */
function candidates(b: Rect, gap: number): { x: number; y: number }[] {
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  return [
    { x: b.x - gap, y: b.y - gap },
    { x: b.x + b.w + gap, y: b.y - gap },
    { x: b.x - gap, y: b.y + b.h + gap },
    { x: b.x + b.w + gap, y: b.y + b.h + gap },
    { x: cx, y: b.y - gap },
    { x: cx, y: b.y + b.h + gap },
    { x: b.x - gap, y: cy },
    { x: b.x + b.w + gap, y: cy },
  ]
}

/** The outward unit direction from `b`'s centre to `at`, or up when the two coincide. */
function outward(b: Rect, at: { x: number; y: number }): { x: number; y: number } {
  const dx = at.x - (b.x + b.w / 2)
  const dy = at.y - (b.y + b.h / 2)
  const length = Math.hypot(dx, dy)
  return length === 0 ? { x: 0, y: -1 } : { x: dx / length, y: dy / length }
}

const union = (a: Rect | null, b: Rect): Rect =>
  a === null ? b : {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
    h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
  }

/** One filled disc with a leader when it had to move, and the pointer target either way. */
function mark(
  id: string,
  role: string,
  at: { x: number; y: number },
  r: number,
  style: StyleKey,
  text: string | null,
  fontSize: number,
  leaderFrom: Rect | null,
): DisplayItem {
  const items: DisplayItem[] = []
  if (leaderFrom !== null) {
    items.push({
      kind: 'path',
      segments: lineCommands({ x: leaderFrom.x + leaderFrom.w / 2, y: leaderFrom.y + leaderFrom.h / 2 }, at),
      closed: false,
      style: 'plan-note-leader',
    })
  }
  items.push({
    kind: 'path',
    segments: roundedRectCommands(-r, -r, 2 * r, 2 * r, r),
    closed: true,
    style,
  })
  if (text !== null) {
    items.push({
      kind: 'text',
      text,
      at: { x: 0, y: 0 },
      anchor: 'middle',
      baseline: 'middle',
      rotationDeg: 0,
      role: 'badge',
      style: 'plan-note-pin-text',
      layout: layoutText(text, fontSize),
    })
  }
  return { kind: 'group', ref: { id, role }, transform: affineTranslate(at.x, at.y), items }
}

/**
 * The overlay's marks, or `null` when there is nothing to show.
 *
 * `null` rather than an empty list, as `drawWarningBadges` does: a renderer should have nothing to
 * draw rather than an empty `<g>` to notice.
 */
export function drawNotes(
  pins: readonly NotePinSubject[],
  badges: readonly NoteBadgeSubject[],
  options: NoteOptions,
): DisplayList | null {
  const r = resolveSize('plan-note-pin', options.sizing).mm
  const fontSize = resolveSize('plan-note-pin-text', options.sizing).mm
  const obstacles = options.obstacles ?? []
  const placed: Rect[] = []
  const items: DisplayItem[] = []
  let bounds: Rect | null = null

  // Pins first: a note about a place is the mark a person is looking for, and it gets first claim on
  // the free space around it. A pin stands where it stands — it is a point, not a thing with bounds —
  // so it only moves when the seat is taken.
  for (const pin of pins) {
    const seat = { x: pin.at.x - r, y: pin.at.y - r, w: 2 * r, h: 2 * r }
    const fits = !covered(seat, [...obstacles, ...placed])
    let at = pin.at
    let leaderFrom: Rect | null = null
    if (!fits) {
      const all = candidates(seat, r)
      const free = all.find(
        (one) => !covered({ x: one.x - r, y: one.y - r, w: 2 * r, h: 2 * r }, [...obstacles, ...placed]),
      )
      if (free !== undefined) at = free
      else {
        const direction = outward(seat, all[0]!)
        at = { x: all[0]!.x + direction.x * 2 * r, y: all[0]!.y + direction.y * 2 * r }
        leaderFrom = seat
      }
    }
    const box = { x: at.x - r, y: at.y - r, w: 2 * r, h: 2 * r }
    placed.push(box)
    bounds = union(bounds, box)
    items.push(mark(pin.id, 'note-pin', at, r, `plan-note-pin-${pin.tone}` as StyleKey, pin.reference, fontSize, leaderFrom))
  }

  // Then the `✎n` badges, one per placement, avoiding the labels, the handles, the warnings and the
  // pins placed above.
  for (const badge of badges) {
    const all = candidates(badge.bounds, r)
    const fits = all.find(
      (at) => !covered({ x: at.x - r, y: at.y - r, w: 2 * r, h: 2 * r }, [...obstacles, ...placed]),
    )
    let at = fits ?? null
    let leaderFrom: Rect | null = null
    if (at === null) {
      const direction = outward(badge.bounds, all[0]!)
      at = { x: all[0]!.x + direction.x * 2 * r, y: all[0]!.y + direction.y * 2 * r }
      leaderFrom = badge.bounds
    }
    const box = { x: at.x - r, y: at.y - r, w: 2 * r, h: 2 * r }
    placed.push(box)
    bounds = union(bounds, box)
    items.push(mark(badge.id, 'note-badge', at, r, 'plan-note-badge', `✎${badge.count}`, fontSize, leaderFrom))
  }

  if (items.length === 0 || bounds === null) return null
  return {
    space: 'floor',
    bounds,
    layers: [{ key: 'plan-notes', items }],
    missingGlyphs: [],
  }
}

/** The pin radius under `sizing`, for a caller that measures against it. */
export const notePinRadius = (sizing: Sizing): number => resolveSize('plan-note-pin', sizing).mm

/** Every box the overlay draws, so a test can assert a pin covers no label (#80 criterion 22). */
export function noteRects(list: DisplayList): Rect[] {
  const out: Rect[] = []
  const walk = (items: readonly DisplayItem[], m: Affine): void => {
    for (const item of items) {
      if (item.kind === 'group') walk(item.items, item.transform ?? m)
      else if (item.kind === 'text') out.push(measureRect(item.layout, affineApply(m, item.at), item.anchor))
      else if (item.kind === 'path') {
        const pts = item.segments.map((s) => affineApply(m, s.to))
        if (pts.length === 0) continue
        const xs = pts.map((p) => p.x)
        const ys = pts.map((p) => p.y)
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        out.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y })
      }
    }
  }
  walk(list.layers.flatMap((layer) => layer.items), IDENTITY)
  return out
}
