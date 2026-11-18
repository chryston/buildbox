/**
 * The Plan View canvas (#55 criterion 3): the Floor's Plan Image and its Placed Items,
 * drawn under one `matrix(zoom,0,0,zoom,panX,panY)`, exactly as the legacy canvas drew
 * them — the same 0.1×–10× range, the same cursor-centred wheel zoom, the same
 * quarter-turn rotation, the same raw-pixel drawing of an uncalibrated image.
 *
 * What changed is who owns the viewport: it arrives from the workspace store (and the
 * device-local cache behind it) instead of component state, so it survives module
 * switches and reloads. A drag previews in the store and commits one
 * `plan.updateObject` when the pointer comes up — one Intent, one undo step.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { PlanImageView, PlanItemView } from './planModel'
import type { Viewport } from './viewport'
import { fitViewport, zoomAround } from './viewport'
import type { ItemDragPreview, WorkspaceTool } from './workspaceStore'

const WHEEL_IN = 1.25
const WHEEL_OUT = 0.8

export interface PlanViewCanvasProps {
  hostRef: RefObject<HTMLDivElement | null>
  svgRef: RefObject<SVGSVGElement | null>
  items: readonly PlanItemView[]
  image: PlanImageView | null
  /** `null` until the cache has answered or the first `Fit` has run. */
  viewport: Viewport | null
  onViewport: (viewport: Viewport) => void
  tool: WorkspaceTool
  selection: string | null
  onSelect: (id: string | null) => void
  dragPreview: ItemDragPreview | null
  onDragPreview: (preview: ItemDragPreview | null) => void
  /** The pointer came up after a real move: commit the whole drag as one Intent. */
  onMoveItem: (id: string, x: number, y: number) => void
  /** Drawn above the items while calibrating; it owns the pointer meanwhile. */
  overlay?: ReactNode
}

