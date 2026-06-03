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
  const [isDragging, setIsDragging] = useState(false)
  const isPanning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const dragOrigin = useRef({ x: 0, y: 0 })
  const hasMoved = useRef(false)

  const { image, pixelsPerMm, annotations } = floorPlan
  const objectIds = useStore(useShallow((s) => s.floorPlan.objects.map(o => o.id)))
  const selectFloorPlanObject = useStore(s => s.selectFloorPlanObject)

  // Image dimensions in SVG mm-space (or pixels if not calibrated)
  const imgW = image ? (pixelsPerMm ? image.widthPx / pixelsPerMm : image.widthPx) : 800
  const imgH = image ? (pixelsPerMm ? image.heightPx / pixelsPerMm : image.heightPx) : 600

  const handleFitToScreen = useCallback(() => {
    if (!svgRef.current) return
    const container = svgRef.current.parentElement
    if (!container) return
    const { width: cw, height: ch } = container.getBoundingClientRect()
    if (cw <= 0 || ch <= 0) return
    const newZoom = Math.min(cw / (imgW + 2 * PADDING), ch / (imgH + 2 * PADDING), ZOOM_MAX)
    setZoom(newZoom)
    setPan({ x: (cw - imgW * newZoom) / 2, y: (ch - imgH * newZoom) / 2 })
  }, [svgRef, imgW, imgH])

  // Auto-fit whenever image or scale changes
  useEffect(() => {
    handleFitToScreen()
  }, [handleFitToScreen])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.25 : 0.8
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setZoom(prevZ => {
        const newZ = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prevZ * factor))
        setPan(prevPan => ({
          x: mx - (mx - prevPan.x) * newZ / prevZ,
          y: my - (my - prevPan.y) * newZ / prevZ,
        }))
        return newZ
      })
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [svgRef])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const isPanButton = e.button === 1 || e.altKey
    const isPanLeftClick = e.button === 0 && !isCalibrating && !activeAnnotationType
    if (!isPanButton && !isPanLeftClick) return
    isPanning.current = true
    hasMoved.current = false
    dragOrigin.current = { x: e.clientX, y: e.clientY }
    lastPan.current = { x: e.clientX, y: e.clientY }
    setIsDragging(true)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [isCalibrating, activeAnnotationType])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return
    const totalDist = Math.abs(e.clientX - dragOrigin.current.x) + Math.abs(e.clientY - dragOrigin.current.y)
    if (totalDist > 4) hasMoved.current = true
    const dx = e.clientX - lastPan.current.x
    const dy = e.clientY - lastPan.current.y
    lastPan.current = { x: e.clientX, y: e.clientY }
    setPan(p => ({ x: p.x + dx, y: p.y + dy }))
  }, [])

  const onPointerUp = useCallback(() => {
    isPanning.current = false
    setIsDragging(false)
  }, [])

  function handleBackgroundClick() {
    if (hasMoved.current) return
    if (!isCalibrating && !activeAnnotationType) selectFloorPlanObject(null)
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-surface">
      <svg
        ref={svgRef}
        data-testid="floor-plan-canvas"
        className="h-full w-full"
        style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : isCalibrating || activeAnnotationType ? 'crosshair' : 'grab' }}
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
