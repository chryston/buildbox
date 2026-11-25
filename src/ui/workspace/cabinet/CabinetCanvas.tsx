import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { drawItemDetail } from '../../../drawing'
import type { Emphasis, Sizing } from '../../../drawing'
import { notePinRadius } from '../../../drawing'
import type { NotePinTone } from '../../../drawing'
import { formatDisplay } from '../../../domain'
import type { CabinetNode, Unit } from '../../../domain'
import { DisplayListSvg } from '../../drawing/DisplayListSvg'
import type { DisplayListInteractions } from '../../drawing/DisplayListSvg'
import DimensionLabels from './DimensionLabels'
import type { DimensionEditing, LabelEditing } from './DimensionLabels'
import DragHandles from './DragHandles'
import type { CabinetDetail } from './layout'
import ZoomControls, { ZOOM_MAX, ZOOM_MIN } from './ZoomControls'

/**
 * The cabinet's Item Detail, drawn from the same display list the exports will use (#60).
 *
 * Panels, sections, dividers, doors, pulls, hinges, measurements and the padlocks over the
 * over-constrained ones all arrive from `drawing/itemDetail.ts`. What this file still owns is
 * the viewport — wheel, middle-drag, the three buttons — and the two things that are gestures
 * rather than drawings: the divider handles and the inline editors.
 */

/** Room around the scene, in millimetres, so a stroke at the edge is not clipped by the box. */
const PADDING = 40

export interface CabinetCanvasProps {
  detail: CabinetDetail
  svgRef: RefObject<SVGSVGElement | null>
  /** The node the inspector is showing; a pinned one is the only measurement that stops being editable. */
  selectedNode?: CabinetNode | null
  selectedNodeId: string | null
  snapGrid: number
  onUnitClick: (unitId: string) => void
  onSelectNode: (nodeId: string) => void
  /** A finished millimetre field, already resolved to the control node that owns the size. */
  onCommitSize: (controlNodeId: string, mm: number) => void
  onCommitLabel: (nodeId: string, label: string) => void
  onCommitDrag: (parentNodeId: string, ratio: number) => void
  onUnlockNode: (nodeId: string) => void
  /**
   * The Comment tool is armed, so a node click anchors a feature Comment `(itemDesignId, nodeId)`
   * instead of selecting the node, and a click on empty canvas anchors an Item Design Comment (#80 §12).
   *
   * Both are absent unless notes are on offer here, and the tool is checked by the caller rather than
   * by this component: the cabinet chrome has no business knowing which workspace tool is armed.
   */
  onCommentNode?: (nodeId: string) => void
  onCommentCanvas?: () => void
  /**
   * The overlay's marks for this Item Design (#80 §12): one pin at the centre of each node that has a
   * feature Comment, and one count badge on the item outline for the Comments about the design itself.
   * A design's notes are a count rather than a row of pins because they are about the whole thing —
   * pinning four of them to the same outline would be four marks saying one sentence.
   */
  notePins?: readonly CabinetNotePin[]
  noteBadge?: CabinetNoteBadge | null
  onNotePointerDown?: (id: string) => void
}

/** A feature Comment's pin, at the centre of the node it is anchored to. */
export interface CabinetNotePin {
  readonly id: string
  readonly nodeId: string
  readonly tone: NotePinTone
}

/** The count of Comments about the Item Design as a whole. */
export interface CabinetNoteBadge {
  readonly id: string
  readonly count: number
  readonly tone: NotePinTone
}

