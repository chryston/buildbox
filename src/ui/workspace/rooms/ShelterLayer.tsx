/**
 * Placing the household shelter (#67 §17).
 *
 * The pack entry is fixed, so there is nothing to size: no box to drag, no field to type. The
 * pointer carries the shelter's internal rectangle and one click puts the whole thing down —
 * Room, four Walls, four references and one door, in one Edit Transaction. The rectangle itself is
 * painted by the Plan View's proposal layer, which is also what turns it red and hatches the region
 * it would take from another Room; this layer only owns the pointer and says what the click does.
 */
import { useRef } from 'react'
import type { ReactNode } from 'react'
import type { Pt } from '../../../derive'
import type { DisplayUnit } from '../../../domain'
import { STRINGS } from '../../strings'
import { formatMm } from '../displayUnits'
import type { Viewport } from '../viewport'
import type { RoomOverlapPreview } from './roomDraft'
import { shelterName, shelterSize } from './roomDraft'

export interface ShelterLayerProps {
  viewport: Viewport
  onCentre: (centre: Pt | null) => void
  /** The click that places it. Never reached while the proposal overlaps. */
  onPlace: (centre: Pt) => void
  onCancel: () => void
  /** The live overlap verdict for the rectangle the pointer is carrying. */
  overlap: RoomOverlapPreview
  unit: DisplayUnit
  precision: number
}

export function ShelterLayer(props: ShelterLayerProps): ReactNode {
  const { viewport, onCentre, onPlace, onCancel, overlap, unit, precision } = props
  const layerRef = useRef<HTMLDivElement>(null)
  const press = useRef<{ x: number; y: number } | null>(null)
  const size = shelterSize()
  const group = new Intl.NumberFormat('en-GB', { maximumFractionDigits: precision })
  const hint = STRINGS.placingFixed(
    shelterName(),
    group.format(Number(formatMm(size.width, unit, precision))),
    group.format(Number(formatMm(size.depth, unit, precision))),
    unit,
  )

  const toFloor = (clientX: number, clientY: number): Pt | null => {
    const el = layerRef.current
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    return {
      x: (clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (clientY - rect.top - viewport.panY) / viewport.zoom,
    }
  }

  return (
    <div
      ref={layerRef}
      data-testid="shelter-layer"
      className="absolute inset-0"
      style={{ cursor: 'crosshair', outline: 'none' }}
      tabIndex={-1}
      onPointerDown={(event) => {
        const control = (event.target as HTMLElement).closest('button, input, label')
        press.current = control === null ? { x: event.clientX, y: event.clientY } : null
        layerRef.current?.focus()
      }}
      onPointerUp={(event) => {
        const started = press.current
        press.current = null
        if (started === null) return
        if (Math.abs(event.clientX - started.x) > 3 || Math.abs(event.clientY - started.y) > 3) return
        const at = toFloor(event.clientX, event.clientY)
        // A blocked placement answers the click with the sentence in the bar and puts down nothing.
        if (at !== null && !overlap.blocked) onPlace(at)
      }}
      onPointerMove={(event) => {
        if ((event.target as HTMLElement).closest('button, input, label') !== null) return
        onCentre(toFloor(event.clientX, event.clientY))
      }}
      onPointerLeave={() => onCentre(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      <div
        data-testid="shelter-bar"
        // The bottom of the canvas belongs to the warnings strip (#66), which would otherwise sit
        // over the one sentence that says why the click is refused. Draft bars live at the top.
        className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        {overlap.message !== null ? (
          <span role="status" data-testid="shelter-blocked" className="bb-shape-problem">
            {overlap.message}
          </span>
        ) : (
          <span data-testid="shelter-hint" className="bb-shape-hint">{hint}</span>
        )}
        <button
          type="button"
          data-testid="shelter-cancel"
          className="bb-workspace-secondary-button"
          onClick={onCancel}
        >
          {STRINGS.cancel}
        </button>
      </div>
    </div>
  )
}
