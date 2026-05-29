import { useState, useEffect } from 'react'
import type { Annotation, AnnotationType } from '../../types'
import { nanoid } from 'nanoid'

interface Props {
  annotations: Annotation[]
  activeType: AnnotationType | null
  zoom: number
  onAddAnnotation: (ann: Annotation) => void
}

export default function AnnotationLayer({ annotations, activeType, zoom, onAddAnnotation }: Props) {
  const [inProgressPoints, setInProgressPoints] = useState<{ x: number; y: number }[]>([])
  const [previewPoint, setPreviewPoint] = useState<{ x: number; y: number } | null>(null)
  const [tileStart, setTileStart] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setInProgressPoints([])
    setPreviewPoint(null)
    setTileStart(null)
  }, [activeType])

  function svgPoint(e: React.MouseEvent<SVGGElement>): { x: number; y: number } {
    const svg = e.currentTarget.ownerSVGElement as SVGSVGElement
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = e.currentTarget.getScreenCTM()
    if (!ctm) return { x: e.clientX, y: e.clientY }
    const xf = pt.matrixTransform(ctm.inverse())
    return { x: xf.x, y: xf.y }
  }

  function handleClick(e: React.MouseEvent<SVGGElement>) {
    if (!activeType) return
    if (e.detail === 2) return  // handled by handleDblClick
    e.stopPropagation()
    const pt = svgPoint(e)

    if (activeType === 'wall-hack') {
      setInProgressPoints(prev => [...prev, pt])
    } else if (activeType === 'tile-zone') {
      if (!tileStart) {
        setTileStart(pt)
      } else {
        commitTileZone(tileStart, pt)
        setTileStart(null)
        setPreviewPoint(null)
      }
    }
  }

  function handleDblClick(e: React.MouseEvent<SVGGElement>) {
    if (activeType !== 'wall-hack') return
    // The first click of the dblclick sequence (detail:1) slips past the handleClick guard
    // and adds a spurious point — strip it off before committing.
    const pts = inProgressPoints.slice(0, -1)
    if (pts.length < 2) return
    e.stopPropagation()
    commitWallHack(pts)
    setInProgressPoints([])
    setPreviewPoint(null)
  }

  function handleMouseMove(e: React.MouseEvent<SVGGElement>) {
    if (!activeType) return
    setPreviewPoint(svgPoint(e))
  }

  function commitWallHack(points: { x: number; y: number }[]) {
    onAddAnnotation({ id: nanoid(), type: 'wall-hack', points })
  }

  function commitTileZone(a: { x: number; y: number }, b: { x: number; y: number }) {
    const left = Math.min(a.x, b.x)
    const right = Math.max(a.x, b.x)
    const top = Math.min(a.y, b.y)
    const bottom = Math.max(a.y, b.y)

    if (right - left < 1 || bottom - top < 1) return

    onAddAnnotation({
      id: nanoid(), type: 'tile-zone',
      points: [
        { x: left, y: top },
        { x: right, y: bottom },
      ],
    })
  }

  const sw = 3 / zoom

  return (
    <g
      data-layer="annotations"
      onClick={handleClick}
      onDoubleClick={handleDblClick}
      onMouseMove={handleMouseMove}
      style={{ cursor: activeType ? 'crosshair' : 'default' }}
    >
      {annotations.map(ann => {
        if (ann.type === 'wall-hack') {
          const pts = ann.points.map(p => `${p.x},${p.y}`).join(' ')
          return (
            <polyline
              key={ann.id}
              points={pts}
              fill="none"
              stroke="#ef4444"
              strokeWidth={sw}
              strokeDasharray={`${8/zoom},${4/zoom}`}
            />
          )
        }
        if (ann.points.length < 2) return null
        const [tl, br] = ann.points
        return (
          <rect
            key={ann.id}
            x={tl.x} y={tl.y}
            width={br.x - tl.x} height={br.y - tl.y}
            fill="rgba(59,130,246,0.2)"
            stroke="#3b82f6"
            strokeWidth={sw}
            strokeDasharray={`${6/zoom},${3/zoom}`}
          />
        )
      })}

      {activeType === 'wall-hack' && inProgressPoints.length > 0 && previewPoint && (
        <polyline
          points={[...inProgressPoints, previewPoint].map(p => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke="#ef4444" strokeWidth={sw} strokeDasharray={`${4/zoom},${4/zoom}`}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {activeType === 'tile-zone' && tileStart && previewPoint && (
        <rect
          x={Math.min(tileStart.x, previewPoint.x)}
          y={Math.min(tileStart.y, previewPoint.y)}
          width={Math.abs(previewPoint.x - tileStart.x)}
          height={Math.abs(previewPoint.y - tileStart.y)}
          fill="rgba(59,130,246,0.1)"
          stroke="#3b82f6"
          strokeWidth={sw}
          strokeDasharray={`${4/zoom},${4/zoom}`}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  )
}
