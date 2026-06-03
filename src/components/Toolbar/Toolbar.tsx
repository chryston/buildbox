import { useRef, useState } from 'react'
import type { Design, GlobalSettings, Unit } from '../../types'
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
    <header className="flex flex-wrap items-center gap-4 border-b border-divider bg-panel px-4 py-2">
      <span className="mr-2 font-bold text-accent">BuildBox</span>

      <div className="flex overflow-hidden rounded border border-divider">
        {UNITS.map((nextUnit) => (
          <button
            key={nextUnit}
            onClick={() => onSettingsChange({ unit: nextUnit })}
            className={`px-2 py-1 text-sm ${
              settings.unit === nextUnit ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {nextUnit}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <UndoRedo canUndo={canUndo} onUndo={onUndo ?? (() => {})} canRedo={canRedo} onRedo={onRedo ?? (() => {})} />
        <button
          onClick={() => setShowExport(true)}
          className="rounded border border-divider px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
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
          className="rounded border border-divider px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
          aria-label="Import workspace"
        >
          ↑ Import
        </button>
        <button
          onClick={onExport}
          className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
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
