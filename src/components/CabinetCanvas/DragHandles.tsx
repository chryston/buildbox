import { useCallback, useRef } from 'react'
import type { LayoutDivider } from '../../types'
import { useStore } from '../../store/store'

interface Props {
  dividers: LayoutDivider[]
  snapGrid: number
  svgRef: React.RefObject<SVGSVGElement | null>
  zoom: number
}

export function snapToAlignment(y: number, candidates: number[], threshold: number): number {
  if (candidates.length === 0) return y
  const nearest = candidates.reduce((best, c) =>
    Math.abs(c - y) < Math.abs(best - y) ? c : best)
  return Math.abs(nearest - y) <= threshold ? nearest : y
}

export default function DragHandles({ dividers, snapGrid, svgRef, zoom }: Props) {
  const commitDrag = useStore((s) => s.commitDrag)
  const alignmentYs = useRef<number[]>([])
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
  ) {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const initialHandleX = parseFloat(e.currentTarget.getAttribute('x') ?? '0')
    const initialHandleY = parseFloat(e.currentTarget.getAttribute('y') ?? '0')
    const mainBounds = divider.childABounds
    const adjacentBounds = divider.childBBounds
    const originSizeA = divider.axis === 'horizontal' ? mainBounds.h : mainBounds.w

    // Cache alignment positions in parent-relative coordinates at drag start
    if (divider.axis === 'horizontal') {
      const parentStartY = divider.y - originSizeA
      alignmentYs.current = dividers
        .filter(d => d.axis === 'horizontal' && d.nodeId !== divider.nodeId)
        .map(d => d.y + d.h / 2 - parentStartY)
        .filter(y => y > 0)
    }

    dragging.current = {
      dividerId: divider.nodeId,
      axis: divider.axis,
      parentNodeId: divider.parentId,
      originClientPos: divider.axis === 'horizontal' ? e.clientY : e.clientX,
      originSizeA,
      originSizeB: divider.axis === 'horizontal' ? adjacentBounds.h : adjacentBounds.w,
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

    let candidateMm = snap(Math.max(50, originSizeA + mmDelta))
    if (axis === 'horizontal') {
      candidateMm = snapToAlignment(candidateMm, alignmentYs.current, 20)
    }

    if (axis === 'horizontal') {
      handle.setAttribute('y', String(initialHandleY + (candidateMm - originSizeA)))
    } else {
      handle.setAttribute('x', String(initialHandleX + (candidateMm - originSizeA)))
    }

    void candidateMm
  }

  function onPointerUp(e: React.PointerEvent<SVGRectElement>) {
    if (!dragging.current) return
    const { axis, originClientPos, originSizeA, originSizeB, parentNodeId } = dragging.current
    const clientDelta = (axis === 'horizontal' ? e.clientY : e.clientX) - originClientPos
    const mmDelta = svgToMmScale(clientDelta)
    let finalSizeA = snap(Math.max(50, originSizeA + mmDelta))
    if (axis === 'horizontal') {
      finalSizeA = snapToAlignment(finalSizeA, alignmentYs.current, 20)
    }
    finalSizeA = Math.max(50, finalSizeA)
    const effectiveDelta = finalSizeA - originSizeA
    const finalSizeB = Math.max(50, originSizeB - effectiveDelta)
    const ratio = finalSizeA / (finalSizeA + finalSizeB)
    commitDrag(parentNodeId, ratio)
    dragging.current = null
    alignmentYs.current = []
  }

  return (
    <g data-layer="drag-handles">
      {dividers.map((d) => {
        const isHoriz = d.axis === 'horizontal'

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
            onPointerDown={(e) => onPointerDown(e, d)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        )
      })}
    </g>
  )
}
