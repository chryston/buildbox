import { useEffect, useState } from 'react'
import type { FloorPlanObject } from '../../types'

interface Props {
  obj: FloorPlanObject | null
  onUpdate: (id: string, patch: Partial<FloorPlanObject>) => void
  onDelete: (id: string) => void
}

const COLORS = ['#6366f1', '#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#92400e', '#374151']

export default function FloorPlanProperties({ obj, onUpdate, onDelete }: Props) {
  if (!obj) {
    return (
      <aside className="flex w-44 flex-col border-l border-divider bg-panel p-3 text-xs text-text-muted">
        <p className="mt-4 text-center">Select an object to edit its properties</p>
      </aside>
    )
  }

  const [wVal, setWVal] = useState(String(Math.round(obj.w)))
  const [hVal, setHVal] = useState(String(Math.round(obj.h)))

  useEffect(() => { setWVal(String(Math.round(obj.w))) }, [obj.w])
  useEffect(() => { setHVal(String(Math.round(obj.h))) }, [obj.h])

  return (
    <aside className="flex w-44 flex-col overflow-y-auto border-l border-divider bg-panel p-3 text-xs">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-text-muted">Properties</div>
      <div className="mb-1 font-semibold text-text-primary">{obj.label}</div>

      <label className="mb-1 text-text-muted" htmlFor="fp-label">Label</label>
      <input
        id="fp-label"
        type="text"
        value={obj.label}
        onChange={e => onUpdate(obj.id, { label: e.target.value })}
        className="mb-3 rounded border border-divider bg-surface px-2 py-1 text-text-primary"
      />

      <label className="mb-1 text-text-muted" htmlFor="fp-width">Width (mm)</label>
      <input
        id="fp-width"
        type="number"
        min={10}
        value={wVal}
        onChange={e => setWVal(e.target.value)}
        onBlur={e => onUpdate(obj.id, { w: Math.max(10, Number(e.target.value)) })}
        className="mb-3 rounded border border-divider bg-surface px-2 py-1 text-text-primary"
      />

      <label className="mb-1 text-text-muted" htmlFor="fp-height">Depth (mm)</label>
      <input
        id="fp-height"
        type="number"
        min={10}
        value={hVal}
        onChange={e => setHVal(e.target.value)}
        onBlur={e => onUpdate(obj.id, { h: Math.max(10, Number(e.target.value)) })}
        className="mb-3 rounded border border-divider bg-surface px-2 py-1 text-text-primary"
      />

      <div className="mb-1 text-text-muted">Rotation: {obj.rotation}°</div>
      <button
        type="button"
        aria-label="Rotate 90°"
        onClick={() => onUpdate(obj.id, { rotation: ((obj.rotation + 90) % 360) as 0 | 90 | 180 | 270 })}
        className="mb-3 rounded border border-divider bg-surface px-2 py-1 text-text-primary hover:bg-surface-raised"
      >
        ↻ Rotate 90°
      </button>

      <div className="mb-2 text-text-muted">Color</div>
      <div className="mb-4 flex flex-wrap gap-1">
        {COLORS.map(c => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => onUpdate(obj.id, { color: c })}
            style={{ background: c }}
            className={`h-5 w-5 rounded-full border-2 ${obj.color === c ? 'border-text-primary' : 'border-transparent'}`}
          />
        ))}
      </div>

      <button
        type="button"
        aria-label="Delete object"
        onClick={() => onDelete(obj.id)}
        className="rounded bg-red-600 py-1 text-center text-white hover:bg-red-700"
      >
        🗑 Delete
      </button>
    </aside>
  )
}
