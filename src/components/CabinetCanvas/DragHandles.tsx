import { useCallback, useRef } from 'react'
import type { LayoutDivider, LayoutVoid } from '../../types'
import { useStore } from '../../store/store'

interface Props {
  dividers: LayoutDivider[]
  voids: LayoutVoid[]
  snapGrid: number
  svgRef: React.RefObject<SVGSVGElement | null>
  zoom: number
}

export default function DragHandles({ dividers, voids, snapGrid, svgRef, zoom }: Props) {
  const commitDrag = useStore((s) => s.commitDrag)
  const dragging = useRef<{
    dividerId: string
    axis: 'horizontal' | 'vertical'
    parentNodeId: string
    originClientPos: number
    originSizeA: number
    originSizeB: number
    initialHandleX: number
    initialHandleY: number
    handle: SVGRectElement
  } | null>(null)

  const svgToMmScale = useCallback((clientDelta: number): number => {
    if (!svgRef.current) return clientDelta
    const svgRect = svgRef.current.getBoundingClientRect()
    const viewBox = svgRef.current.viewBox.baseVal
    const scale = viewBox.width / svgRect.width
    return clientDelta * scale / zoom
  }, [svgRef, zoom])

  function snap(mm: number): number {
    if (snapGrid <= 0) return mm
    return Math.round(mm / snapGrid) * snapGrid
  }

  function onPointerDown(
    e: React.PointerEvent<SVGRectElement>,
    divider: LayoutDivider,
    adjacentVoid: LayoutVoid,
    mainVoid: LayoutVoid,
  ) {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const initialHandleX = parseFloat(e.currentTarget.getAttribute('x') ?? '0')
    const initialHandleY = parseFloat(e.currentTarget.getAttribute('y') ?? '0')
    dragging.current = {
      dividerId: divider.nodeId,
      axis: divider.axis,
      parentNodeId: divider.parentId,
      originClientPos: divider.axis === 'horizontal' ? e.clientY : e.clientX,
      originSizeA: divider.axis === 'horizontal' ? mainVoid.h : mainVoid.w,
      originSizeB: divider.axis === 'horizontal' ? adjacentVoid.h : adjacentVoid.w,
      initialHandleX,
      initialHandleY,
      handle: e.currentTarget,
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGRectElement>) {
    if (!dragging.current) return
    const { axis, originClientPos, originSizeA, initialHandleX, initialHandleY, handle } = dragging.current
    const clientDelta = (axis === 'horizontal' ? e.clientY : e.clientX) - originClientPos
    const mmDelta = svgToMmScale(clientDelta)
    const newSizeA = snap(Math.max(50, originSizeA + mmDelta))

    if (axis === 'horizontal') {
      handle.setAttribute('y', String(initialHandleY + mmDelta))
    } else {
      handle.setAttribute('x', String(initialHandleX + mmDelta))
    }

    void newSizeA
  }

  function onPointerUp(e: React.PointerEvent<SVGRectElement>) {
    if (!dragging.current) return
    const { axis, originClientPos, originSizeA, originSizeB, parentNodeId } = dragging.current
    const clientDelta = (axis === 'horizontal' ? e.clientY : e.clientX) - originClientPos
    const mmDelta = svgToMmScale(clientDelta)
    const finalSizeA = snap(Math.max(50, originSizeA + mmDelta))
    const effectiveDelta = finalSizeA - originSizeA
    const finalSizeB = Math.max(50, originSizeB - effectiveDelta)
    const ratio = finalSizeA / (finalSizeA + finalSizeB)
    commitDrag(parentNodeId, ratio)
    dragging.current = null
  }

  return (
    <g data-layer="drag-handles">
      {dividers.map((d) => {
        const isHoriz = d.axis === 'horizontal'
        const mainVoid = voids.find((v) => v.nodeId === d.childAId)
        const adjacentVoid = voids.find((v) => v.nodeId === d.childBId)
        if (!mainVoid || !adjacentVoid) return null

        const hW = isHoriz ? d.w : 12
        const hH = isHoriz ? 12 : d.h
        const hX = isHoriz ? d.x : d.x + d.w / 2 - 6
        const hY = isHoriz ? d.y + d.h / 2 - 6 : d.y

        return (
          <rect
            key={`${d.nodeId}-handle`}
            data-testid={`drag-handle-${d.nodeId}`}
            x={hX}
            y={hY}
            width={hW}
            height={hH}
            fill="rgba(124,58,237,0.3)"
            stroke="#7c3aed"
            strokeWidth={1}
            cursor={isHoriz ? 'ns-resize' : 'ew-resize'}
            rx={3}
            onPointerDown={(e) => onPointerDown(e, d, adjacentVoid, mainVoid)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        )
      })}
    </g>
  )
}

export function SnapGuide({ x, y, axis }: { x: number; y: number; axis: 'horizontal' | 'vertical' }) {
  return axis === 'horizontal'
    ? <line x1={-1000} y1={y} x2={10000} y2={y} stroke="#7c3aed" strokeWidth={0.5} strokeDasharray="4 4" pointerEvents="none" />
    : <line x1={x} y1={-1000} x2={x} y2={10000} stroke="#7c3aed" strokeWidth={0.5} strokeDasharray="4 4" pointerEvents="none" />
}
