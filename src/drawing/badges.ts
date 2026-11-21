/**
 * The `!` badges of the warnings nobody has acknowledged (#66 §14, behaviour 23).
 *
 * A badge is screen chrome, exactly like the selection's measurements in `annotations.ts`: it
 * is keyed by what the warnings engine answered rather than by the Project's revision, so it is
 * a second display list and never a layer of the Floor's own. That is also what keeps criterion
 * 7's second half true by construction — **the export never sees this function**. `compose.ts`
 * builds its sheets from `drawPlanView` and `drawWalls`, and a warning that is not in those two
 * is not on a drawing, whatever the model says.
 *
 * Placement is the whole interest of the file. Eight outward positions around the entity's
 * bounds are tried in a fixed order — the four corners, then the four edge midpoints — and the
 * first that covers no label box, no handle box and no badge already placed wins. The order is
 * fixed because the answer must not depend on the order the producers happened to walk the
 * model in: the same Floor has to get the same picture twice. When nothing fits, the badge goes
 * one badge-diameter further out along the same outward direction and a hairline leader joins
 * it back to the entity, because a warning silently dropped to avoid a collision is a warning
 * nobody will ever see.
 *
 * The disc is filled and takes the pointer. A stroke-only shape would be the one kind of target
 * Firefox does not deliver `pointerdown` on, and a badge nobody can click is a badge that does
 * not locate.
 */
import { affineApply, affineTranslate } from '../derive'
import type { Affine } from '../derive'
import { layoutText, measureRect } from './font/layoutText'
import { lineCommands, roundedRectCommands } from './path'
import { resolveSize } from './styles'
import type { DisplayItem, DisplayList, Rect, Sizing } from './types'

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** One entity carrying at least one open or reopened warning, and where it is. */
export interface BadgeSubject {
  readonly id: string
  readonly bounds: Rect
}

export interface BadgeOptions {
  readonly sizing: Sizing
  /**
   * Every box a badge must not cover: the Wall and Item labels, the selection's handles, the
   * `Floor bounds` chip. The caller collects them from the lists it has already drawn, because
   * `drawing` has no view of what the canvas chose to show.
   */
  readonly obstacles?: readonly Rect[]
}

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const covered = (box: Rect, obstacles: readonly Rect[]): boolean =>
  obstacles.some((one) => intersects(box, one))

/** The eight outward centres around `b`: four corners, then four edge midpoints. */
function candidates(b: Rect, gap: number): { x: number; y: number }[] {
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const left = b.x - gap
  const right = b.x + b.w + gap
  const top = b.y - gap
  const bottom = b.y + b.h + gap
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: cx, y: top },
    { x: cx, y: bottom },
    { x: left, y: cy },
    { x: right, y: cy },
  ]
}

/** The outward unit direction from `b`'s centre to `at`, or up when the two coincide. */
function outward(b: Rect, at: { x: number; y: number }): { x: number; y: number } {
  const dx = at.x - (b.x + b.w / 2)
  const dy = at.y - (b.y + b.h / 2)
  const length = Math.hypot(dx, dy)
  return length === 0 ? { x: 0, y: -1 } : { x: dx / length, y: dy / length }
}

/**
 * One `!` badge per subject, or `null` when there is nothing to warn about.
 *
 * `null` rather than an empty list, as `drawSelectionAnnotations` does: a renderer should have
 * nothing to draw rather than an empty `<g>` to notice.
 */
export function drawWarningBadges(
  subjects: readonly BadgeSubject[],
  options: BadgeOptions,
): DisplayList | null {
  const r = resolveSize('plan-warning-badge', options.sizing).mm
  const fontSize = resolveSize('plan-warning-badge-text', options.sizing).mm
  const obstacles = options.obstacles ?? []

  // One badge per entity, whatever the number of its warnings (criterion 7). The first bounds
  // seen wins, so a Wall named by two warnings is drawn once, where it is.
  const seen = new Set<string>()
  const placed: Rect[] = []
  const items: DisplayItem[] = []
  let bounds: Rect | null = null

  for (const subject of subjects) {
    if (seen.has(subject.id)) continue
    seen.add(subject.id)
    const gap = r
    const all = candidates(subject.bounds, gap)
    const fits = all.find(
      (at) => !covered({ x: at.x - r, y: at.y - r, w: 2 * r, h: 2 * r }, [...obstacles, ...placed]),
    )
    let at = fits ?? null
    let leader: DisplayItem | null = null
    if (at === null) {
      // Nothing fits: the first candidate, one diameter further out, joined by a hairline.
      const direction = outward(subject.bounds, all[0]!)
      at = { x: all[0]!.x + direction.x * 2 * r, y: all[0]!.y + direction.y * 2 * r }
      leader = {
        kind: 'path',
        segments: lineCommands({ x: subject.bounds.x, y: subject.bounds.y }, at),
        closed: false,
        style: 'plan-warning-badge-leader',
      }
    }
    const box = { x: at.x - r, y: at.y - r, w: 2 * r, h: 2 * r }
    placed.push(box)
    bounds = bounds === null ? box : {
      x: Math.min(bounds.x, box.x),
      y: Math.min(bounds.y, box.y),
      w: Math.max(bounds.x + bounds.w, box.x + box.w) - Math.min(bounds.x, box.x),
      h: Math.max(bounds.y + bounds.h, box.y + box.h) - Math.min(bounds.y, box.y),
    }

    const layout = layoutText('!', fontSize)
    const badge: DisplayItem = {
      kind: 'group',
      ref: { id: subject.id, role: 'warning-badge' },
      transform: affineTranslate(at.x, at.y),
      items: [
        // The filled disc is the hit shape as well as the mark; the glyph takes no pointer, so
        // the click lands on the group whatever part of the badge it meets.
        { kind: 'path', segments: roundedRectCommands(-r, -r, 2 * r, 2 * r, r), closed: true, style: 'plan-warning-badge' },
        {
          kind: 'text',
          text: '!',
          at: { x: 0, y: 0 },
          anchor: 'middle',
          baseline: 'middle',
          rotationDeg: 0,
          role: 'badge',
          style: 'plan-warning-badge-text',
          layout,
        },
      ],
    }
    items.push(leader === null ? badge : { ...badge, items: [leader, ...badge.items] })
  }

  if (items.length === 0 || bounds === null) return null
  return {
    space: 'floor',
    bounds,
    layers: [{ key: 'plan-warning-badges', items }],
    missingGlyphs: [],
  }
}

/** The badge radius under `sizing`, for a caller that measures against it. */
export const badgeRadius = (sizing: Sizing): number => resolveSize('plan-warning-badge', sizing).mm

/**
 * Every box a list draws: text by its layout, paths by their endpoints, groups by their
 * transform. It is what a caller passes as `obstacles` — the canvas knows what it has drawn and
 * nothing about what a warning is, and `drawing` knows what was drawn and nothing about the
 * canvas — and it is what a test asserts against, which is how criterion 7's "no badge covers a
 * label" is checked from the display-list geometry rather than from pixels.
 *
 * A curve is measured by its ends, so an arc's box is conservative: it may under-report the
 * bulge, never over-report the seat.
 */
export function displayRects(list: DisplayList): Rect[] {
  const out: Rect[] = []
  const walk = (items: readonly DisplayItem[], m: Affine): void => {
    for (const item of items) {
      if (item.kind === 'group') {
        walk(item.items, item.transform ?? m)
      } else if (item.kind === 'text') {
        out.push(measureRect(item.layout, affineApply(m, item.at), item.anchor))
      } else if (item.kind === 'path') {
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
