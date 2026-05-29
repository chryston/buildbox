import { useState } from 'react'

interface Props {
  zoom: number
  pixelsPerMm: number | null
  onMeasured: (distancePx: number) => void
}

export default function CalibrationOverlay({ zoom, pixelsPerMm, onMeasured }: Props) {
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
      // When pixelsPerMm is already set, local coords are in mm — convert back to raw pixels.
      // When no scale yet, local coords are raw pixels already.
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
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      style={{ cursor: 'crosshair' }}
    >
      {/* Transparent full-canvas hit area */}
      <rect
        x="-50%" y="-50%"
        width="200%" height="200%"
        fill="transparent"
        style={{ cursor: 'crosshair' }}
      />

      {pointA && (
        <circle cx={pointA.x} cy={pointA.y} r={r}
          fill="#f5f5f7" stroke="#0a84ff" strokeWidth={2/zoom} />
      )}
      {pointA && preview && (
        <line
          x1={pointA.x} y1={pointA.y} x2={preview.x} y2={preview.y}
          stroke="#0a84ff" strokeWidth={2/zoom}
          strokeDasharray={`${8/zoom},${4/zoom}`}
        />
      )}
      {pointA && (
        <text x={pointA.x + r + 4/zoom} y={pointA.y}
          fontSize={12/zoom} fill="#f5f5f7" dominantBaseline="middle">
          Click second point
        </text>
      )}
      {!pointA && (
        <text x={0} y={-20/zoom}
          fontSize={12/zoom} fill="#0a84ff" dominantBaseline="middle">
          Click first calibration point
        </text>
      )}
    </g>
  )
}
