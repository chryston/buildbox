import type { Unit } from '../../../domain'
import DimensionEditor from './DimensionEditor'
import type { UnitLayout } from './layout'

/**
 * The two inline editors a cabinet section offers.
 *
 * The measurements themselves are drawn by `drawing/itemDetail.ts` like everything else, so
 * what is left here is the part that is not a drawing: the transparent target that turns a
 * double-click into a name, the `foreignObject` that types it, and the millimetre field that
 * the words of a measurement open. Both write one Edit Transaction and close.
 */

/** An open millimetre field: which measurement, and the box its words occupied on screen. */
export interface DimensionEditing {
  nodeId: string
  axis: 'w' | 'h'
  currentMm: number
  anchor: { x: number; y: number; width: number; height: number }
}

/** An open name field, positioned in the scene's own millimetres. */
export interface LabelEditing {
  nodeId: string
  svgX: number
  svgY: number
  svgW: number
  current: string
}

interface Props {
  units: UnitLayout[]
  unit: Unit
  zoom: number
  editing: DimensionEditing | null
  labelEditing: LabelEditing | null
  onOpenLabel: (edit: LabelEditing) => void
  onCommitSize: (voidId: string, mm: number, axis: 'w' | 'h') => void
  onCommitLabel: (nodeId: string, label: string) => void
  onClose: () => void
  onCloseLabel: () => void
}

export default function DimensionLabels(props: Props) {
  const {
    units,
    unit,
    zoom,
    editing,
    labelEditing,
    onOpenLabel,
    onCommitSize,
    onCommitLabel,
    onClose,
    onCloseLabel,
  } = props

  return (
    <g data-layer="dimension-labels">
      {units.map((u) => (
        // A double-click in the middle of a section names it. The target rides the same
        // translate the drawing put the section in, so it stays where the words are.
        <g key={u.unitId} transform={`translate(${u.x}, ${u.y})`}>
          {u.voids.map((v) => (
            <rect
              key={`edit-${v.nodeId}`}
              data-testid={`section-name-${v.nodeId}`}
              x={v.x + v.w / 4}
              y={v.y + v.h / 4}
              width={v.w / 2}
              height={v.h / 2}
              fill="transparent"
              cursor="text"
              onDoubleClick={() => {
                onOpenLabel({
                  nodeId: v.nodeId,
                  svgX: u.x + v.x + v.w / 4,
                  svgY: u.y + v.y + v.h / 4,
                  svgW: v.w / 2,
                  current: v.spaceLabel ?? '',
                })
              }}
            />
          ))}
        </g>
      ))}

      {/* The name is typed in place, so it keeps the size and place of the word it replaces. */}
      {labelEditing && (
        <foreignObject
          x={labelEditing.svgX}
          y={labelEditing.svgY}
          width={labelEditing.svgW}
          height={24 / zoom}
          style={{ overflow: 'visible' }}
        >
          <input
            // @ts-expect-error xmlns is valid on an HTML element embedded in SVG
            xmlns="http://www.w3.org/1999/xhtml"
            autoFocus
            defaultValue={labelEditing.current}
            className="w-full border border-[var(--color-accent)] bg-[var(--color-surface)] text-[var(--color-text-primary)] px-1 outline-none"
            style={{ fontSize: `${12 / zoom}px`, height: `${24 / zoom}px`, boxSizing: 'border-box' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onCommitLabel(labelEditing.nodeId, (e.target as HTMLInputElement).value)
                onCloseLabel()
              } else if (e.key === 'Escape') {
                onCloseLabel()
              }
            }}
            onBlur={() => onCloseLabel()}
          />
        </foreignObject>
      )}

      {/* The millimetre field floats over the words it replaces, anchored off the live DOM. */}
      {editing && (
        <DimensionEditor
          anchor={editing.anchor}
          currentMm={editing.currentMm}
          unit={unit}
          onCommit={(mm) => {
            onCommitSize(editing.nodeId, mm, editing.axis)
            onClose()
          }}
          onClose={onClose}
        />
      )}
    </g>
  )
}
