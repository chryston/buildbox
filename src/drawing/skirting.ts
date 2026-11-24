/**
 * The Plan View drawing of the Skirting of one Floor (#78 §7).
 *
 * A Skirting is a thin strip standing on one face of one Wall, and the drawing says exactly that:
 * the body is the host face offset out by its own thickness, painted over the Wall band it stands on
 * with its gaps left empty. The gaps are not decoration — an Opening in the Wall, a branch Wall
 * butting onto this face and the corners where the Wall turns each leave a hole here, and the strip
 * is drawn from the runs {@link deriveSkirting} leaves after those cuts. That is the one file that
 * knows what was cut, so the drawing and the `net_length_mm` of the Skirting table can never
 * disagree about what was bought.
 *
 * The Plan View Range (#74 §3), the Renovation Display (#70 §F) and the Drawing Layer colours (#71)
 * are not this file's business: every item carries the Skirting's `id` as its `ref`, and
 * `paintByLayer` recolours, dashes and hides by it, exactly as it does for a Wall or a Beam. A
 * Skirting above the range therefore draws as a dashed overhead outline without one line here
 * knowing about ranges.
 */
import type { DerivedSkirting, FloorSkirting } from '../derive'
import { bounds } from '../geometry'
import type { Bounds } from '../geometry'
import { layoutText } from './font/layoutText'
import { pathToCommands } from './path'
import { resolveSize } from './styles'
import type { DisplayItem, DisplayList, Rect, Sizing } from './types'

export interface SkirtingDrawOptions {
  sizing: Sizing
  /** The selected Skirting, drawn in the accent. */
  selectedSkirtingId?: string | null
}

const rectOf = (box: Bounds): Rect => ({ x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY })

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/** The longest run of a Skirting: the one place its name fits and the one place to look for it. */
const longestRun = (skirting: DerivedSkirting) =>
  skirting.runs.reduce((best, run) => (run.to - run.from > best.to - best.from ? run : best), skirting.runs[0]!)

/**
 * The Skirting of one Floor: each body, an invisible target the width of the body, and one name.
 *
 * The name sits at the middle of the longest run and stays upright whatever way the host Wall was
 * drawn, because every label on a BuildBox drawing is upright (#64 §15). A Skirting cut into several
 * runs by an Opening is still named once — the gaps are the drawing's business, not the name's.
 */
export function drawSkirting(skirting: FloorSkirting, options: SkirtingDrawOptions): DisplayList | null {
  if (skirting.skirting.length === 0) return null
  const { sizing } = options
  const selectedSkirtingId = options.selectedSkirtingId ?? null
  const shapes: DisplayItem[] = []
  const labels: DisplayItem[] = []
  let box: Rect | null = null
  const sizeMm = resolveSize('plan-label', sizing).mm

  for (const body of skirting.skirting) {
    const style = body.id === selectedSkirtingId ? 'skirting:selected' : 'skirting'
    for (const run of body.runs) {
      const boundsOf = rectOf(bounds(run.outline))
      box = box === null ? boundsOf : union(box, boundsOf)
      const segments = pathToCommands(run.outline)
      shapes.push({ kind: 'path', ref: { id: body.id, role: 'skirting' }, segments, closed: true, style })
      // The strip is 15 mm wide, which at a plan zoom is a hairline a pointer will miss; a second
      // invisible copy of the same path is the target (#65 §11).
      shapes.push({ kind: 'path', ref: { id: body.id, role: 'skirting-hit' }, segments, closed: true, style: 'skirting-hit' })
    }

    const run = longestRun(body)
    const middle = rectOf(bounds(run.outline))
    const at = { x: middle.x + middle.w / 2, y: middle.y + middle.h / 2 }
    const layout = layoutText(body.label, sizeMm)
    box = union(box!, { x: at.x - layout.width / 2, y: at.y - layout.ascent, w: layout.width, h: layout.ascent + layout.descent })
    labels.push({
      kind: 'text',
      ref: { id: body.id, role: 'skirting-label' },
      text: body.label,
      at,
      anchor: 'middle',
      baseline: 'middle',
      rotationDeg: 0,
      role: 'label',
      style: 'skirting-label',
      layout,
    })
  }

  return {
    space: 'floor',
    bounds: box!,
    layers: [
      { key: 'skirtings', items: shapes },
      { key: 'skirting-labels', items: labels },
    ],
    missingGlyphs: [],
  }
}
