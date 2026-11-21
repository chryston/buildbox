/**
 * Picking a Wall face on the canvas (#67 §10, behaviour 26).
 *
 * The inspector's list reaches as far as twelve CSS pixels do at the current zoom; the canvas
 * reaches further, because a person who means the far side of the Flat should not have to zoom in
 * first. Every face parallel to the Edge is offered, each as a band twelve pixels wide on either
 * side of it — a filled shape, so the pointer lands on it in every browser — and the face under the
 * pointer says what it is and what claiming it would do before the click commits to nothing.
 *
 * Choosing a face hands it back; the preview, the overlap check and the `Attach` button in the
 * inspector are the same ones the list uses.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { RoomFaceCandidate } from '../../../derive'
import { SNAP_ACQUISITION_PX } from '../../../derive'
import type { DisplayUnit } from '../../../domain'
import { STRINGS } from '../../strings'
import { readoutMm } from '../displayUnits'
import type { Viewport } from '../viewport'

/** Half the hit band, in CSS pixels: the acquisition range of every other pointer affordance. */
const HALF_PX = SNAP_ACQUISITION_PX

/** The one key a candidate is known by inside the layer. */
const keyOf = (candidate: RoomFaceCandidate): string => `${candidate.wallId}|${candidate.side}`

export interface FacePickLayerProps {
  readonly viewport: Viewport
  /** Every face parallel to the Edge, nearest first, however far away it is. */
  readonly candidates: readonly RoomFaceCandidate[]
  /** The face being previewed, as `wallId|side`, or `null`. */
  readonly previewKey: string | null
  readonly onPick: (candidate: RoomFaceCandidate) => void
  readonly onCancel: () => void
  readonly unit: DisplayUnit
  readonly precision: number
}

export function FacePickLayer(props: FacePickLayerProps): ReactNode {
  const { viewport, candidates, previewKey, onPick, onCancel, unit, precision } = props
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null)
  const read = (mm: number): string => readoutMm(mm, unit, precision)
  const hovered = hover === null ? null : candidates.find((each) => keyOf(each) === hover.key) ?? null

  return (
    <div
      data-testid="face-pick-layer"
      className="absolute inset-0"
      style={{ cursor: 'crosshair', outline: 'none' }}
      tabIndex={-1}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      {candidates.map((candidate) => {
        const key = keyOf(candidate)
        // The band is a screen constant: twelve pixels either side of the face, whatever the zoom,
        // because the reach is a distance a hand can aim at and not a distance in the Flat.
        const dx = candidate.to.x - candidate.from.x
        const dy = candidate.to.y - candidate.from.y
        const length = Math.hypot(dx, dy) * viewport.zoom
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI
        const live = previewKey === key || hover?.key === key
        return (
          <div
            key={key}
            data-testid={`face-pick-hit-${key}`}
            role="button"
            aria-label={candidate.label}
            style={{
              position: 'absolute',
              left: candidate.from.x * viewport.zoom + viewport.panX,
              top: candidate.from.y * viewport.zoom + viewport.panY - HALF_PX,
              width: `${length}px`,
              height: `${HALF_PX * 2}px`,
              transformOrigin: `0 ${HALF_PX}px`,
              transform: `rotate(${deg}deg)`,
              background: 'var(--bb-accent)',
              opacity: live ? 0.3 : 0.12,
              borderBottom: '1px solid var(--bb-accent)',
              borderTop: '1px solid var(--bb-accent)',
              pointerEvents: 'all',
              cursor: 'pointer',
            }}
            onPointerMove={(event) => {
              const box = (event.currentTarget.parentElement ?? event.currentTarget).getBoundingClientRect()
              setHover({ key, x: event.clientX - box.left, y: event.clientY - box.top })
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
              onPick(candidate)
            }}
          />
        )
      })}
      {hover !== null && hovered !== null && (
        <div
          data-testid="face-pick-label"
          className="absolute flex items-center gap-2"
          style={{ left: hover.x + 12, top: hover.y + 12, pointerEvents: 'none' }}
        >
          <span className="bb-shape-hint">{hovered.label}</span>
          <span className="bb-room-face-move">
            {hovered.outline === null
              ? STRINGS.convertToAttach
              : hovered.onFace
                ? STRINGS.noMove
                : STRINGS.movesEdge(read(hovered.distanceMm))}
          </span>
        </div>
      )}
      <div
        data-testid="face-pick-bar"
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <span data-testid="face-pick-hint" className="bb-shape-hint">{STRINGS.pickFace}</span>
        <button
          type="button"
          data-testid="face-pick-cancel"
          className="bb-workspace-secondary-button"
          onClick={onCancel}
        >
          {STRINGS.cancel}
        </button>
      </div>
    </div>
  )
}
