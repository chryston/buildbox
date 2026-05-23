import { useEffect, useRef, useState } from 'react'
import type { Design, GlobalSettings, Unit } from '../../types'
import { fromMm, toMm } from '../../engine/unitConversion'
import ExportModal from './ExportModal'
import ImportModal from './ImportModal'
import UndoRedo from './UndoRedo'
import { importWorkspace } from '../../utils/workspaceIO'

interface Props {
  settings: GlobalSettings
  onSettingsChange: (patch: Partial<GlobalSettings>) => void
  onExport?: () => void
  canUndo?: boolean
  onUndo?: () => void
  canRedo?: boolean
  onRedo?: () => void
  projects?: Design[]
  activeProjectId?: string | null
  onImportWorkspace?: (incoming: { projects: Design[]; activeProjectId: string | null }, mode: 'replace' | 'merge') => void
}

const UNITS: Unit[] = ['mm', 'cm', 'in']

function roundDisplay(mm: number, unit: Unit): number {
  const value = fromMm(mm, unit)
  if (unit === 'mm') return Math.round(value)
  if (unit === 'cm') return parseFloat(value.toFixed(1))
  return parseFloat(value.toFixed(4))
}

interface NumFieldProps {
  label: string
  settingsKey: keyof GlobalSettings
  htmlFor: string
  settings: GlobalSettings
  onSettingsChange: (patch: Partial<GlobalSettings>) => void
}

function NumField({ label, settingsKey, htmlFor, settings, onSettingsChange }: NumFieldProps) {
  const unit = settings.unit
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

export default function Toolbar({
  settings,
  onSettingsChange,
  onExport,
  canUndo = false,
  onUndo,
  canRedo = false,
  onRedo,
  projects = [],
  activeProjectId = null,
  onImportWorkspace,
}: Props) {
  const [showExport, setShowExport] = useState(false)
  const [importState, setImportState] = useState<{
    incoming: { projects: Design[]; activeProjectId: string | null }
    error?: string
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const result = importWorkspace(ev.target?.result as string)
        setImportState({ incoming: { projects: result.projects, activeProjectId: result.activeProjectId } })
      } catch {
        setImportState({ incoming: { projects: [], activeProjectId: null }, error: 'Invalid file — could not import workspace.' })
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <>
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

      <NumField label="Height" settingsKey="height" htmlFor="tb-height" settings={settings} onSettingsChange={onSettingsChange} />
      <NumField label="Width" settingsKey="width" htmlFor="tb-width" settings={settings} onSettingsChange={onSettingsChange} />
      <NumField label="Depth" settingsKey="depth" htmlFor="tb-depth" settings={settings} onSettingsChange={onSettingsChange} />
      <NumField label="Thickness" settingsKey="thickness" htmlFor="tb-thickness" settings={settings} onSettingsChange={onSettingsChange} />

      <div className="ml-auto flex items-center gap-2">
        <UndoRedo canUndo={canUndo} onUndo={onUndo ?? (() => {})} canRedo={canRedo} onRedo={onRedo ?? (() => {})} />
        <button
          onClick={() => setShowExport(true)}
          className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/80 hover:text-white"
          aria-label="Export workspace"
        >
          ↓ Export
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".buildbox.json"
          className="hidden"
          onChange={handleImportFile}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/80 hover:text-white"
          aria-label="Import workspace"
        >
          ↑ Import
        </button>
        <button
          onClick={onExport}
          className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/80"
        >
          Export SVG
        </button>
      </div>
    </header>
    {showExport && (
      <ExportModal
        projects={projects}
        activeProjectId={activeProjectId}
        onClose={() => setShowExport(false)}
      />
    )}
    {importState && (
      <ImportModal
        incoming={importState.incoming}
        onConfirm={(mode) => {
          if (importState.incoming.projects.length > 0) {
            onImportWorkspace?.(importState.incoming, mode)
          }
          setImportState(null)
        }}
        onClose={() => setImportState(null)}
        error={importState.error}
      />
    )}
    </>
  )
}
