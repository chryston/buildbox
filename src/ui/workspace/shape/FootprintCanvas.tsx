/**
 * The Item Footprint canvas (#58 §3): the shape on its own local axes, not on a Floor.
 *
 * Item Detail shows one Item Design, so the canvas has no Floor behind it and no other
 * placement in it — the axes are the Item Design's own, drawn faintly through the Item Origin,
 * because `Position X` and `Position Y` in the Shape tab are those axes' coordinates and a
 * number with no visible axis to read against is a number you have to trust.
 *
 * Three things can be on it at once, and the whole point of the layering is that you can tell
 * them apart without reading anything: the shape that is committed, the shape being proposed
 * (solid, and red when it will not commit), and the last valid shape behind a failed proposal
 * (dashed). The marker is where the kernel said the failure is, which is the one piece of
 * information a sentence alone cannot carry.
 */
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { pathToSvg } from '../../../derive'
import type { PresetKind, Pt } from '../../../derive'
import { footprintPath } from '../../../domain'
import type { ItemFootprint, Point2 } from '../../../domain'
import { chipsFor, clientToLocal, dragBox, isClick } from './placement'
import type { DragBox, PlacementGesture } from './placement'

export interface FootprintCanvasProps {
  /** The shape to draw solid: the proposal while one is up, the committed shape otherwise. */
  readonly footprint: ItemFootprint
  /** The last valid shape, dashed, shown only while a proposal has failed. */
  readonly ghost: ItemFootprint | null
  /** Where the kernel says the failure is, or `null`. */
  readonly marker: Point2 | null
  /** The Item Origin, in Item Design local millimetres. */
  readonly origin: Point2
  readonly invalid: boolean
  /**
   * The preset waiting to be placed, or `null`. While it is set the canvas is a target: the
   * next drag or click is a shape, not a selection.
   */
  readonly placing?: PresetKind | null
  /** The box being dragged right now, with its `W` and `D` readouts. */
  readonly drag?: DragBox | null
  /** The labels the readouts carry, already in the Project's display unit. */
  readonly chipLabels?: { readonly width: string; readonly depth: string }
  /**
   * The shape the frame is fitted to while placing. Following the drag would rescale the canvas
   * under the pointer, so a 600 mm drag would appear not to grow at all; the frame stays on the
   * shape that was there when the drag started, and the chips are what tells the truth about a
   * box that has been dragged past the edge.
   */
  readonly frameShape?: ItemFootprint | null
  /** Every pointer move while placing, including the first press. `null` once it is over. */
  readonly onDrag?: (box: DragBox | null) => void
  /** The finished gesture: the box it dragged, or the point it clicked. */
  readonly onGesture?: (gesture: PlacementGesture) => void
}

/** The frame around the shape, in millimetres, so a handle or a marker is not on the edge. */
const PAD_MM = 40

/** The chip text height, in screen pixels: chips are chrome, so they do not scale with the shape. */
const CHIP_TEXT_PX = 11

/**
 * Millimetres per screen pixel for this frame in this host.
 *
 * `preserveAspectRatio="meet"` fits the frame by the tighter axis, so the scale is the larger of
 * the two ratios. With no host measured yet — the first render, or jsdom, which reports no
 * layout at all — 1 is returned, which draws the chips at their pixel sizes in millimetres.
 */
function mmPerPixel(svg: SVGSVGElement | null, frame: Frame): number {
  if (svg === null) return 1
  const host = svg.getBoundingClientRect()
  if (host.width <= 0 || host.height <= 0) return 1
  return Math.max((frame.maxX - frame.minX) / host.width, (frame.maxY - frame.minY) / host.height)
}

