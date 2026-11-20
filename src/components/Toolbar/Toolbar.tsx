import type { GlobalSettings, Unit } from '../../domain'
import type { SaveStatusText } from '../../ui/legacy/bindings'
import UndoRedo from './UndoRedo'

interface Props {
  settings: GlobalSettings
  onSettingsChange: (patch: Partial<GlobalSettings>) => void
  canUndo?: boolean
  onUndo?: () => void
  canRedo?: boolean
  onRedo?: () => void
  /** Where the document is saved, when there is a save to report (#14, #49). */
  saveStatus?: SaveStatusText | null
  /**
   * What the red status does when clicked (#51 §2, criterion 10).
   *
   * `Save failed` is the app saying *your newest work is not stored*, and the one answer to that
   * is the dialog with the three ways out — so the words are a button wherever there is a dialog
   * to open. Absent means there is no dialog to open, and the status stays plain text.
   */
  onSaveStatusClick?: () => void
}

const UNITS: Unit[] = ['mm', 'cm', 'in']

export default function Toolbar({
  settings,
  onSettingsChange,
  canUndo = false,
  onUndo,
  canRedo = false,
  onRedo,
  saveStatus = null,
  onSaveStatusClick,
}: Props) {
  return (
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

      {/* The row keeps its 34 px minimum height: the two workspace buttons that used to sit here
          added 2 px with their ↓/↑ glyphs (fallback-font ascent: 34 px against the 32 px the
          drawing-export button measured), and a shorter row would lift every view below it two
          pixels off the S0 baselines (#53 criterion 12). The height stays now that both are gone,
          because every view below was laid out against it. */}
      <div className="ml-auto flex min-h-[34px] items-center gap-2">
        {saveStatus && (
          <span
            className={`text-sm ${saveStatus.failed ? 'text-red-400' : 'text-text-muted'}`}
            role="status"
          >
            {saveStatus.failed && onSaveStatusClick ? (
              <button type="button" className="cursor-pointer hover:underline" onClick={onSaveStatusClick}>
                {saveStatus.text}
              </button>
            ) : (
              saveStatus.text
            )}
          </span>
        )}
        <UndoRedo canUndo={canUndo} onUndo={onUndo ?? (() => {})} canRedo={canRedo} onRedo={onRedo ?? (() => {})} />
      </div>
    </header>
  )
}
