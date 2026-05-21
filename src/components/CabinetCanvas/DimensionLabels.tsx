import { useState } from 'react'
import { formatDisplay } from '../../engine/unitConversion'
import type { LayoutVoid, Unit } from '../../types'
import DimensionEditor from '../DimensionEditor/DimensionEditor'

interface Props {
  voids: LayoutVoid[]
  unit: Unit
  onCommitSize: (nodeId: string, mm: number, axis: 'w' | 'h') => void
  onUnlockNode?: (nodeId: string) => void
  lockedNodeIds?: string[]
}

interface Editing {
  nodeId: string
  axis: 'w' | 'h'
  currentMm: number
  anchor: { x: number; y: number; width: number; height: number }
}

export default function DimensionLabels(props: Props) {
  const {
    voids,
    unit,
    onCommitSize,
    onUnlockNode,
    lockedNodeIds = [],
  } = props
  const [editing, setEditing] = useState<Editing | null>(null)

  function openEditor(v: LayoutVoid, axis: 'w' | 'h', labelEl: SVGTextElement) {
    const rect = labelEl.getBoundingClientRect()

    setEditing({
      nodeId: v.nodeId,
      axis,
      currentMm: axis === 'w' ? v.w : v.h,
      anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    })
  }

  return (
    <g data-layer="dimension-labels">
      {voids.map((v) => {
        const canEditH = v.parentSplitAxis === 'horizontal'
        const canEditW = v.parentSplitAxis === 'vertical'

        return (
          <g key={v.nodeId}>
            <text
              x={v.x + v.w / 2}
              y={v.y + 14}
              textAnchor="middle"
              fontSize={11}
              fill="rgba(255,255,255,0.7)"
              cursor={canEditW ? 'pointer' : 'default'}
              onClick={canEditW ? (e) => openEditor(v, 'w', e.currentTarget) : undefined}
            >
              {formatDisplay(v.w, unit)}
            </text>

            <text
              x={v.x + 12}
              y={v.y + v.h / 2}
              textAnchor="middle"
              fontSize={11}
              fill="rgba(255,255,255,0.7)"
              transform={`rotate(-90, ${v.x + 12}, ${v.y + v.h / 2})`}
              cursor={canEditH ? 'pointer' : 'default'}
              onClick={canEditH ? (e) => openEditor(v, 'h', e.currentTarget) : undefined}
            >
              {formatDisplay(v.h, unit)}
            </text>

            {lockedNodeIds.includes(v.nodeId) && (
              <g
                role="button"
                tabIndex={0}
                transform={`translate(${v.x + v.w - 18}, ${v.y + 8})`}
                cursor={onUnlockNode ? 'pointer' : 'default'}
                onClick={() => onUnlockNode?.(v.nodeId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onUnlockNode?.(v.nodeId)
                }}
                aria-label="Unlock section"
              >
                <path d="M3 7V5a3 3 0 1 1 6 0v2" fill="none" stroke="#fbbf24" strokeWidth={1.5} />
                <rect
                  x={2}
                  y={7}
                  width={8}
                  height={7}
                  rx={1.5}
                  fill="rgba(251,191,36,0.15)"
                  stroke="#fbbf24"
                  strokeWidth={1.5}
                />
              </g>
            )}
          </g>
        )
      })}

      {editing && (
        <DimensionEditor
          anchor={editing.anchor}
          currentMm={editing.currentMm}
          unit={unit}
          onCommit={(mm) => {
            onCommitSize(editing.nodeId, mm, editing.axis)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </g>
  )
}
