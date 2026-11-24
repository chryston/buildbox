/**
 * The Plan View drawing of the Services of one Floor (#79 §6).
 *
 * A Run is a band along its centreline as wide as its section, and a Riser is a circle at one point —
 * two shapes, one drawing, because that is what a services drawing is. Neither is filled solid: a
 * drawing with six Kinds on it has to stay readable as a drawing of a room, so a Service paints as an
 * outline with a light wash, over the Walls it passes through rather than under them.
 *
 * A Riser is drawn as two true arcs, not a polygon pretending to be a pipe: the geometry vocabulary
 * has no arc and the drawing layer does, which is where that difference belongs.
 *
 * The Plan View Range (#74 §3), the Renovation Display (#70 §F) and the Drawing Layer colours (#71)
 * are not this file's business: every item carries the Service's `id` as its `ref`, and `paintByLayer`
 * recolours, dashes and hides by it, exactly as it does for a Wall, a Beam or a Skirting.
 */
import type { DerivedService, FloorServices } from '../derive'
import { bounds } from '../geometry'
import type { Bounds, Pt } from '../geometry'
import { layoutText } from './font/layoutText'
import { pathToCommands } from './path'
import { resolveSize } from './styles'
import type { DisplayItem, DisplayList, PathCommand, Rect, Sizing } from './types'

export interface ServiceDrawOptions {
  sizing: Sizing
  /** The selected Service, drawn in the accent. */
  selectedServiceId?: string | null
  /**
   * The picture the Plan View fits to its pane. A Service against the outermost Wall has its label
   * centred on a line the picture ends at, so the word would hang past the drawing and the pane would
   * cut it in half; the label is held inside this rect instead (#78 §7, the same rule for #79).
   */
  keepLabelsWithin?: Rect | null
}

const rectOf = (box: Bounds): Rect => ({ x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY })

/** `centre`, moved as little as possible so a box `half` wide about it fits inside `[lo, hi]`. */
const holdTo = (centre: number, half: number, lo: number, hi: number): number => {
  if (hi - lo <= half * 2) return (lo + hi) / 2
  return Math.min(Math.max(centre, lo + half), hi - half)
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/** A whole circle as two arcs, from the west point round to the east and back. */
const circleCommands = (centre: Pt, radius: number): PathCommand[] => [
  { k: 'M', to: { x: centre.x - radius, y: centre.y } },
  { k: 'A', to: { x: centre.x + radius, y: centre.y }, r: radius, largeArc: false, sweep: true },
  { k: 'A', to: { x: centre.x - radius, y: centre.y }, r: radius, largeArc: false, sweep: true },
]

/** The outline of one Service, whichever shape it is, as path commands. */
const commandsOf = (service: DerivedService): PathCommand[] =>
  service.shape === 'run' ? pathToCommands(service.outline!) : circleCommands(service.centre!, service.radius!)

/** Where a Service's name goes: the middle of its plan body. */
const labelAt = (service: DerivedService): Pt =>
  service.shape === 'riser'
    ? service.centre!
    : (() => {
        const box = rectOf(bounds(service.outline!))
        return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
      })()

/**
 * The Services of one Floor: each body, an invisible target at least a click wide, and one name.
 *
 * The name is the Kind code and the size — `W Ø50`, `AC 80×60` — and it stays upright whatever way the
 * Run was drawn, because every label on a BuildBox drawing is upright (#64 §15).
 */
export function drawServices(services: FloorServices, options: ServiceDrawOptions): DisplayList | null {
  if (services.services.length === 0) return null
  const { sizing, keepLabelsWithin } = options
  const selectedServiceId = options.selectedServiceId ?? null
  const shapes: DisplayItem[] = []
  const labels: DisplayItem[] = []
  let box: Rect | null = null
  const sizeMm = resolveSize('plan-label', sizing).mm

  for (const service of services.services) {
    const style = service.id === selectedServiceId ? 'service:selected' : 'service'
    const segments = commandsOf(service)
    const body = rectOf(service.shape === 'run' ? bounds(service.outline!) : bounds({ start: { x: service.centre!.x - service.radius!, y: service.centre!.y - service.radius! }, segments: [{ kind: 'line', to: { x: service.centre!.x + service.radius!, y: service.centre!.y - service.radius! } }, { kind: 'line', to: { x: service.centre!.x + service.radius!, y: service.centre!.y + service.radius! } }, { kind: 'line', to: { x: service.centre!.x - service.radius!, y: service.centre!.y + service.radius! } }] }))
    box = box === null ? body : union(box, body)
    shapes.push({ kind: 'path', ref: { id: service.id, role: 'service' }, segments, closed: true, style })
    // A Ø50 pipe is a hairline at plan zoom and a pointer will miss it; a second invisible copy of
    // the same path, stroked at the shared hit-target width, is the target (#65 §11, #78 §7).
    shapes.push({ kind: 'path', ref: { id: service.id, role: 'service-hit' }, segments, closed: true, style: 'service-hit' })

    const middle = labelAt(service)
    const layout = layoutText(service.label, sizeMm)
    const at = keepLabelsWithin === undefined || keepLabelsWithin === null
      ? middle
      : {
          x: holdTo(middle.x, layout.width / 2, keepLabelsWithin.x, keepLabelsWithin.x + keepLabelsWithin.w),
          y: holdTo(middle.y, (layout.ascent + layout.descent) / 2, keepLabelsWithin.y, keepLabelsWithin.y + keepLabelsWithin.h),
        }
    box = union(box!, { x: at.x - layout.width / 2, y: at.y - layout.ascent, w: layout.width, h: layout.ascent + layout.descent })
    labels.push({
      kind: 'text',
      ref: { id: service.id, role: 'service-label' },
      text: service.label,
      at,
      anchor: 'middle',
      baseline: 'middle',
      rotationDeg: 0,
      role: 'label',
      style: 'service-label',
      layout,
    })
  }

  return {
    space: 'floor',
    bounds: box!,
    layers: [
      { key: 'services', items: shapes },
      { key: 'service-labels', items: labels },
    ],
    missingGlyphs: [],
  }
}
