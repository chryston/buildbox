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
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PresetKind, Pt } from '../../../derive'
import { commandsToPath, pathToCommands } from '../../../drawing'
import { footprintPath } from '../../../domain'
import type { ItemFootprint, Point2 } from '../../../domain'
import { chipsFor, clientToLocal, dragBox, isClick, localToHost } from './placement'
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
  /**
   * The open Custom Path draft (#59 §1): its Edges, chips, placed vertices, the rubber band,
   * the `Close` marker and the snap in force. While it is set the canvas is a drafting target —
   * a press places a vertex instead of starting a placement drag.
   */
  readonly draft?: DraftView | null
  /** One handle per vertex of a committed Custom Path, in vertex order (#59 §2). */
  readonly handles?: readonly Pt[] | null
  /** The selected vertex, 1-based, drawn filled so the corner a radius rounds is visible. */
  readonly selectedVertex?: number | null
  /** The typed-length field over the Edge it describes, or `null`. */
  readonly lengthField?: LengthFieldView | null
  /** A draw tool is armed and no draft is open yet, so the next press is the first vertex (#59 §1). */
  readonly drawing?: boolean
  /** A draft press, in Item Design local millimetres. */
  readonly onDraftPoint?: (at: Pt) => void
  /** Every pointer move while drafting, so the rubber band and the chips follow the cursor. */
  readonly onDraftMove?: (at: Pt) => void
  /**
   * A vertex handle moved, or `null` when the pointer let go. The editor proposes on every move
   * and commits only on the release, which is what makes a drag one undo step.
   */
  readonly onHandleDrag?: (index: number, at: Pt | null) => void
  /**
   * The current millimetres per screen pixel, reported whenever it changes.
   *
   * Snap acquisition is 12 CSS px (#59 §5), and the grid and angle candidates are placed in
   * millimetres, so the code that decides whether a snap is in force has to know the scale. Only
   * the canvas can know it, because only the canvas has been laid out.
   */
  readonly onScale?: (mmPerPx: number) => void
}

/** One Edge of the draft: its own path data, the words beside it, and where they sit. */
export interface DraftEdgeView {
  readonly d: string
  readonly label: string
  /** The Edge's midpoint, where its chip sits. */
  readonly at: Pt
}

/** The draft as the canvas sees it: geometry and strings, both built by the editor. */
export interface DraftView {
  /** The placed Edges, drawn solid, each with its chip. */
  readonly edges: readonly DraftEdgeView[]
  /** The rubber band from the last placed vertex to the cursor, dashed, with its own chip. */
  readonly band: DraftEdgeView | null
  readonly vertices: readonly Pt[]
  /** The marker at the start, and whether pressing it would close right now. */
  readonly close: { readonly at: Pt; readonly live: boolean } | null
  /** The snap in force: the point it took, and the plain words naming it. */
  readonly snap: { readonly at: Pt; readonly label: string } | null
  /** Every point the frame has to fit, so a draft outside the committed shape is not clipped. */
  readonly extent: readonly Pt[]
}

