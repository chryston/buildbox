/**
 * The Plan View drawing of the Beams of one Floor (#77 §4).
 *
 * A Beam is documentation of what is already there, and the drawing says so: the body is an
 * outline with barely a fill, painted in its own band *under* the Walls, so a Wall standing on a
 * Beam reads as one thing and not two. The body comes from `deriveBeams`, which builds it from
 * `geometry.linearElement` — the same primitive a Wall body comes from — so the two can never
 * disagree about what a justification means.
 *
 * The Plan View Range (#74 §3) and the Renovation Display (#70 §F) are not this file's business:
 * every item carries the Beam's `ref`, and `floorView` recolours, dashes and lays overlays by it,
 * exactly as it does for a Wall. A Beam above the range therefore draws as a dashed overhead
 * outline without a single line here knowing about ranges — and it stays pickable, because the
 * range hides nothing.
 */
import type { FloorBeams } from '../derive'
import { bounds } from '../geometry'
import type { Bounds } from '../geometry'
import { layoutText } from './font/layoutText'
import { pathToCommands } from './path'
import { resolveSize } from './styles'
import type { DisplayItem, DisplayList, Rect, Sizing } from './types'

export interface BeamDrawOptions {
  sizing: Sizing
  /** The selected Beam, drawn in the accent. */
  selectedBeamId?: string | null
}

/** The same box spelled for a display list: a corner and a size, not two corners. */
const rectOf = (box: Bounds): Rect => ({ x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY })

/** The union of two boxes, or whichever there is. */
const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/**
 * The Beams of one Floor: the body, an invisible target the width of the body, and the name.
 *
 * The label sits at the middle of the reference line — the one place on a Beam that is neither end
 * nor face — and stays upright whatever way the Beam was drawn, because every label on a BuildBox
 * drawing is upright (#64 §15).
 */
export function drawBeams(beams: FloorBeams, options: BeamDrawOptions): DisplayList | null {
  if (beams.beams.length === 0) return null
  const { sizing } = options
  const selectedBeamId = options.selectedBeamId ?? null
  const shapes: DisplayItem[] = []
  const labels: DisplayItem[] = []
  let box: Rect | null = null
  const sizeMm = resolveSize('plan-label', sizing).mm

  for (const beam of beams.beams) {
    const boundsOf = rectOf(bounds(beam.outline))
    box = box === null ? boundsOf : union(box, boundsOf)
    const segments = pathToCommands(beam.outline)
    const style = beam.id === selectedBeamId ? 'beam:selected' : 'beam'
    shapes.push({ kind: 'path', ref: { id: beam.id, role: 'beam' }, segments, closed: true, style })
    // The outline is a couple of device pixels; a click aimed at the middle of a Beam should not
    // have to find it, and a stroke-only path is one Firefox will not hit-test at all (#65 §11).
    shapes.push({ kind: 'path', ref: { id: beam.id, role: 'beam-hit' }, segments, closed: true, style: 'beam-hit' })

    const layout = layoutText(beam.label, sizeMm)
    const middle = {
      x: (beam.outline.start.x + beam.outline.segments[2]!.to.x) / 2,
      y: (beam.outline.start.y + beam.outline.segments[2]!.to.y) / 2,
    }
    box = union(box!, { x: middle.x - layout.width / 2, y: middle.y - layout.ascent, w: layout.width, h: layout.ascent + layout.descent })
    labels.push({
      kind: 'text',
      ref: { id: beam.id, role: 'beam-label' },
      text: beam.label,
      at: middle,
      anchor: 'middle',
      baseline: 'middle',
      rotationDeg: 0,
      role: 'label',
      style: 'beam-label',
      layout,
    })
  }

  return {
    space: 'floor',
    bounds: box!,
    layers: [
      { key: 'beams', items: shapes },
      { key: 'beam-labels', items: labels },
    ],
    missingGlyphs: [],
  }
}
