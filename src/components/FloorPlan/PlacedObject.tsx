import { useRef, useEffect } from 'react'
import { useStore } from '../../store/store'
import type { FloorPlanObject } from '../../types'

const HANDLE_SIZE = 8  // px at zoom=1 (scaled by 1/zoom)

interface Props {
  id: string
  zoom: number
}

export default function PlacedObject({ id, zoom }: Props) {
  const obj = useStore(s => s.floorPlan.objects.find(o => o.id === id) ?? null)
  const selectedId = useStore(s => s.floorPlanSelectedId)
  const updateFloorPlanObject = useStore(s => s.updateFloorPlanObject)
  const selectFloorPlanObject = useStore(s => s.selectFloorPlanObject)

  if (!obj) return null

  const isSelected = selectedId === id
  const { x, y, w, h, rotation, color, label } = obj
  const cx = x + w / 2
  const cy = y + h / 2
  const fontSize = Math.max(12 / zoom, 8)
  const handleR = HANDLE_SIZE / zoom
  const dragAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => { dragAbortRef.current?.abort() }
  }, [])

  function handlePointerDown(e: React.PointerEvent<SVGGElement>) {
    e.stopPropagation()
    selectFloorPlanObject(id)
    const startX = e.clientX
    const startY = e.clientY
    const origX = x
    const origY = y
    const svgScale = getSvgScale(e.currentTarget)

    dragAbortRef.current?.abort()
    const controller = new AbortController()
    dragAbortRef.current = controller

    function onMove_(ev: PointerEvent) {
      const dx = (ev.clientX - startX) / svgScale / zoom
      const dy = (ev.clientY - startY) / svgScale / zoom
      updateFloorPlanObject(id, { x: origX + dx, y: origY + dy })
    }

    window.addEventListener('pointermove', onMove_, { signal: controller.signal })
    window.addEventListener('pointerup', () => controller.abort(), { signal: controller.signal })
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }

  function makeResizeHandler(handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w') {
    return (e: React.PointerEvent<SVGCircleElement>) => {
      e.stopPropagation()
      selectFloorPlanObject(id)
      const startX = e.clientX
      const startY = e.clientY
      const origX = x
      const origY = y
      const origW = w
      const origH = h
      const svgScale = getSvgScale(e.currentTarget)

      dragAbortRef.current?.abort()
      const controller = new AbortController()
      dragAbortRef.current = controller

      function onMove_(ev: PointerEvent) {
        const rawDx = (ev.clientX - startX) / svgScale / zoom
        const rawDy = (ev.clientY - startY) / svgScale / zoom

        // Transform delta into object's local coordinate space
        const rad = (rotation * Math.PI) / 180
        const cos = Math.cos(-rad)
        const sin = Math.sin(-rad)
        const dx = rawDx * cos - rawDy * sin
        const dy = rawDx * sin + rawDy * cos

        const nextW = Math.max(50, handle.includes('w') ? origW - dx : handle.includes('e') ? origW + dx : origW)
        const nextH = Math.max(50, handle.includes('n') ? origH - dy : handle.includes('s') ? origH + dy : origH)

        updateFloorPlanObject(id, {
          x: handle.includes('w') ? origX + (origW - nextW) : origX,
          y: handle.includes('n') ? origY + (origH - nextH) : origY,
          w: nextW,
          h: nextH,
        })
      }

      window.addEventListener('pointermove', onMove_, { signal: controller.signal })
      window.addEventListener('pointerup', () => controller.abort(), { signal: controller.signal })
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    }
  }

  const handles = [
    { key: 'nw', cx: x,       cy: y,       cursor: 'nw-resize' },
    { key: 'n',  cx: x + w/2, cy: y,       cursor: 'n-resize'  },
    { key: 'ne', cx: x + w,   cy: y,       cursor: 'ne-resize' },
    { key: 'e',  cx: x + w,   cy: y + h/2, cursor: 'e-resize'  },
    { key: 'se', cx: x + w,   cy: y + h,   cursor: 'se-resize' },
    { key: 's',  cx: x + w/2, cy: y + h,   cursor: 's-resize'  },
    { key: 'sw', cx: x,       cy: y + h,   cursor: 'sw-resize' },
    { key: 'w',  cx: x,       cy: y + h/2, cursor: 'w-resize'  },
  ] as const

  return (
    <g
      data-testid={`placed-object-${id}`}
      transform={`rotate(${rotation}, ${cx}, ${cy})`}
      style={{ cursor: 'move' }}
      onPointerDown={handlePointerDown}
      onClick={e => e.stopPropagation()}
    >
      <rect
        x={x} y={y} width={w} height={h}
        fill={color + '33'}
        stroke={isSelected ? '#f5f5f7' : color}
        strokeWidth={isSelected ? 2 / zoom : 1 / zoom}
        rx={4 / zoom}
      />
      {renderIcon(obj)}
      <text
        x={cx} y={cy}
        textAnchor="middle" dominantBaseline="middle"
        fontSize={fontSize}
        fill={color}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {label}
      </text>
      {isSelected && handles.map(h => (
        <circle
          key={h.key}
          data-testid={`resize-handle-${id}-${h.key}`}
          cx={h.cx} cy={h.cy} r={handleR}
          fill="#f5f5f7" stroke={color} strokeWidth={1 / zoom}
          style={{ cursor: h.cursor }}
          onPointerDown={makeResizeHandler(h.key)}
        />
      ))}
    </g>
  )
}