/** The typed-length field, positioned over the Edge it describes. */
export interface LengthFieldView {
  readonly at: Pt
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onCommit: () => void
  readonly onCancel: () => void
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
    draft = null, handles = null, selectedVertex = null, lengthField = null, drawing = false,
    onDraftPoint, onDraftMove, onHandleDrag, onScale,
  } = props
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [anchor, setAnchor] = useState<Pt | null>(null)
  /** The vertex handle under the pointer, or `null` when nothing is being dragged. */
  const [vertex, setVertex] = useState<number | null>(null)
  /** The last scale reported upward, so the report only fires when the scale actually moves. */
  const [reported, setReported] = useState<number | null>(null)

  const box = frameOf(
    placing !== null ? [frameShape ?? footprint] : [footprint, ...(ghost === null ? [] : [ghost])],
    origin,
    draft?.extent ?? [],
  )

  /** Screen pixels to Item Design local millimetres. */
  const toLocal = (event: ReactPointerEvent<SVGSVGElement>): Pt | null => {
    const host = svgRef.current?.getBoundingClientRect()
    return host === undefined ? null : clientToLocal(host, box, event.clientX, event.clientY)
  }

  const start = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return
    const point = toLocal(event)
    if (point === null) return
    // A press while drafting places a vertex; it is never the start of a placement drag. With a
    // draw tool armed and nothing drafted yet the same is true of the very first press — it is the
    // shape's first vertex, and there is no box to drag out of it.
    if (draft !== null || drawing) {
      onDraftPoint?.(point)
      return
    }
    if (placing === null) return
    // Pointer capture is what keeps a drag alive when the pointer leaves the canvas. Hosts
    // without it — jsdom among them — still drag, they just lose it at the edge.
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setAnchor(point)
    onDrag?.(dragBox(point, point))
  }

  const move = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const point = toLocal(event)
    if (point === null) return
    if (vertex !== null) {
      onHandleDrag?.(vertex, point)
      return
    }
    if (anchor !== null) {
      onDrag?.(dragBox(anchor, point))
      return
    }
    if (draft !== null) onDraftMove?.(point)
  }

  const end = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (vertex !== null) {
      // Letting go is the one transaction: the editor commits what the last move proposed.
      setVertex(null)
      onHandleDrag?.(vertex, null)
      return
    }
    if (anchor === null) return
    const point = toLocal(event) ?? anchor
    const dragged = dragBox(anchor, point)
    setAnchor(null)
    onDrag?.(null)
    // A pointer that came back where it started was a click: it says "here" and nothing about
    // size, so it places the default rather than a 0 × 0 shape.
    onGesture?.(isClick(dragged) ? { point } : { box: dragged })
  }

  /**
   * A vertex handle went down. The press does not move anything yet — a click that selects a
   * corner for `Corner radius` and a drag that moves it are the same gesture until it moves.
   */
  const grabHandle = (index: number, event: ReactPointerEvent<SVGCircleElement>): void => {
    event.stopPropagation()
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setVertex(index)
  }

  // Millimetres per screen pixel, so the chips are chrome at a fixed size rather than a shape
  // that happens to be drawn in text. `meet` fits the frame into the host by the tighter axis.
  const mmPerPx = mmPerPixel(svgRef.current, box)
  const chips = placing !== null && drag !== null ? chipsFor(drag, chipLabels, mmPerPx) : null
  useEffect(() => {
    if (reported === mmPerPx) return
    setReported(mmPerPx)
    onScale?.(mmPerPx)
  })
  const host = svgRef.current?.getBoundingClientRect() ?? null
  const field = lengthField === null || host === null
    ? null
    : localToHost(host, box, lengthField.at)

  return (
    <div className="bb-shape-canvas-frame">
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
        <path className="bb-shape-ghost" data-testid="footprint-ghost" d={commandsToPath(pathToCommands(footprintPath(ghost)))} />
      )}
      <path
        className="bb-shape-outline"
        data-testid="footprint-outline"
        d={commandsToPath(pathToCommands(footprintPath(footprint)))}
      />
      <g className="bb-shape-origin" data-testid="footprint-origin" transform={`translate(${origin.x} ${origin.y})`}>
        <circle r={PAD_MM / 4} />
        <line x1={-PAD_MM / 2} y1={0} x2={PAD_MM / 2} y2={0} />
        <line x1={0} y1={-PAD_MM / 2} x2={0} y2={PAD_MM / 2} />
      </g>
      {draft !== null && (
        <g data-testid="shape-draft">
          {draft.edges.map((edge, index) => (
            <path
              key={`shape-draft-edge-${index + 1}`}
              data-testid={`shape-draft-edge-${index + 1}`}
              className="bb-shape-draft-edge"
              d={edge.d}
            />
          ))}
          {draft.band !== null && (
            <path data-testid="shape-draft-band" className="bb-shape-draft-band" d={draft.band.d} />
          )}
          {draft.vertices.map((point, index) => (
            <circle
              key={`shape-draft-vertex-${index + 1}`}
              data-testid={`shape-draft-vertex-${index + 1}`}
              className="bb-shape-draft-vertex"
              cx={point.x}
              cy={point.y}
              r={PAD_MM / 6}
            />
          ))}
          {draft.close !== null && (
            <g
              data-testid="shape-draft-close"
              className="bb-shape-draft-close"
              data-live={draft.close.live ? 'true' : 'false'}
              onPointerDown={(event) => {
                // Inert while the draft is invalid: pressing it would commit a crossing.
                if (!draft.close?.live) return
                event.stopPropagation()
                onDraftPoint?.(draft.close.at)
              }}
            >
              <circle cx={draft.close.at.x} cy={draft.close.at.y} r={PAD_MM / 3} />
              <text
                x={draft.close.at.x}
                y={draft.close.at.y + PAD_MM * 0.8}
                dominantBaseline="central"
                textAnchor="middle"
              >
                Close
              </text>
            </g>
          )}
          {draft.snap !== null && (
            <g data-testid="shape-snap" className="bb-shape-snap">
              <circle cx={draft.snap.at.x} cy={draft.snap.at.y} r={PAD_MM / 4} />
              {/* The words sit beside the point, never over it: the indicator's whole job is to
                  show which point was taken. */}
              <text
                data-testid="shape-snap-label"
                x={draft.snap.at.x + PAD_MM * 0.5}
                y={draft.snap.at.y - PAD_MM * 0.5}
                dominantBaseline="central"
              >
                {draft.snap.label}
              </text>
            </g>
          )}
          <g className="bb-shape-chips" font-size={CHIP_TEXT_PX * mmPerPx}>
            {[...draft.edges, ...(draft.band === null ? [] : [draft.band])].map((edge, index) => (
              <ChipBox
                key={`shape-draft-chip-${index + 1}`}
                testId={`shape-draft-chip-${index + 1}`}
                chip={chipAt(edge.at, edge.label, mmPerPx)}
              />
            ))}
          </g>
        </g>
      )}
      {handles?.map((point, index) => (
        <circle
          key={`shape-handle-${index + 1}`}
          data-testid={`shape-handle-${index + 1}`}
          className="bb-shape-handle"
          data-selected={selectedVertex === index + 1 ? 'true' : 'false'}
          cx={point.x}
          cy={point.y}
          r={PAD_MM / 4}
          onPointerDown={(event) => grabHandle(index + 1, event)}
        />
      ))}
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
      {/* The typed length is HTML over the SVG, because a `<text>` cannot be edited. It sits on
          the Edge it describes and takes the same keys as the field it replaces: Enter commits,
          Esc closes the field and leaves the draft alone. */}
      {field !== null && lengthField !== null && (
        <input
          data-testid="draft-length"
          className="bb-shape-length"
          style={{ left: `${field.x}px`, top: `${field.y}px` }}
          value={lengthField.value}
          inputMode="decimal"
          aria-label="Length"
          autoFocus
          onChange={(event) => lengthField.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              lengthField.onCommit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              lengthField.onCancel()
            }
          }}
          onBlur={() => lengthField.onCommit()}
        />
      )}
    </div>
  )
}

/** A chip centred above a point, sized in screen pixels and placed in millimetres. */
function chipAt(at: Pt, label: string, mmPerPx: number) {
  const widthPx = CHIP_PAD_PX * 2 + label.length * CHIP_CHAR_PX
  return {
    x: at.x + (CHIP_GAP_PX - widthPx / 2) * mmPerPx,
    y: at.y + (-CHIP_HEIGHT_PX / 2 - CHIP_GAP_PX) * mmPerPx,
    width: widthPx * mmPerPx,
    height: CHIP_HEIGHT_PX * mmPerPx,
    label,
  }
}

/** Chip size, in screen pixels: chrome, so a chip does not grow with the shape it labels. */
const CHIP_HEIGHT_PX = 17
const CHIP_GAP_PX = 8
const CHIP_PAD_PX = 6
const CHIP_CHAR_PX = 6.4

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
 *
 * `extra` is where the draft's own points go (#59 §1): a draft drawn outside the committed shape
 * has to stay on screen, and it has to stay there without the toolbar or the canvas box changing
 * size, which is the `A-custom` regression.
 */
function frameOf(footprints: readonly ItemFootprint[], origin: Point2, extra: readonly Point2[] = []): Frame {
  const points: Point2[] = [origin, ...extra]
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