export function FootprintCanvas(props: FootprintCanvasProps): ReactNode {
  const {
    footprint, ghost, marker, origin, invalid,
    placing = null, drag = null, frameShape = null,
    chipLabels = { width: '', depth: '' },
    onDrag, onGesture,
  } = props
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [anchor, setAnchor] = useState<Pt | null>(null)

  const box = frameOf(
    placing !== null ? [frameShape ?? footprint] : [footprint, ...(ghost === null ? [] : [ghost])],
    origin,
  )

  /** Screen pixels to Item Design local millimetres. */
  const toLocal = (event: ReactPointerEvent<SVGSVGElement>): Pt | null => {
    const host = svgRef.current?.getBoundingClientRect()
    return host === undefined ? null : clientToLocal(host, box, event.clientX, event.clientY)
  }

  const start = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (placing === null || event.button !== 0) return
    const point = toLocal(event)
    if (point === null) return
    // Pointer capture is what keeps a drag alive when the pointer leaves the canvas. Hosts
    // without it — jsdom among them — still drag, they just lose it at the edge.
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setAnchor(point)
    onDrag?.(dragBox(point, point))
  }

  const move = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (anchor === null) return
    const point = toLocal(event)
    if (point === null) return
    onDrag?.(dragBox(anchor, point))
  }

  const end = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (anchor === null) return
    const point = toLocal(event) ?? anchor
    const dragged = dragBox(anchor, point)
    setAnchor(null)
    onDrag?.(null)
    // A pointer that came back where it started was a click: it says "here" and nothing about
    // size, so it places the default rather than a 0 × 0 shape.
    onGesture?.(isClick(dragged) ? { point } : { box: dragged })
  }

  // Millimetres per screen pixel, so the chips are chrome at a fixed size rather than a shape
  // that happens to be drawn in text. `meet` fits the frame into the host by the tighter axis.
  const mmPerPx = mmPerPixel(svgRef.current, box)
  const chips = placing !== null && drag !== null ? chipsFor(drag, chipLabels, mmPerPx) : null

  return (
    <svg
      ref={svgRef}
      className="bb-shape-canvas"
      data-testid="footprint-canvas"
      data-invalid={invalid ? 'true' : 'false'}
      data-placing={placing ?? 'none'}
      viewBox={`${box.minX} ${box.minY} ${box.maxX - box.minX} ${box.maxY - box.minY}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Item Footprint"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <line
        className="bb-shape-axis"
        data-testid="footprint-axis-x"
        x1={box.minX}
        y1={origin.y}
        x2={box.maxX}
        y2={origin.y}
      />
      <line
        className="bb-shape-axis"
        data-testid="footprint-axis-y"
        x1={origin.x}
        y1={box.minY}
        x2={origin.x}
        y2={box.maxY}
      />
      {ghost !== null && (
        <path className="bb-shape-ghost" data-testid="footprint-ghost" d={pathToSvg(footprintPath(ghost))} />
      )}
      <path
        className="bb-shape-outline"
        data-testid="footprint-outline"
        d={pathToSvg(footprintPath(footprint))}
      />
      <g className="bb-shape-origin" data-testid="footprint-origin" transform={`translate(${origin.x} ${origin.y})`}>
        <circle r={PAD_MM / 4} />
        <line x1={-PAD_MM / 2} y1={0} x2={PAD_MM / 2} y2={0} />
        <line x1={0} y1={-PAD_MM / 2} x2={0} y2={PAD_MM / 2} />
      </g>
      {marker !== null && (
        <circle
          className="bb-shape-marker"
          data-testid="footprint-marker"
          cx={marker.x}
          cy={marker.y}
          r={PAD_MM / 3}
        />
      )}
      {drag !== null && (
        <rect
          className="bb-shape-drag"
          data-testid="footprint-drag"
          x={drag.minX}
          y={drag.minY}
          width={drag.maxX - drag.minX}
          height={drag.maxY - drag.minY}
        />
      )}
      {chips !== null && (
        <g className="bb-shape-chips" font-size={CHIP_TEXT_PX * mmPerPx}>
          <ChipBox testId="footprint-chip-width" chip={chips.width} />
          <ChipBox testId="footprint-chip-depth" chip={chips.depth} />
        </g>
      )}
    </svg>
  )
}

/** One readout: a rounded box and the number in it, both in the canvas's own units. */
function ChipBox(props: {
  readonly testId: string
  readonly chip: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly label: string }
}): ReactNode {
  const { x, y, width, height, label } = props.chip
  return (
    <g className="bb-shape-chip" data-testid={props.testId}>
      <rect x={x} y={y} width={width} height={height} rx={height / 3} />
      <text x={x + width / 2} y={y + height / 2} dominantBaseline="central" textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

/** The viewBox, in local millimetres. */
interface Frame {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/**
 * The viewBox: everything that has to be on screen, plus padding.
 *
 * The Item Origin is in the union even when the shape is nowhere near it, because the axes run
 * through it and an axis that leaves the frame reads as a mistake rather than as a shape that
 * has been moved off its origin.
 */
function frameOf(footprints: readonly ItemFootprint[], origin: Point2): Frame {
  const points: Point2[] = [origin]
  for (const footprint of footprints) {
    const path = footprintPath(footprint)
    points.push(path.start, ...path.segments.map((segment) => segment.to))
  }
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    minX: Math.min(...xs) - PAD_MM,
    minY: Math.min(...ys) - PAD_MM,
    maxX: Math.max(...xs) + PAD_MM,
    maxY: Math.max(...ys) + PAD_MM,
  }
}
