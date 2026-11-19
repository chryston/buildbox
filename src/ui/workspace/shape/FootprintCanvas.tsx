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
import type { ReactNode } from 'react'
import { pathToSvg } from '../../../derive'
import { footprintPath } from '../../../domain'
import type { ItemFootprint, Point2 } from '../../../domain'

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
}

/** The frame around the shape, in millimetres, so a handle or a marker is not on the edge. */
const PAD_MM = 40

export function FootprintCanvas(props: FootprintCanvasProps): ReactNode {
  const { footprint, ghost, marker, origin, invalid } = props
  const box = frameOf([footprint, ...(ghost === null ? [] : [ghost])], origin)
  return (
    <svg
      className="bb-shape-canvas"
      data-testid="footprint-canvas"
      data-invalid={invalid ? 'true' : 'false'}
      viewBox={`${box.minX} ${box.minY} ${box.maxX - box.minX} ${box.maxY - box.minY}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Item Footprint"
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
    </svg>
  )
}

/**
 * The viewBox: everything that has to be on screen, plus padding.
 *
 * The Item Origin is in the union even when the shape is nowhere near it, because the axes run
 * through it and an axis that leaves the frame reads as a mistake rather than as a shape that
 * has been moved off its origin.
 */
function frameOf(footprints: readonly ItemFootprint[], origin: Point2): { minX: number; minY: number; maxX: number; maxY: number } {
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
