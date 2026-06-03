import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useStore } from '../../store/store'
import { useShallow } from 'zustand/react/shallow'
import type { Annotation, FloorPlanData } from '../../types'
import AnnotationLayer from './AnnotationLayer'
import PlacedObject from './PlacedObject'
import CalibrationOverlay from './CalibrationOverlay'

const ZOOM_MIN = 0.1
const ZOOM_MAX = 10
const PADDING = 80

interface Props {
  floorPlan: FloorPlanData
  svgRef: RefObject<SVGSVGElement | null>
  isCalibrating: boolean
  activeAnnotationType: 'wall-hack' | 'tile-zone' | null
  onCalibrationPoints: (distancePx: number) => void
  onAddAnnotation: (ann: Annotation) => void
}

export default function FloorPlanCanvas({
  floorPlan, svgRef, isCalibrating, activeAnnotationType, onCalibrationPoints, onAddAnnotation,
}: Props) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })

  const { image, pixelsPerMm, annotations } = floorPlan
  const objectIds = useStore(useShallow((s) => s.floorPlan.objects.map(o => o.id)))
  const selectFloorPlanObject = useStore(s => s.selectFloorPlanObject)

  // Image dimensions in SVG mm-space (or pixels if not calibrated)
  const imgW = image ? (pixelsPerMm ? image.widthPx / pixelsPerMm : image.widthPx) : 800
  const imgH = image ? (pixelsPerMm ? image.heightPx / pixelsPerMm : image.heightPx) : 600
  const viewBox = `${-PADDING} ${-PADDING} ${imgW + 2 * PADDING} ${imgH + 2 * PADDING}`

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom(z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * (e.deltaY < 0 ? 1.25 : 0.8))))
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [svgRef])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 1 && !e.altKey) return
    isPanning.current = true
    lastPan.current = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return
    const dx = e.clientX - lastPan.current.x
    const dy = e.clientY - lastPan.current.y
    lastPan.current = { x: e.clientX, y: e.clientY }

    const svg = (e.currentTarget as SVGSVGElement)
    const ctm = svg.getScreenCTM()
    if (ctm) {
      setPan(p => ({ x: p.x + dx / ctm.a, y: p.y + dy / ctm.d }))
    } else {
      setPan(p => ({ x: p.x + dx, y: p.y + dy }))
    }
  }, [])

  const onPointerUp = useCallback(() => { isPanning.current = false }, [])

  function handleFitToScreen() {
    if (!svgRef.current) return
    const container = svgRef.current.parentElement
    if (!container) return
    const { width: cw, height: ch } = container.getBoundingClientRect()
    const vbW = imgW + 2 * PADDING
    const vbH = imgH + 2 * PADDING
    const newZoom = Math.min(cw / vbW, ch / vbH, ZOOM_MAX)
    setZoom(newZoom)
    setPan({ x: 0, y: 0 })
  }

  function handleBackgroundClick() {
    if (!isCalibrating && !activeAnnotationType) selectFloorPlanObject(null)
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-surface">
      <svg
        ref={svgRef}
        data-testid="floor-plan-canvas"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        style={{ touchAction: 'none', cursor: isCalibrating ? 'crosshair' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleBackgroundClick}
      >
        <g transform={`matrix(${zoom},0,0,${zoom},${pan.x},${pan.y})`}>
          {image && (
            <image
              href={image.dataUrl}
              x={0}
              y={0}
              width={imgW}
              height={imgH}
              preserveAspectRatio="none"
              style={{ pointerEvents: 'none' }}
            />
          )}
          {!image && (
            <rect x={0} y={0} width={imgW} height={imgH}
              fill="var(--color-surface-raised, #3a3a3c)"
              stroke="var(--color-divider, #38383a)" strokeWidth={2}
            />
          )}
          <AnnotationLayer
            annotations={annotations}
            activeType={activeAnnotationType}
            zoom={zoom}
            onAddAnnotation={onAddAnnotation}
          />
          {objectIds.map(id => (
            <PlacedObject
              key={id}
              id={id}
              zoom={zoom}
            />
          ))}
          {isCalibrating && (
            <CalibrationOverlay
              zoom={zoom}
              pixelsPerMm={pixelsPerMm}
              onMeasured={onCalibrationPoints}
            />
          )}
        </g>
      </svg>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex gap-1">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoom(z => Math.max(ZOOM_MIN, z * 0.8))}
          className="rounded border border-divider bg-panel px-2 py-1 text-sm text-text-primary hover:bg-surface-raised"
        >−</button>
        <button
          type="button"
          aria-label="Fit to screen"
          onClick={handleFitToScreen}
          className="rounded border border-divider bg-panel px-2 py-1 text-sm text-text-primary hover:bg-surface-raised"
        >⊞ Fit</button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom(z => Math.min(ZOOM_MAX, z * 1.25))}
          className="rounded border border-divider bg-panel px-2 py-1 text-sm text-text-primary hover:bg-surface-raised"
        >+</button>
      </div>

      {pixelsPerMm && (
        <div className="absolute bottom-4 left-4 text-xs text-text-muted">
          Scale: 1px = {(1 / pixelsPerMm).toFixed(2)}mm
        </div>
      )}
    </div>
  )
}
