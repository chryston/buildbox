import type { RefObject } from 'react'
import type { GlobalSettings, Unit } from '../../types'
import { fromMm, toMm } from '../../engine/unitConversion'

interface Props {
  settings: GlobalSettings
  onSettingsChange: (patch: Partial<GlobalSettings>) => void
  svgRef?: RefObject<SVGSVGElement | null>
  designName?: string
}

const UNITS: Unit[] = ['mm', 'cm', 'in']

export default function Toolbar({ settings, onSettingsChange, svgRef, designName }: Props) {
  const unit = settings.unit

  function numField(label: string, key: keyof GlobalSettings, htmlFor: string) {
    const displayVal = fromMm(settings[key] as number, unit)

    return (
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-sm text-white/80">
        {label}
        <input
          id={htmlFor}
          type="number"
          value={displayVal}
          onChange={(e) => onSettingsChange({ [key]: toMm(Number(e.target.value), unit) } as Partial<GlobalSettings>)}
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

      {numField('Height', 'height', 'tb-height')}
      {numField('Width', 'width', 'tb-width')}
      {numField('Depth', 'depth', 'tb-depth')}
      {numField('Thickness', 'thickness', 'tb-thickness')}

      <button
        onClick={() => {
          if (svgRef?.current && designName) {
            console.log('Export SVG:', designName)
          }
        }}
        className="ml-auto rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/80"
      >
        Export SVG
      </button>
    </header>
  )
}
