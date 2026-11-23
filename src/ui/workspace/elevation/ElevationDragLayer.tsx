/**
 * The handles, the ghost and the chip of one vertical drag (#75 §6, §7).
 *
 * The pane draws an entity as a box; this puts a square on each end of that box and on its body, and
 * turns the hand's vertical movement into one number. Nothing here knows what a Wall is: the row says
 * which handles it offers, the pure module says what a delta does to its two edges, and the pane's
 * owner says which Intent writes the answer. That seam is what lets Beams, Skirting and Services join
 * later by describing their rows rather than by editing this file.
 *
 * Three rules hold the gesture honest:
 *
 * - **Vertical only.** The pointer's horizontal movement is read and thrown away. Where a thing stands
 *   is the plan's business, and a handle that moved both would quietly move the plan from the pane
 *   that is supposed to only look up.
 * - **One transaction, on release.** The ghost and the chip are screen state; the document is written
 *   once, by one Intent, when the hand lets go. Escape writes nothing at all.
 * - **A snap is a number, not a link.** The guide line and its label say what the edge was taken by
 *   while the drag lasts, and nothing of it survives the release: if the cabinet that set 860 later
 *   changes height, this entity stays where it was put.
 */
import { useEffect, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { ElevationRow, VerticalSnap, VerticalSnapCandidate } from '../../../derive'
import { verticalBodySnap, verticalSnap, verticalTolerance } from '../../../derive'
import type { Viewport } from '../viewport'
import {
  draggedEdges,
  draggedEdgesAreInvalid,
  elevationChipText,
  elevationCommit,
  elevationHandleKinds,
} from './elevationDrag'
import type { ElevationDragKind, ElevationEdges } from './elevationDrag'

/** A handle is 8 CSS px on the screen whatever the zoom, the same as the plan's endpoint handles. */
const HANDLE_PX = 8

/** The chip sits this far from the handle it belongs to, so it never covers it. */
const CHIP_OFFSET_PX = 14

export interface ElevationDragLayerProps {
  /** The selected entity's row, or nothing when the selection is not something this view draws. */
  row: ElevationRow
  viewport: Viewport
  /**
   * The same transform the pane gives its Display List: everything this layer draws is in the
   * drawing's own millimetres, so it has to ride the same matrix or it lands nowhere near the row it
   * belongs to.
   */
  matrix: string
  /**
   * A client point in the drawing's own millimetres. Its `y` is the drawing's, which grows downward from
   * the top of the picture; `zOf` turns it into a height above the Floor Datum.
   */
  toDrawing: (clientX: number, clientY: number) => { x: number, y: number } | null
  /** A height above the Floor Datum to the drawing's y: where a handle or a guide is put. */
  yOf: (z: number) => number
  /** The drawing's y back to a height above the Floor Datum: what the pointer is standing at. */
  zOf: (y: number) => number
  /** The heights the drag may stop at, already filtered by `Snaps ▾` and by this view's own rules. */
  candidates: readonly VerticalSnapCandidate[]
  /** One finished drag: the field the canonical entity's Intent writes, and the value it writes. */
  onCommit: (field: 'base' | 'height' | 'top', value: number) => void
}

/** The two edges a row presents, lowest first, because a row's `zMin` is not guaranteed to be the base. */
const edgesOf = (row: ElevationRow): ElevationEdges => ({
  bottom: Math.min(row.zMin, row.zMax),
  top: Math.max(row.zMin, row.zMax),
})

/** The height a handle sits at: the end it drags, or the middle of the body. */
const handleZ = (kind: ElevationDragKind, edges: ElevationEdges): number =>
  kind === 'top' ? edges.top : kind === 'bottom' ? edges.bottom : (edges.top + edges.bottom) / 2

export function ElevationDragLayer(props: ElevationDragLayerProps): ReactNode {
  const { row, viewport, matrix, toDrawing, yOf, zOf, candidates, onCommit } = props
  const [drag, setDrag] = useState<{ kind: ElevationDragKind, edges: ElevationEdges, snap: VerticalSnap | null } | null>(null)
  const original = edgesOf(row)
  const zoom = viewport.zoom
  const handle = HANDLE_PX / zoom
  const hairline = 1.5 / zoom

  // A new selection is a new gesture: a drag that was under way belongs to the entity it started on.
  useEffect(() => {
    setDrag(null)
  }, [row.id])

  /**
   * Escape backs out of the drag with the document untouched (#75 §6).
   *
   * The listener is on the window for the length of the gesture only, because a key press that lands
   * anywhere — the rail, the card, the toolbar — means the same thing while a handle is in the hand:
   * put it back.
   */
  useEffect(() => {
    if (drag === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setDrag(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [drag === null])

  const begin = (kind: ElevationDragKind) => (event: ReactPointerEvent<SVGRectElement>): void => {
    event.stopPropagation()
    setDrag({ kind, edges: original, snap: null })
    const move = (moveEvent: PointerEvent): void => {
      const at = toDrawing(moveEvent.clientX, moveEvent.clientY)
      if (at === null) return
      // Only the height is read; the pointer's horizontal position is discarded on purpose. The
      // drawing's y becomes a height above the Floor Datum here and nowhere else, so every number the
      // drag reasons about — its edges, its snaps, its commit, its chip — is a height.
      const moved = draggedEdges(kind, original, zOf(at.y) - handleZ(kind, original))
      if (draggedEdgesAreInvalid(kind, moved)) return
      const tolerance = verticalTolerance(zoom)
      const snap = kind === 'body'
        ? verticalBodySnap(candidates, moved, tolerance, row.id)
        : verticalSnap(candidates, kind === 'top' ? moved.top : moved.bottom, tolerance, row.id)
      // A snapped edge lands on the target rather than on the cursor, which is the whole point of one.
      // A body takes the winning edge's delta on both of its edges, so it keeps the height it has.
      const settled = snap === null ? moved
        : kind === 'body' ? { bottom: moved.bottom + snap.delta, top: moved.top + snap.delta }
          : { ...moved, [kind === 'top' ? 'top' : 'bottom']: snap.mm }
      setDrag({ kind, edges: settled, snap })
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      setDrag((current) => {
        if (current === null) return null
        // A press that never moved, or moved less than a millimetre, is not an edit: the same number
        // back would put a step on the Undo stack that undoes nothing.
        const moved = Math.abs(current.edges.bottom - original.bottom)
          + Math.abs(current.edges.top - original.top)
        if (moved >= 0.5) {
          const commit = elevationCommit(current.kind, row.kind, current.edges)
          onCommit(commit.field, commit.value)
        }
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const shown = drag?.edges ?? original
  const left = Math.min(row.sMin, row.sMax)
  const right = Math.max(row.sMin, row.sMax)
  const kinds = elevationHandleKinds(row.kind)
  const guide = drag?.snap ?? null

  return (
    <g data-testid="elevation-drag-layer" data-row={row.id} transform={matrix}>
      {drag !== null && (
        <>
          <rect
            data-testid="elevation-drag-ghost"
            x={left}
            y={yOf(shown.top)}
            width={right - left}
            height={yOf(shown.bottom) - yOf(shown.top)}
            fill="var(--bb-accent)"
            fillOpacity={0.14}
            stroke="var(--bb-accent)"
            strokeWidth={hairline}
            strokeDasharray={`${5 / zoom} ${3 / zoom}`}
          />
          {guide !== null && (
            <>
              <line
                data-testid="elevation-snap-guide"
                x1={-100_000}
                y1={yOf(guide.mm)}
                x2={100_000}
                y2={yOf(guide.mm)}
                stroke="var(--bb-accent)"
                strokeWidth={hairline}
                strokeDasharray={`${6 / zoom} ${4 / zoom}`}
              />
              <text
                data-testid="elevation-snap-label"
                x={left}
                y={yOf(guide.mm) - 6 / zoom}
                fontSize={12 / zoom}
                fill="var(--bb-accent)"
              >
                {`${guide.candidate.label} · ${Math.round(guide.mm)} mm`}
              </text>
            </>
          )}
        </>
      )}
      {kinds.map((kind) => (
        <rect
          key={kind}
          data-testid={`elevation-handle-${kind}`}
          x={kind === 'body' ? (left + right) / 2 - handle / 2 : right - handle / 2}
          y={yOf(handleZ(kind, shown)) - handle / 2}
          width={handle}
          height={handle}
          fill="var(--bb-accent)"
          stroke="var(--bb-bg-app)"
          strokeWidth={hairline}
          style={{ cursor: drag?.kind === kind ? 'grabbing' : 'ns-resize' }}
          onPointerDown={begin(kind)}
        />
      ))}
      {drag !== null && (
        <text
          data-testid="elevation-drag-chip"
          x={right + CHIP_OFFSET_PX / zoom}
          y={yOf(handleZ(drag.kind, shown))}
          fontSize={12 / zoom}
          dominantBaseline="middle"
          fill="var(--bb-accent)"
        >
          {elevationChipText(drag.kind, shown, original)}
        </text>
      )}
    </g>
  )
}
