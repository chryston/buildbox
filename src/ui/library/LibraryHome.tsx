/**
 * The Project Library home (#50 §2; the archive's `VariantA` at `8787ba4`).
 *
 * This is the whole flag-on landing surface: the header, the hero, the backup reminder, the grid
 * of cards and every dialog a card can open. It is the first production surface of #28, and the
 * rule it is written to is #42 §2 — the component reads a snapshot and dispatches. It never
 * touches IndexedDB, never encodes a Backup, never decides whether a Project is due by
 * reimplementing the rule the `session` module already owns.
 *
 * Three things it holds, and nothing else: which card is selected, which dialog is open, and the
 * last toast. Everything else is a prop, which is what makes the criteria testable by rendering
 * this one component against a fake store rather than by driving a browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { backupFileName, isBackupDue } from '../../session'
import { STRINGS } from '../strings'
import { BackupDialog } from './BackupDialog'
import { CollisionDialog } from './CollisionDialog'
import { ProjectCard } from './ProjectCard'
import { RenameDialog } from './RenameDialog'
import { RestoreProblemDialog } from './RestoreProblemDialog'
import { Toast } from './Toast'
import type { ToastMessage } from './Toast'
import type {
  BackupFailure,
  BackupWritten,
  LibraryRecord,
  LibraryStore,
  RestoreApplied,
  RestoreCommitTarget,
  RestoreProblem,
  RestoreStaged,
  Result,
  SaveState,
  SessionError,
} from '../../session'
import type { ClockPort } from '../../session'
import type { ReactNode } from 'react'

/**
 * Everything the Library needs from outside the module boundary.
 *
 * `ui` may not import `persistence` or `package` (#42 §2), so the flows that touch them arrive
 * as functions `app` has already closed over its ports with. The types they speak are all
 * `session`'s, which `ui` is allowed to name.
 */
export interface LibraryServices {
  library: LibraryStore
  /** The only source of time in the tree; the screenshot comparison pins it. */
  clock: ClockPort
  /** Recovery Point counts by Project id — `persistence`'s numbers, handed over as data. */
  recoveryCounts(): Promise<Map<string, number>>
  /** A thumbnail for the Project's Plan Image, or `null` when it has none or is still reading. */
  planImageUrl(sha256: string | null): string | null
  /** The size a Backup of this Project would come to, in bytes. */
  backupEstimate(id: string): Promise<number>
  /** Encode and hand the bytes to the browser, then record that the download was initiated. */
  downloadBackup(id: string): Promise<Result<BackupWritten, BackupFailure | SessionError>>
  /**
   * The bytes behind a picked file.
   *
   * The picker is this component's; reading a disk file is not. `File.arrayBuffer` is missing
   * from jsdom, so a test that rendered the real surface would have to stub a browser method
   * rather than answer an interface — and #42 §2 says the browser belongs to `app`.
   */
  readBackupFile(file: File): Promise<Uint8Array>
  /** Steps 1–8 of a restore: read and check the file, write nothing. */
  stageRestore(bytes: Uint8Array): Promise<Result<RestoreStaged, RestoreProblem>>
  /** Steps 9–10 of a restore, once the user has answered any collision. */
  commitRestore(target: RestoreCommitTarget): Promise<Result<RestoreApplied, RestoreProblem>>
  /** Leave the Library for the Project's editor. */
  openProject(id: string): void
}

/** Which dialog is open. One at a time: no Library flow needs two at once. */
type Dialog =
  | { kind: 'none' }
  | { kind: 'backup'; id: string; name: string; fileName: string; sizeBytes: number }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'collision'; staged: RestoreStaged }
  | { kind: 'problem'; problem: RestoreProblem }

export interface LibraryHomeProps {
  services: LibraryServices
  /** The live save state of the Project whose session this tab holds, if any. */
  saveState?: SaveState | null
  /** The id of that Project, so its card is the one that shows `Saving…`. */
  saveStateFor?: string | null
}

