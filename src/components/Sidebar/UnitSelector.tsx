import { useState } from 'react'
import type { CabinetUnit } from '../../types'

interface Props {
  units: CabinetUnit[]
  activeUnitId: string | null
  onSelect: (unitId: string) => void
  onAdd: () => void
  onRemove: (unitId: string) => void
  onRename: (unitId: string, label: string) => void
}

export default function UnitSelector({ units, activeUnitId, onSelect, onAdd, onRemove, onRename }: Props) {
  const [editLabels, setEditLabels] = useState<Record<string, string>>({})

  function labelFor(unitId: string, fallback: string) {
    return editLabels[unitId] ?? fallback
  }

  function handleBlur(unitId: string, original: string) {
    const current = editLabels[unitId]
    if (current !== undefined && current !== original) {
      onRename(unitId, current)
    }
    setEditLabels(prev => { const n = { ...prev }; delete n[unitId]; return n })
  }

  return (
    <div className="flex flex-col gap-1 p-2 border-b border-border">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Units</span>
        <button
          onClick={onAdd}
          aria-label="Add unit"
          className="text-xs px-2 py-0.5 rounded bg-accent text-white hover:bg-accent/80"
        >
          + Add unit
        </button>
      </div>
      {units.map(unit => (
        <div
          key={unit.id}
          className={`flex items-center gap-1 rounded px-1 py-0.5 cursor-pointer ${unit.id === activeUnitId ? 'bg-accent/20 ring-1 ring-accent' : 'hover:bg-surface-elevated'}`}
          onClick={() => onSelect(unit.id)}
        >
          <input
            className="flex-1 bg-transparent text-sm text-text outline-none"
            value={labelFor(unit.id, unit.label)}
            onClick={e => { e.stopPropagation(); onSelect(unit.id) }}
            onChange={e => setEditLabels(prev => ({ ...prev, [unit.id]: e.target.value }))}
            onBlur={() => handleBlur(unit.id, unit.label)}
          />
          {units.length >= 2 && (
            <button
              aria-label={`Remove ${unit.label}`}
              onClick={e => { e.stopPropagation(); onRemove(unit.id) }}
              className="text-xs text-red-400 hover:text-red-600 px-1"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
