import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useStore } from '../../store/store'
import type { SceneLayout } from '../../types'
import CanvasLayers from './CanvasLayers'
import DragHandles from './DragHandles'
import DimensionLabels from './DimensionLabels'
import ZoomControls, { ZOOM_MAX, ZOOM_MIN } from './ZoomControls'

interface Props {
  sceneLayout: SceneLayout
  svgRef: RefObject<SVGSVGElement | null>
  onUnlockNode: (nodeId: string) => void
  onUnitClick: (unitId: string) => void
}

const PADDING = 40

export default function CabinetCanvas({ sceneLayout, svgRef, onUnlockNode, onUnitClick }: Props) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const selectedId = useStore((s) => s.selectedId)
  const setSelectedId = useStore((s) => s.setSelectedId)
  const storeSetNodeSize = useStore((s) => s.setNodeSize)
  const snapGrid = useStore((s) => s.snapGrid)

  const { boundingBox: bb } = sceneLayout
  const viewBox = `${bb.x - PADDING} ${bb.y - PADDING} ${bb.w + 2 * PADDING} ${bb.h + 2 * PADDING}`

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * (e.deltaY < 0 ? 1.25 : 0.8))))
  }, [])

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
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
  }, [])

  const onPointerUp = useCallback(() => {
    isPanning.current = false
  }, [])

  const onPointerCancel = useCallback(() => {
    isPanning.current = false
  }, [])

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, z * 1.25))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, z * 0.8))
  }, [])

  const handleFitAll = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  function handleCommitSize(nodeId: string, mm: number, _axis: 'w' | 'h') {
    storeSetNodeSize(nodeId, mm)
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-surface">
      <svg
        ref={svgRef}
        data-testid="cabinet-canvas"
        viewBox={viewBox}
        className="h-full w-full"
        style={{ touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <g transform={`matrix(${zoom},0,0,${zoom},${pan.x},${pan.y})`}>
          {sceneLayout.units.map((result) => (
            <g
              key={result.unitId}
              data-unit-id={result.unitId}
              transform={`translate(${result.x}, ${result.y})`}
              onClick={() => onUnitClick(result.unitId)}
            >
              <CanvasLayers
                panels={result.panels}
                voids={result.voids}
                dividers={result.dividers}
                selectedId={selectedId}
                onSelectVoid={setSelectedId}
                onSelectDivider={setSelectedId}
              />
              <DimensionLabels
                voids={result.voids}
                unit={result.unit}
                onCommitSize={handleCommitSize}
                lockedNodeIds={result.overConstrainedIds}
                onUnlockNode={onUnlockNode}
                zoom={zoom}
              />
              <DragHandles
                dividers={result.dividers}
                snapGrid={snapGrid}
                svgRef={svgRef}
                zoom={zoom}
              />
              {result.isActive && (
                <rect
                  x={-2}
                  y={-2}
                  width={result.w + 4}
                  height={result.h + 4}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={2 / zoom}
                  strokeDasharray={`${6 / zoom} ${3 / zoom}`}
                  pointerEvents="none"
                />
              )}
            </g>
          ))}
        </g>
      </svg>
      <ZoomControls
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitAll={handleFitAll}
      />
    </div>
  )
}