function renderIcon(obj: FloorPlanObject) {
  const { x, y, w, h, color } = obj
  const sw = 1.5
  const alpha = '80'

  switch (obj.type) {
    case 'bed-single':
    case 'bed-double':
    case 'bed-queen':
    case 'bed-king':
      return <rect x={x + w*0.05} y={y + h*0.03} width={w*0.9} height={h*0.17}
        fill="none" stroke={color + alpha} strokeWidth={sw} rx={sw} />

    case 'sofa-2':
    case 'sofa-3':
      return <g fill="none" stroke={color + alpha} strokeWidth={sw}>
        <rect x={x + w*0.12} y={y + h*0.05} width={w*0.76} height={h*0.3} rx={sw} />
        <rect x={x + w*0.02} y={y + h*0.05} width={w*0.1}  height={h*0.9} rx={sw} />
        <rect x={x + w*0.88} y={y + h*0.05} width={w*0.1}  height={h*0.9} rx={sw} />
      </g>

    case 'armchair':
      return <g fill="none" stroke={color + alpha} strokeWidth={sw}>
        <rect x={x + w*0.15} y={y + h*0.1} width={w*0.7} height={h*0.3} rx={sw} />
        <rect x={x + w*0.02} y={y + h*0.1} width={w*0.13} height={h*0.85} rx={sw} />
        <rect x={x + w*0.85} y={y + h*0.1} width={w*0.13} height={h*0.85} rx={sw} />
      </g>

    case 'toilet':
      return <g fill="none" stroke={color + alpha} strokeWidth={sw}>
        <rect x={x + w*0.05} y={y + h*0.03} width={w*0.9} height={h*0.25} rx={sw} />
        <ellipse cx={x + w/2} cy={y + h*0.65} rx={w*0.42} ry={h*0.3} />
      </g>

    case 'basin':
      return <ellipse cx={x + w/2} cy={y + h/2} rx={w*0.38} ry={h*0.38}
        fill="none" stroke={color + alpha} strokeWidth={sw} />

    case 'bathtub':
      return <g fill="none" stroke={color + alpha} strokeWidth={sw}>
        <rect x={x + w*0.05} y={y + h*0.05} width={w*0.9} height={h*0.9} rx={w*0.08} />
        <circle cx={x + w/2} cy={y + h*0.82} r={w*0.08} />
      </g>

    case 'shower':
      return <g fill="none" stroke={color + alpha} strokeWidth={sw}>
        <rect x={x + w*0.05} y={y + h*0.05} width={w*0.9} height={h*0.9} rx={sw} />
        <circle cx={x + w/2} cy={y + h/2} r={w*0.08} />
      </g>

    case 'washer':
    case 'dryer':
      return <circle cx={x + w/2} cy={y + h/2} r={w*0.35}
        fill="none" stroke={color + alpha} strokeWidth={sw} />

    case 'ceiling-fan':
      return <g fill={color + alpha} stroke="none">
        <ellipse cx={x + w/2} cy={y + h*0.3}  rx={w*0.08} ry={h*0.18} />
        <ellipse cx={x + w/2} cy={y + h*0.7}  rx={w*0.08} ry={h*0.18} />
        <ellipse cx={x + w*0.3}  cy={y + h/2} rx={w*0.18} ry={h*0.08} />
        <ellipse cx={x + w*0.7}  cy={y + h/2} rx={w*0.18} ry={h*0.08} />
        <circle cx={x + w/2} cy={y + h/2} r={w*0.05} fill={color} />
      </g>

    case 'light':
      return <circle cx={x + w/2} cy={y + h/2} r={w*0.38}
        fill="none" stroke={color + alpha} strokeWidth={sw} />

    case 'tv':
      return <line x1={x + w*0.1} y1={y + h/2} x2={x + w*0.9} y2={y + h/2}
        stroke={color + alpha} strokeWidth={sw} />

    case 'fridge':
      return <line x1={x + w/2} y1={y + h*0.05} x2={x + w/2} y2={y + h*0.95}
        stroke={color + alpha} strokeWidth={sw} />

    default:
      return null
  }
}

function getSvgScale(el: Element): number {
  const svg = el.closest('svg')
  if (!svg) return 1
  const rect = svg.getBoundingClientRect()
  const vb = svg.getAttribute('viewBox')?.split(' ').map(Number)
  if (!vb) return 1
  return Math.min(rect.width / vb[2], rect.height / vb[3])
}