export function PlanViewCanvas(props: PlanViewCanvasProps): ReactNode {
  const {
    hostRef, svgRef, items, image, viewport, onViewport, tool, selection, onSelect,
    dragPreview, onDragPreview, onMoveItem, overlay,
  } = props
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState(false)
  const panning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const panMoved = useRef(false)

  const contentW = image?.widthMm ?? 800
  const contentH = image?.heightMm ?? 600

  // The host's size drives both `Fit` and the first-viewport decision.
  useEffect(() => {
    const el = hostRef.current
    if (el === null) return
    const measure = (): void => setHostSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hostRef])

  // No cached viewport for this view: `Fit` once the host has a size.
  useEffect(() => {
    if (viewport !== null || hostSize.width <= 0 || hostSize.height <= 0) return
    onViewport(fitViewport(hostSize.width, hostSize.height, contentW, contentH))
  }, [viewport, hostSize, contentW, contentH, onViewport])

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = svgRef.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      if (viewport === null) return
      const rect = el.getBoundingClientRect()
      onViewport(zoomAround(viewport, event.deltaY < 0 ? WHEEL_IN : WHEEL_OUT, event.clientX - rect.left, event.clientY - rect.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [svgRef, viewport, onViewport])

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (overlay !== undefined) return // the calibration overlay owns the pointer
    const isPanGesture = tool === 'pan' || event.button === 1
    if (!isPanGesture || viewport === null) return
    panning.current = true
    panMoved.current = false
    lastPan.current = { x: event.clientX, y: event.clientY }
    svgRef.current?.setPointerCapture(event.pointerId)
  }, [overlay, tool, viewport, svgRef])

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!panning.current || viewport === null) return
    const dx = event.clientX - lastPan.current.x
    const dy = event.clientY - lastPan.current.y
    if (dx !== 0 || dy !== 0) panMoved.current = true
    lastPan.current = { x: event.clientX, y: event.clientY }
    onViewport({ zoom: viewport.zoom, panX: viewport.panX + dx, panY: viewport.panY + dy })
  }, [viewport, onViewport])

  const onPointerUp = useCallback(() => {
    panning.current = false
  }, [])

  const onBackgroundClick = useCallback(() => {
    if (overlay !== undefined || panMoved.current) return
    if (tool === 'select') onSelect(null)
  }, [overlay, panMoved, tool, onSelect])

  function startItemDrag(event: React.PointerEvent<SVGGElement>, item: PlanItemView): void {
    if (tool !== 'select' || viewport === null) return
    event.stopPropagation()
    onSelect(item.id)
    const startX = event.clientX
    const startY = event.clientY
    const origX = item.x
    const origY = item.y
    let moved = false
    let latest = { x: origX, y: origY }
    const target = event.currentTarget

    const onMove = (moveEvent: PointerEvent): void => {
      const dx = (moveEvent.clientX - startX) / viewport.zoom
      const dy = (moveEvent.clientY - startY) / viewport.zoom
      if (!moved && Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) <= 4) return
      moved = true
      latest = { x: origX + dx, y: origY + dy }
      onDragPreview({ id: item.id, x: latest.x, y: latest.y })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragging(false)
      onDragPreview(null)
      if (moved) onMoveItem(item.id, latest.x, latest.y)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    setDragging(true)
    target.setPointerCapture(event.pointerId)
  }

  const zoom = viewport?.zoom ?? 1
  const matrix = viewport === null
    ? undefined
    : `matrix(${viewport.zoom},0,0,${viewport.zoom},${viewport.panX},${viewport.panY})`
  const cursor = overlay !== undefined
    ? 'crosshair'
    : dragging
      ? tool === 'pan' ? 'grabbing' : 'move'
      : tool === 'pan' ? 'grab' : 'default'

  return (
    <>
      <svg
        ref={svgRef}
        data-testid="floor-plan-canvas"
        style={{ touchAction: 'none', cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onBackgroundClick}
      >
        {matrix !== undefined && (
          <g transform={matrix}>
            {image !== null && (
              <image
                href={image.src}
                x={0}
                y={0}
                width={image.widthMm}
                height={image.heightMm}
                preserveAspectRatio="none"
                style={{ pointerEvents: 'none' }}
              />
            )}
            {image === null && (
              <rect
                x={0}
                y={0}
                width={contentW}
                height={contentH}
                style={{ fill: 'var(--bb-bg-card)', stroke: 'var(--bb-border-card)' }}
                strokeWidth={2}
              />
            )}
            {items.map((item) => {
              const preview = dragPreview?.id === item.id ? dragPreview : null
              const x = preview?.x ?? item.x
              const y = preview?.y ?? item.y
              const cx = x + item.w / 2
              const cy = y + item.h / 2
              const isSelected = selection === item.id
              return (
                <g
                  key={item.id}
                  data-testid={`placed-object-${item.id}`}
                  transform={`rotate(${item.rotationDeg}, ${cx}, ${cy})`}
                  style={{ cursor: tool === 'select' ? 'move' : undefined }}
                  onPointerDown={(event) => startItemDrag(event, item)}
                  onClick={(event) => event.stopPropagation()}
                >
                  <rect
                    x={x}
                    y={y}
                    width={item.w}
                    height={item.h}
                    fill={item.color + '33'}
                    style={isSelected ? { stroke: 'var(--bb-text)' } : { stroke: item.color }}
                    strokeWidth={(isSelected ? 2 : 1) / zoom}
                    rx={4 / zoom}
                  />
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={Math.max(12 / zoom, 8)}
                    fill={item.color}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {item.label}
                  </text>
                </g>
              )
            })}
            {overlay}
          </g>
        )}
      </svg>
      {image !== null && image.pixelsPerMm !== null && (
        <div className="bb-workspace-scale-hint" data-testid="scale-hint">
          Scale: 1px = {(1 / image.pixelsPerMm).toFixed(2)}mm
        </div>
      )}
    </>
  )
}
