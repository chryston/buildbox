export type Module = 'cabinet' | 'floorplan'

interface Props {
  activeModule: Module
  onChange: (module: Module) => void
}

export default function ModuleSwitcher({ activeModule, onChange }: Props) {
  return (
    <div className="flex items-center gap-1 border-b border-divider bg-panel px-4 py-1.5">
      <div className="flex overflow-hidden rounded-md border border-divider">
        <button
          type="button"
          onClick={() => onChange('cabinet')}
          className={`px-4 py-1 text-sm font-medium transition-colors ${
            activeModule === 'cabinet'
              ? 'bg-accent text-white'
              : 'bg-panel text-text-muted hover:text-text-primary'
          }`}
        >
          Cabinet
        </button>
        <button
          type="button"
          onClick={() => onChange('floorplan')}
          className={`px-4 py-1 text-sm font-medium transition-colors ${
            activeModule === 'floorplan'
              ? 'bg-accent text-white'
              : 'bg-panel text-text-muted hover:text-text-primary'
          }`}
        >
          Floor Plan
        </button>
      </div>
    </div>
  )
}
