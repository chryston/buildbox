import { useEffect, useState } from 'react'
import type { GlobalSettings, Unit } from '../../types'
import { fromMm, toMm } from '../../engine/unitConversion'
import UndoRedo from './UndoRedo'

interface Props {
  settings: GlobalSettings
  onSettingsChange: (patch: Partial<GlobalSettings>) => void
  onExport?: () => void
  canUndo?: boolean
  onUndo?: () => void
  canRedo?: boolean
  onRedo?: () => void
}

const UNITS: Unit[] = ['mm', 'cm', 'in']

function roundDisplay(mm: number, unit: Unit): number {
  const value = fromMm(mm, unit)
  if (unit === 'mm') return Math.round(value)
  if (unit === 'cm') return parseFloat(value.toFixed(1))
  return parseFloat(value.toFixed(4))
}

export default function Toolbar({
  settings,
  onSettingsChange,
  onExport,
  canUndo = false,
  onUndo,
  canRedo = false,
  onRedo,
}: Props) {
  const unit = settings.unit

  function NumField({ label, settingsKey, htmlFor }: { label: string; settingsKey: keyof GlobalSettings; htmlFor: string }) {
    const displayValue = String(roundDisplay(settings[settingsKey] as number, unit))
    const [raw, setRaw] = useState(displayValue)

    useEffect(() => {
      setRaw(displayValue)
    }, [displayValue])

    return (
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-sm text-white/80">
        {label}
        <input
          id={htmlFor}
          type="number"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={(e) => {
            const nextValue = parseFloat(e.target.value)
            if (!Number.isNaN(nextValue) && nextValue > 0) {
              onSettingsChange({ [settingsKey]: toMm(nextValue, unit) } as Partial<GlobalSettings>)
              return
            }

            setRaw(displayValue)
          }}
          className="w-20 rounded border border-white/20 bg-surface px-1 py-0.5 text-right text-white"
        />
      </label>
    )
  }

  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-white/10 bg-panel px-4 py-2">
      <span className="mr-2 font-bold text-accent">BuildBox</span>

      <div className="flex overflow-hidden rounded border border-white/20">
        {UNITS.map((nextUnit) => (
          <button
            key={nextUnit}
            onClick={() => onSettingsChange({ unit: nextUnit })}
            className={`px-2 py-1 text-sm ${
              settings.unit === nextUnit ? 'bg-accent text-white' : 'text-white/60 hover:text-white'
            }`}
          >
            {nextUnit}
          </button>
        ))}
      </div>

      <NumField label="Height" settingsKey="height" htmlFor="tb-height" />
      <NumField label="Width" settingsKey="width" htmlFor="tb-width" />
      <NumField label="Depth" settingsKey="depth" htmlFor="tb-depth" />
      <NumField label="Thickness" settingsKey="thickness" htmlFor="tb-thickness" />

      <div className="ml-auto flex items-center gap-2">
        <UndoRedo canUndo={canUndo} onUndo={onUndo ?? (() => {})} canRedo={canRedo} onRedo={onRedo ?? (() => {})} />
        <button
          onClick={onExport}
          className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/80"
        >
          Export SVG
        </button>
      </div>
    </header>
  )
}