export function LibraryHome({ services, saveState = null, saveStateFor = null }: LibraryHomeProps): ReactNode {
  const { library, clock } = services
  const subscribe = useCallback((listener: () => void) => library.subscribe(listener), [library])
  const getSnapshot = useCallback(() => library.getSnapshot(), [library])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [reminderDismissed, setReminderDismissed] = useState(false)
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const now = clock.now()
  const projects = useMemo(() => snapshot.projects.filter((record) => record.trashedAt === null), [snapshot.projects])
  const due = useMemo(() => projects.filter((record) => isBackupDue(record, now)), [projects, now])
  const dueIds = useMemo(() => new Set(due.map((record) => record.id)), [due])

  const refreshCounts = useCallback((): void => {
    void services.recoveryCounts().then(setCounts)
  }, [services])

  useEffect(() => {
    refreshCounts()
  }, [refreshCounts, snapshot.projects.length])

  // A card is selected so the grid always has a focus context; the first Project is as good a
  // guess as any, and a click moves it.
  useEffect(() => {
    setSelected((current) =>
      current !== null && projects.some((record) => record.id === current) ? current : (projects[0]?.id ?? null),
    )
  }, [projects])

  const openBackup = useCallback(
    async (record: LibraryRecord): Promise<void> => {
      const sizeBytes = await services.backupEstimate(record.id)
      setDialog({ kind: 'backup', id: record.id, name: record.name, fileName: backupFileName(record.name), sizeBytes })
    },
    [services],
  )

  const confirmBackup = useCallback(
    async (id: string, name: string): Promise<void> => {
      setBusy(true)
      const written = await services.downloadBackup(id)
      setBusy(false)
      setDialog({ kind: 'none' })
      if (written.ok) {
        setToast({ text: STRINGS.toastBackup(name) })
        refreshCounts()
      }
    },
    [services, refreshCounts],
  )

  const finishRestore = useCallback(
    async (target: RestoreCommitTarget): Promise<void> => {
      setBusy(true)
      const applied = await services.commitRestore(target)
      setBusy(false)
      setDialog({ kind: 'none' })
      if (!applied.ok) {
        setDialog({ kind: 'problem', problem: applied.error })
        return
      }
      refreshCounts()
      setToast({ text: toastFor(applied.value) })
    },
    [services, refreshCounts],
  )

  const restoreFrom = useCallback(
    async (file: File): Promise<void> => {
      const bytes = await services.readBackupFile(file)
      const staged = await services.stageRestore(bytes)
      if (!staged.ok) {
        setDialog({ kind: 'problem', problem: staged.error })
        return
      }
      if (staged.value.collision !== null) {
        setDialog({ kind: 'collision', staged: staged.value })
        return
      }
      await finishRestore({ staged: staged.value.staged, collision: null })
    },
    [services, finishRestore],
  )

  const trash = useCallback(
    async (record: LibraryRecord): Promise<void> => {
      const result = await library.trash(record.id)
      if (result.ok) setToast({ text: STRINGS.toastTrashed(record.name) })
    },
    [library],
  )

  const startProject = useCallback(
    async (name: string): Promise<void> => {
      const created = await library.createProject(name)
      if (created.ok) services.openProject(created.value)
    },
    [library, services],
  )

  return (
    <div className="bb-library">
      <header className="app-header">
        <button type="button" className="brand" onClick={() => setSelected(null)}>
          {STRINGS.brand} <span>{STRINGS.brandSuffix}</span>
        </button>
        <nav>
          <button type="button" className="nav-tab active">
            {STRINGS.navProjects}
          </button>
          {/* #52 owns Migration review and #51 the Trash. Both tabs are drawn in the finished
              position and marked unavailable, which is truer than hiding a destination this
              build does not have. */}
          <button type="button" className="nav-tab" aria-disabled="true">
            {STRINGS.navMigration}
          </button>
          <button type="button" className="nav-tab" aria-disabled="true">
            {STRINGS.navTrash}
          </button>
        </nav>
        <div className="header-status">
          <span className="status-dot" /> {STRINGS.headerStatus(due.length)}
        </div>
      </header>

      <main className="page visual-library">
        <section className="hero-row">
          <div>
            <p className="eyebrow">{STRINGS.eyebrowYourProperties}</p>
            <h1>{STRINGS.libraryHeading}</h1>
            <p className="lede">{STRINGS.libraryLede}</p>
          </div>
          <div className="hero-actions">
            <button type="button" className="button secondary" onClick={() => fileInput.current?.click()}>
              {STRINGS.restoreBackup}
            </button>
            <button type="button" className="button primary" onClick={() => void startProject(STRINGS.newProject)}>
              {STRINGS.newProject}
            </button>
          </div>
        </section>

        {due.length > 0 && !reminderDismissed && (
          <div className="backup-reminder">
            <span className="reminder-icon">↓</span>
            <div>
              <strong>{STRINGS.reminderTitle}</strong>
              <p>{STRINGS.reminderBody(due.length)}</p>
            </div>
            <button type="button" onClick={() => void openBackup(due[0])}>
              {STRINGS.downloadBackup}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={STRINGS.dismissBackupReminder}
              onClick={() => {
                setReminderDismissed(true)
              }}
            >
              ×
            </button>
          </div>
        )}

        <section className="project-grid">
          {projects.map((record) => (
            <ProjectCard
              key={record.id}
              record={record}
              saveState={record.id === saveStateFor ? saveState : null}
              now={now}
              due={dueIds.has(record.id)}
              selected={record.id === selected}
              recoveryPoints={counts.get(record.id) ?? 0}
              planImageUrl={services.planImageUrl(record.summary.previewAssetHash)}
              onSelect={() => {
                setSelected(record.id)
              }}
              onOpen={() => {
                services.openProject(record.id)
              }}
              onBackup={() => void openBackup(record)}
              onRename={() => {
                setDialog({ kind: 'rename', id: record.id, name: record.name })
              }}
              onDuplicate={() => void library.duplicate(record.id)}
              onTrash={() => void trash(record)}
            />
          ))}
          <button type="button" className="new-card" onClick={() => void startProject(STRINGS.newProject)}>
            <span>＋</span>
            <strong>{STRINGS.newProject}</strong>
            <small>{STRINGS.startAPropertyRecord}</small>
          </button>
        </section>
      </main>

      {/* The file picker is the browser's; `accept` names the one extension a Backup can have,
          and everything past this point is `package`'s judgement rather than this component's. */}
      <input
        ref={fileInput}
        type="file"
        accept=".buildbox"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file !== undefined) void restoreFrom(file)
          event.target.value = ''
        }}
      />

      {dialog.kind === 'backup' && (
        <BackupDialog
          fileName={dialog.fileName}
          sizeBytes={dialog.sizeBytes}
          busy={busy}
          onConfirm={() => void confirmBackup(dialog.id, dialog.name)}
          onClose={() => {
            setDialog({ kind: 'none' })
          }}
        />
      )}
      {dialog.kind === 'rename' && (
        <RenameDialog
          name={dialog.name}
          onSave={(name) => {
            setDialog({ kind: 'none' })
            void library.rename(dialog.id, name)
          }}
          onClose={() => {
            setDialog({ kind: 'none' })
          }}
        />
      )}
      {dialog.kind === 'collision' && (
        <CollisionDialog
          name={dialog.staged.staged.project.meta.name}
          copyName={dialog.staged.collision?.copyName ?? ''}
          onReplace={() => {
            const { staged, collision } = dialog.staged
            if (collision !== null) void finishRestore({ staged, collision, decision: 'replace' })
          }}
          onCopy={() => {
            const { staged, collision } = dialog.staged
            if (collision !== null) void finishRestore({ staged, collision, decision: 'copy' })
          }}
          onClose={() => {
            setDialog({ kind: 'none' })
          }}
        />
      )}
      {dialog.kind === 'problem' && (
        <RestoreProblemDialog
          problem={dialog.problem}
          onClose={() => {
            setDialog({ kind: 'none' })
          }}
        />
      )}

      {toast !== null && (
        <Toast
          message={toast}
          onDismiss={() => {
            setToast(null)
          }}
        />
      )}
    </div>
  )
}

/** The toast sentence that matches what a restore actually did (#50 §4 step 9). */
const toastFor = (applied: RestoreApplied): string =>
  applied.kind === 'replace'
    ? STRINGS.toastReplaced(applied.name)
    : applied.kind === 'copy'
      ? STRINGS.toastCopied(applied.name)
      : STRINGS.toastRestoredNew(applied.name)
