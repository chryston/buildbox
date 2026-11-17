import { useRef, useState } from 'react'
import type { Design } from '../../types'
import type { GlobalSettings, Unit } from '../../domain'
import { readLegacyWorkspaceFile } from '../../package'
import type { ValidationProblem } from '../../lib'
import type { LegacyWorkspace, SaveStatusText } from '../../ui/legacy/bindings'
import ExportModal from './ExportModal'
import ImportModal from './ImportModal'
import UndoRedo from './UndoRedo'

interface Props {
  settings: GlobalSettings
  onSettingsChange: (patch: Partial<GlobalSettings>) => void
  onExport?: () => void
  canUndo?: boolean
  onUndo?: () => void
  canRedo?: boolean
  onRedo?: () => void
  /** The workspace JSON this app can export and import; absent means neither control (#49). */
  workspace?: LegacyWorkspace
  /** Where the document is saved, when there is a save to report (#14, #49). */
  saveStatus?: SaveStatusText | null
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
  workspace,
  saveStatus = null,
}: Props) {
  const [showExport, setShowExport] = useState(false)
  const [importState, setImportState] = useState<
    | { incoming: { projects: Design[]; activeProjectId: string | null } }
    | { problems: ValidationProblem[] }
    | null
  >(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      // Nothing reaches the store until the whole file has been read and validated, and
      // the store applies what is left in one set() (#40 §2).
      const result = readLegacyWorkspaceFile(ev.target?.result as string, () => crypto.randomUUID())
      setImportState(result.ok
        ? { incoming: { projects: result.file.projects, activeProjectId: result.file.activeProjectId } }
        : { problems: result.problems })
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
        {saveStatus && (
          <span
            className={`text-sm ${saveStatus.failed ? 'text-red-400' : 'text-text-muted'}`}
            role="status"
          >
            {saveStatus.text}
          </span>
        )}
        <UndoRedo canUndo={canUndo} onUndo={onUndo ?? (() => {})} canRedo={canRedo} onRedo={onRedo ?? (() => {})} />
        {workspace && (
          <>
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
          </>
        )}
        <button
          onClick={onExport}
          className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
        >
          Export SVG
        </button>
      </div>
    </header>
    {showExport && workspace && (
      <ExportModal
        projects={workspace.projects}
        activeProjectId={workspace.activeProjectId}
        onClose={() => setShowExport(false)}
      />
    )}
    {importState && ('problems' in importState ? (
      <ImportModal
        problems={importState.problems}
        onClose={() => setImportState(null)}
      />
    ) : (
      <ImportModal
        incoming={importState.incoming}
        onConfirm={(mode) => {
          if (importState.incoming.projects.length > 0) {
            workspace?.onImport(importState.incoming, mode)
          }
          setImportState(null)
        }}
        onClose={() => setImportState(null)}
      />
    ))}
    </>
  )
}
