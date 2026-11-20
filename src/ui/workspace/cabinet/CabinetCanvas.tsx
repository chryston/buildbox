import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { drawItemDetail } from '../../../drawing'
import type { Emphasis, Sizing } from '../../../drawing'
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
}

export function CabinetCanvas(props: CabinetCanvasProps) {
  const { detail, svgRef, selectedNodeId, snapGrid } = props
  const selectedNode = props.selectedNode ?? null
  const sceneLayout = detail.layout
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const [editing, setEditing] = useState<DimensionEditing | null>(null)
  const [labelEditing, setLabelEditing] = useState<LabelEditing | null>(null)

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

  // Only the active unit's sections can be dragged: the handles belong to the app, not to the
  // drawing, and they mark the one unit the person is editing.
  const activeUnit = sceneLayout.units.find((u) => u.isActive)

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
          {activeUnit !== undefined && (
            <g transform={`translate(${activeUnit.x},${activeUnit.y})`}>
              <DragHandles
                dividers={activeUnit.dividers}
                snapGrid={snapGrid}
                svgRef={svgRef}
                zoom={zoom}
                onCommitDrag={props.onCommitDrag}
              />
            </g>
          )}
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
      </svg>
      <ZoomControls zoom={zoom} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFitAll={handleFitAll} />
    </div>
  )
}