export function CabinetCanvas(props: CabinetCanvasProps) {
  const { detail, svgRef, selectedNodeId, snapGrid } = props
  const notePins = props.notePins ?? []
  const noteBadge = props.noteBadge ?? null
  const selectedNode = props.selectedNode ?? null
  const sceneLayout = detail.layout
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const [editing, setEditing] = useState<DimensionEditing | null>(null)
  const [labelEditing, setLabelEditing] = useState<LabelEditing | null>(null)

  const { boundingBox: bb } = sceneLayout
  /** The same priority colours the Plan View's pins use, so a High note looks the same in both views. */
  const NOTE_TONE_FILL: Record<NotePinTone, string> = {
    high: '--bb-note-high',
    normal: '--bb-note-normal',
    low: '--bb-note-low',
    resolved: '--bb-note-resolved',
  }
  /** The middle of a node's box, in drawing millimetres — where its pin stands (§12). */
  const nodeCentre = (nodeId: string): { x: number; y: number } | null => {
    for (const each of sceneLayout.units) {
      const void_ = each.voids.find((one) => one.nodeId === nodeId)
      if (void_ !== undefined) return { x: each.x + void_.x + void_.w / 2, y: each.y + void_.y + void_.h / 2 }
      const divider = each.dividers.find((one) => one.childAId === nodeId)
      if (divider !== undefined) return { x: each.x + divider.x, y: each.y + divider.y }
    }
    return null
  }
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

  // A millimetre field names the section it came from; the size is written to the control node
  // on that side of it, which is a fact about the layout rather than about the drawing.
  function handleCommitSize(voidId: string, mm: number, axis: 'w' | 'h') {
    for (const unit of sceneLayout.units) {
      const void_ = unit.voids.find((v) => v.nodeId === voidId)
      if (void_) {
        const controlId = axis === 'h' ? void_.heightControlNodeId : void_.widthControlNodeId
        if (controlId) props.onCommitSize(controlId, mm)
        return
      }
    }
  }

  const unit: Unit = sceneLayout.units[0]?.unit ?? 'mm'
  // A cabinet is drawn in millimetres and scaled by the viewport, so a size written in px is
  // divided by this zoom and the matrix multiplies it straight back — which is exactly the
  // `Math.max(12 / zoom, 8)` the canvas used to write by hand.
  const sizing: Sizing = { kind: 'screen', pxPerMm: zoom }
  const pinnedNodeId =
    selectedNode?.locked === true && selectedNode?.fixedSize != null ? selectedNode.id : null
  const list = drawItemDetail(
    detail,
    { pinnedNodeId },
    { sizing, formatLength: (mm) => formatDisplay(mm, unit) },
  )
  const emphasis: Emphasis = selectedNodeId === null ? {} : { selected: new Set([selectedNodeId]) }

  const unitOfNode = (nodeId: string) => sceneLayout.units.find((u) =>
    u.voids.some((v) => v.nodeId === nodeId) || u.dividers.some((d) => d.childAId === nodeId))

  const interactions: DisplayListInteractions = {
    onUnitClick: props.onUnitClick,
    onSelectNode: (id) => {
      // The Comment tool owns the click: the node is what the note is about, and selecting it would
      // open its measurement fields on top of the editor (#80 §12).
      if (props.onCommentNode !== undefined) {
        props.onCommentNode(id)
        return
      }
      const owner = unitOfNode(id)
      if (owner !== undefined) props.onUnitClick(owner.unitId)
      props.onSelectNode(id)
    },
    onUnlock: props.onUnlockNode,
    onDimensionClick: (id, axis, event) => {
      const box = event.currentTarget.getBoundingClientRect()
      const owner = unitOfNode(id)
      const target = owner?.voids.find((v) => v.nodeId === id)
      if (target === undefined || owner === undefined) return
      setEditing({
        nodeId: id,
        axis,
        currentMm: axis === 'w' ? target.w : target.h,
        anchor: { x: box.x, y: box.y, width: box.width, height: box.height },
      })
    },
  }

  // Every unit carries its own divider handles, not just the active one: a divider in an
  // inactive unit is draggable the moment it is pressed, and pressing it is how a person makes
  // that unit active. `main` drew them for all of them, and a handle that appears only after
  // the click that was aiming at it is a control that hides itself.
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-surface">
      <svg
        ref={svgRef}
        data-testid="cabinet-canvas"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        style={{ touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onClick={(event) => {
          // A click that landed on the canvas itself and not on a board: the Item Design is what the
          // note is about, which is the one Comment that belongs to the design rather than to a node
          // of it (#80 §12).
          if (props.onCommentCanvas === undefined || event.target !== event.currentTarget) return
          props.onCommentCanvas()
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <DisplayListSvg
          list={list}
          sizing={sizing}
          matrix={`matrix(${zoom},0,0,${zoom},${pan.x},${pan.y})`}
          textSpace="list"
          emphasis={emphasis}
          resolveAsset={() => null}
          interactions={interactions}
        >
          {sceneLayout.units.map((each) => (
            <g key={each.unitId} transform={`translate(${each.x},${each.y})`}>
              <DragHandles
                dividers={each.dividers}
                snapGrid={snapGrid}
                svgRef={svgRef}
                zoom={zoom}
                onCommitDrag={props.onCommitDrag}
              />
            </g>
          ))}
          <DimensionLabels
            units={sceneLayout.units}
            unit={unit}
            zoom={zoom}
            editing={editing}
            labelEditing={labelEditing}
            onOpenLabel={setLabelEditing}
            onCommitSize={handleCommitSize}
            onCommitLabel={props.onCommitLabel}
            onClose={() => setEditing(null)}
            onCloseLabel={() => setLabelEditing(null)}
          />
        </DisplayListSvg>
        {/* The overlay's marks (#80 §12), in the same screen-space transform the drawing uses so a pin
            stays the same size at any zoom. A pin sits at its node's centre; the design's own notes are
            one count on the outline. Both are clickable, because a mark you cannot click is a decoration. */}
        <g transform={`matrix(${zoom},0,0,${zoom},${pan.x},${pan.y})`} data-testid="cabinet-note-marks">
          {notePins.map((pin) => {
            const node = nodeCentre(pin.nodeId)
            if (node === null) return null
            return (
              <circle
                key={pin.id}
                data-testid={`cabinet-note-pin-${pin.id}`}
                cx={node.x}
                cy={node.y}
                r={notePinRadius(sizing)}
                fill={`var(${NOTE_TONE_FILL[pin.tone]})`}
                stroke="var(--bb-bg-card)"
                strokeWidth={1}
                style={{ cursor: 'pointer' }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  props.onNotePointerDown?.(pin.id)
                }}
              />
            )
          })}
          {noteBadge === null || noteBadge.count === 0
            ? null
            : (
                <text
                  data-testid="cabinet-note-badge"
                  x={bb.x + bb.w}
                  y={bb.y}
                  textAnchor="end"
                  dominantBaseline="hanging"
                  fontSize={notePinRadius(sizing) * 1.6}
                  fill={`var(${NOTE_TONE_FILL[noteBadge.tone]})`}
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    props.onNotePointerDown?.(noteBadge.id)
                  }}
                >
                  {`✎${noteBadge.count}`}
                </text>
              )}
        </g>
      </svg>
      <ZoomControls zoom={zoom} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFitAll={handleFitAll} />
    </div>
  )
}
