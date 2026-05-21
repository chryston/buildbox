import { useCallback, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { computeLayout } from '../../engine/layoutEngine'
import { useStore } from '../../store/store'
import type { Design } from '../../types'
import CanvasLayers from './CanvasLayers'
import DragHandles from './DragHandles'
import DimensionLabels from './DimensionLabels'

interface Props {
  design: Design
  svgRef: RefObject<SVGSVGElement | null>
}

const PADDING = 40

export default function CabinetCanvas({ design, svgRef }: Props) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const selectedId = useStore((s) => s.selectedId)
  const setSelectedId = useStore((s) => s.setSelectedId)
  const storeSetNodeSize = useStore((s) => s.setNodeSize)
  const snapGrid = useStore((s) => s.snapGrid)

  const layout = useMemo(
    () => computeLayout(design),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design.root, design.globalSettings],
  )

  const { width: cW, height: cH } = design.globalSettings
  const viewBox = `${-PADDING} ${-PADDING} ${cW + 2 * PADDING} ${cH + 2 * PADDING}`

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((z) => Math.min(5, Math.max(0.2, z * (e.deltaY < 0 ? 1.1 : 0.9))))
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

  function handleCommitSize(nodeId: string, mm: number, _axis: 'w' | 'h') {
    storeSetNodeSize(nodeId, mm)
  }

  return (
    <div className="flex flex-1 items-center justify-center overflow-hidden bg-surface">
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
          <CanvasLayers
            panels={layout.panels}
            voids={layout.voids}
            dividers={layout.dividers}
            selectedId={selectedId}
            onSelectVoid={setSelectedId}
            onSelectDivider={setSelectedId}
          />
          <DimensionLabels
            voids={layout.voids}
            unit={design.globalSettings.unit}
            onCommitSize={handleCommitSize}
          />
          <DragHandles
            dividers={layout.dividers}
            voids={layout.voids}
            snapGrid={snapGrid}
            svgRef={svgRef}
          />
        </g>
      </svg>
    </div>
  )
}
