/**
 * Two clicks and a dashed line: the calibration gesture, moved out of the legacy page
 * unchanged in behaviour (#55) — the distance it reports is raw image pixels whether or
 * not the image already carries a scale, because that is what `plan.calibrate` wants.
 *
 * The two colours it drew as literals are now the same tokens the rest of the workspace
 * uses: `--bb-text` for the marker and label, `--bb-accent` for the line (named
 * deviation: tokenised, not re-spelled).
 */
import { useState } from 'react'
import type { ReactNode } from 'react'

export interface CalibrationOverlayProps {
  zoom: number
  pixelsPerMm: number | null
  onMeasured: (distancePx: number) => void
}

export function CalibrationOverlay(props: CalibrationOverlayProps): ReactNode {
  const { zoom, pixelsPerMm, onMeasured } = props
  const [pointA, setPointA] = useState<{ x: number; y: number } | null>(null)
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null)

  function toSvgCoords(e: React.MouseEvent<SVGGElement>): { x: number; y: number } {
    const svg = e.currentTarget.ownerSVGElement as SVGSVGElement
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = e.currentTarget.getScreenCTM()
    if (!ctm) return { x: e.clientX, y: e.clientY }
    const xf = pt.matrixTransform(ctm.inverse())
    return { x: xf.x, y: xf.y }
  }

  function handleClick(e: React.MouseEvent<SVGGElement>) {
    e.stopPropagation()
    const pt = toSvgCoords(e)
    if (!pointA) {
      setPointA(pt)
    } else {
      const dx = pt.x - pointA.x
      const dy = pt.y - pointA.y
      const distanceLocal = Math.hypot(dx, dy)
      // With a scale already set, local coords are mm — convert back to raw pixels.
      // Without one, local coords are raw pixels already.
      const rawDistancePx = pixelsPerMm ? distanceLocal * pixelsPerMm : distanceLocal
      onMeasured(rawDistancePx)
      setPointA(null)
      setPreview(null)
    }
  }

  function handleMouseMove(e: React.MouseEvent<SVGGElement>) {
    if (pointA) setPreview(toSvgCoords(e))
  }

  const r = 6 / zoom

  return (
    <g
      data-layer="calibration"
      data-testid="calibration-overlay"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      style={{ cursor: 'crosshair' }}
    >
      {/* Transparent full-canvas hit area */}
      <rect
        x="-50%"
        y="-50%"
        width="200%"
        height="200%"
        fill="transparent"
        style={{ cursor: 'crosshair' }}
      />
      {pointA && (
        <circle
          cx={pointA.x}
          cy={pointA.y}
          r={r}
          style={{ fill: 'var(--bb-text)', stroke: 'var(--bb-accent)' }}
          strokeWidth={2 / zoom}
        />
      )}
      {pointA && preview && (
        <line
          x1={pointA.x}
          y1={pointA.y}
          x2={preview.x}
          y2={preview.y}
          style={{ stroke: 'var(--bb-accent)' }}
          strokeWidth={2 / zoom}
          strokeDasharray={`${8 / zoom},${4 / zoom}`}
        />
      )}
      {pointA && (
        <text
          x={pointA.x + r + 4 / zoom}
          y={pointA.y}
          fontSize={12 / zoom}
          dominantBaseline="middle"
          style={{ fill: 'var(--bb-text)' }}
        >
          Click second point
        </text>
      )}
      {!pointA && (
        <text
          x={0}
          y={-20 / zoom}
          fontSize={12 / zoom}
          dominantBaseline="middle"
          style={{ fill: 'var(--bb-accent)' }}
        >
          Click first calibration point
        </text>
      )}
    </g>
  )
}
