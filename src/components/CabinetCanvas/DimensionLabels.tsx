import { useState } from 'react'
import { formatDisplay } from '../../engine/unitConversion'
import type { CabinetNode, LayoutVoid, Unit } from '../../types'
import DimensionEditor from '../DimensionEditor/DimensionEditor'

const LOCKED_OPACITY = 0.4

function LockIcon({ color }: { color: string }) {
  return (
    <>
      <path d="M2 5V3.5a2.5 2.5 0 0 1 5 0V5" fill="none" stroke={color} strokeWidth={1.5} />
      <rect x={1} y={5} width={7} height={5} rx={1} fill="none" stroke={color} strokeWidth={1.5} />
    </>
  )
}

interface Props {
  voids: LayoutVoid[]
  unit: Unit
  onCommitSize: (nodeId: string, mm: number, axis: 'w' | 'h') => void
  onCommitLabel?: (nodeId: string, label: string) => void
  onUnlockNode?: (nodeId: string) => void
  lockedNodeIds?: string[]
  selectedNode?: CabinetNode | null
  zoom: number
}

interface Editing {
  nodeId: string
  axis: 'w' | 'h'
  currentMm: number
  anchor: { x: number; y: number; width: number; height: number }
}

interface LabelEditing {
  nodeId: string
  anchor: { x: number; y: number; width: number; height: number }
  current: string
}

export default function DimensionLabels(props: Props) {
  const {
    voids,
    unit,
    onCommitSize,
    onCommitLabel,
    onUnlockNode,
    lockedNodeIds = [],
    selectedNode,
    zoom,
  } = props
  const [editing, setEditing] = useState<Editing | null>(null)
  const [labelEditing, setLabelEditing] = useState<LabelEditing | null>(null)

  const fontSize = Math.max(12 / zoom, 8)

  const isPinned = selectedNode?.locked === true && selectedNode?.fixedSize != null

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
        const canEditH = !!v.heightControlNodeId && !isPinned
        const canEditW = !!v.widthControlNodeId && !isPinned

        return (
          <g key={v.nodeId}>
            {/* Width label */}
            <text
              data-testid={`dim-label-${v.nodeId}-w`}
              x={v.x + v.w / 2}
              y={v.y + fontSize + 2}
              textAnchor="middle"
              fontSize={fontSize}
              fill="var(--color-dim-label)"
              opacity={canEditW ? 1 : LOCKED_OPACITY}
              textDecoration={canEditW ? 'underline' : 'none'}
              cursor={canEditW ? 'pointer' : 'default'}
              onClick={canEditW ? (e) => openEditor(v, 'w', e.currentTarget) : undefined}
            >
              {formatDisplay(v.w, unit)}
            </text>
            {!canEditW && (
              <g
                data-testid={`lock-icon-${v.nodeId}-w`}
                opacity={LOCKED_OPACITY}
                transform={`translate(${v.x + v.w / 2 + fontSize * 1.8}, ${v.y + fontSize + 2 - fontSize * 0.7}) scale(${fontSize / 14})`}
              >
                <LockIcon color="var(--color-dim-label)" />
              </g>
            )}

            {/* Height label */}
            <text
              data-testid={`dim-label-${v.nodeId}-h`}
              x={v.x + fontSize + 2}
              y={v.y + v.h / 2}
              textAnchor="middle"
              fontSize={fontSize}
              fill="var(--color-dim-label)"
              opacity={canEditH ? 1 : LOCKED_OPACITY}
              textDecoration={canEditH ? 'underline' : 'none'}
              cursor={canEditH ? 'pointer' : 'default'}
              transform={`rotate(-90, ${v.x + fontSize + 2}, ${v.y + v.h / 2})`}
              onClick={canEditH ? (e) => openEditor(v, 'h', e.currentTarget) : undefined}
            >
              {formatDisplay(v.h, unit)}
            </text>
            {!canEditH && (
              <g
                data-testid={`lock-icon-${v.nodeId}-h`}
                opacity={LOCKED_OPACITY}
                transform={`translate(${v.x + fontSize + 2 - fontSize * 0.4}, ${v.y + v.h / 2 - fontSize * 2.5}) scale(${fontSize / 14})`}
              >
                <LockIcon color="var(--color-dim-label)" />
              </g>
            )}

            {/* Space label overlay */}
            {v.spaceLabel && (
              <text
                data-testid={`space-label-${v.nodeId}`}
                x={v.x + v.w / 2}
                y={v.y + v.h / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={Math.max(10 / zoom, 6)}
                fill="#6b7280"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {v.spaceLabel.length > 20 ? v.spaceLabel.slice(0, 20) + '…' : v.spaceLabel}
              </text>
            )}

            {/* Space label click-to-edit area */}
            {onCommitLabel && (
              <rect
                x={v.x + v.w / 4}
                y={v.y + v.h / 4}
                width={v.w / 2}
                height={v.h / 2}
                fill="transparent"
                style={{ cursor: 'text' }}
                onDoubleClick={(e) => {
                  const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect()
                  setLabelEditing({
                    nodeId: v.nodeId,
                    anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
                    current: v.spaceLabel ?? '',
                  })
                }}
              />
            )}

            {/* Over-constrained unlock button */}
            {lockedNodeIds.includes(v.nodeId) && (
              <g
                role="button"
                tabIndex={0}
                transform={`translate(${v.x + v.w - 18 + 6}, ${v.y + 4 + 9.5}) scale(${1 / zoom}) translate(-6, -9.5)`}
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

      {labelEditing && (
        <DimensionEditor
          anchor={labelEditing.anchor}
          currentMm={0}
          unit={unit}
          onCommit={() => setLabelEditing(null)}
          onClose={() => setLabelEditing(null)}
        />
      )}
    </g>
  )
}
