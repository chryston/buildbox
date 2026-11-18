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
import { StorageNotice } from './Notices'
import { TrashView } from './TrashView'
import { Toast } from './Toast'
import type { ToastMessage } from './Toast'
import { PermanentDeleteDialog } from '../dialogs/PermanentDeleteDialog'
import { RecoveryDialog } from '../dialogs/RecoveryDialog'
import { SaveFailedDialog } from '../dialogs/SaveFailedDialog'
import type {
  BackupFailure,
  BackupWritten,
  GuardState,
  LibraryRecord,
  LibraryStore,
  RecoveryPointMeta,
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
  openProject(id: string): Promise<Result<void, SessionError>>
  /**
   * The Project's Recovery Points, newest first, without their data (#51 §1).
   *
   * `persistence` answers this and `ui` may not speak to it, so the metadata crosses as data —
   * the same arrangement as the Recovery Point count on the card.
   */
  recoveryPoints(id: string): Promise<RecoveryPointMeta[]>
  /**
   * Whether another tab holds this Project's Web Lock (#51 §5).
   *
   * Asking is not taking: `app` acquires with `ifAvailable` and releases at once. A Project this
   * tab has open is not "elsewhere", which is why the question cannot be answered from the lock
   * alone and belongs to whoever holds the registry.
   */
  lockedElsewhere(id: string): Promise<boolean>
  /**
   * The three answers the Save failed dialog offers, aimed at the session this tab holds.
   *
   * They answer to nothing: the session's own snapshot says whether the retry worked, and the
   * dialog reads that snapshot. A callback that reported success would be a second, likelier
   * wrong answer to the same question.
   */
  retrySave(): void
  downloadEmergencyBackup(): void
  discardUnsaved(): void
  /**
   * Return a Project to one of its Recovery Points, opening it first if this tab is not in it.
   *
   * The session writes the `pre-restore` Point for the state it is about to replace, so this is
   * the one Library action whose undo lives in `session` rather than in a dialog.
   */
  restoreRecoveryPoint(projectId: string, pointId: string): Promise<Result<void, SessionError>>
}

/** Which dialog is open. One at a time: no Library flow needs two at once. */
type Dialog =
  | { kind: 'none' }
  | { kind: 'backup'; id: string; name: string; fileName: string; sizeBytes: number }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'collision'; staged: RestoreStaged }
  | { kind: 'problem'; problem: RestoreProblem }
  /** Read and chosen here; restoring is the session's, in `app` (#51 §1). */
  | { kind: 'recovery'; id: string; name: string; points: RecoveryPointMeta[] }
  | { kind: 'delete'; id: string; name: string; record: LibraryRecord; recoveryPoints: number }
  /** Always about the session this tab holds, which is why it carries no id of its own. */
  | { kind: 'save-failed' }

/** Which of the Library's two surfaces is showing. Migration review is #52's. */
type Surface = 'projects' | 'trash'

export interface LibraryHomeProps {
  services: LibraryServices
  /** The live save state of the Project whose session this tab holds, if any. */
  saveState?: SaveState | null
  /** The id of that Project, so its card is the one that shows `Saving…`. */
  saveStateFor?: string | null
  /**
   * That session's guard (#51 §2).
   *
   * The refusal itself is the session's to make — `close`, `trash` and `purge` all answer
   * `'guarded'` on their own — but a click on the brand or on another Project's `Open` never
   * reaches a port, so the Library has to know to ask before it navigates.
   */
  guard?: GuardState | null
  /** True when this tab has no durable storage at all (#51 §6). */
  storageUnavailable?: boolean
}

export function LibraryHome({
  services,
  saveState = null,
  saveStateFor = null,
  guard = null,
  storageUnavailable = false,
}: LibraryHomeProps): ReactNode {
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
  const [surface, setSurface] = useState<Surface>('projects')
  const fileInput = useRef<HTMLInputElement>(null)
  const countsToken = useRef(0)

  const now = clock.now()
  const projects = useMemo(() => snapshot.projects.filter((record) => record.trashedAt === null), [snapshot.projects])
  const due = useMemo(() => projects.filter((record) => isBackupDue(record, now)), [projects, now])
  const dueIds = useMemo(() => new Set(due.map((record) => record.id)), [due])

  /**
   * The Project this tab is holding unsaved work on, or `null`.
   *
   * #51 §2's guarded set is every way of leaving that Project — another Project's `Open`, the
   * brand, a tab switch — plus Trash and Permanent deletion of it. The session refuses all of
   * them on its own; this is how a click that never reaches a port knows to stop.
   */
  const blockedId = guard?.blocked === true ? saveStateFor : null
  const failedReason = saveState !== null && saveState.kind === 'failed' ? saveState.reason : null

  const refreshCounts = useCallback((): void => {
    // A token rather than a bare `then`: two refreshes can be in flight when a Project is
    // restored (the list re-read and the count re-read both fire), and unmounting the Library
    // must drop a count that is on its way — setting state on a component that is gone is a
    // leak in the app, not a quirk of the test that noticed it.
    const token = ++countsToken.current
    void services.recoveryCounts().then((next) => {
      if (token === countsToken.current) setCounts(next)
    })
  }, [services])

  useEffect(
    () => () => {
      countsToken.current += 1
    },
    [],
  )

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
        // #51 §2: an import that would replace the Project this tab is holding unsaved is a
        // guarded action like any other, and the answer is the dialog that offers to keep the
        // work — not the restore-problem dialog, which has no way out that does.
        if (applied.error.kind === 'session' && applied.error.error === 'guarded') setDialog({ kind: 'save-failed' })
        else setDialog({ kind: 'problem', problem: applied.error })
        return
      }
      // The restore wrote a Project the snapshot has never seen. Every other action on this
      // screen goes through the library store, which re-reads itself; this one goes to `session`
      // and comes back with a Project already on disk, so the list is re-read here or the user
      // is told a Project exists and shown a grid without it.
      await library.refresh()
      refreshCounts()
      setToast({ text: toastFor(applied.value) })
    },
    [services, refreshCounts, library],
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

  /**
   * Refuse a Library action on a Project another tab is holding (#51 §5).
   *
   * The toast rather than a dialog, because nothing has gone wrong with the work: another tab has
   * it, and the answer is to go back to that tab. `Recover`, `Replace`, `Delete` and `Delete
   * permanently` all ask, and all leave the Library exactly as it was.
   */
  const lockedElsewhere = useCallback(
    async (record: LibraryRecord): Promise<boolean> => {
      if (await services.lockedElsewhere(record.id)) {
        setToast({ text: STRINGS.toastOpenElsewhere(record.name) })
        return true
      }
      return false
    },
    [services],
  )

  const open = useCallback(
    async (record: LibraryRecord): Promise<void> => {
      if (await lockedElsewhere(record)) return
      const opened = await services.openProject(record.id)
      if (!opened.ok && opened.error === 'guarded') setDialog({ kind: 'save-failed' })
    },
    [services, lockedElsewhere],
  )

  const trash = useCallback(
    async (record: LibraryRecord): Promise<void> => {
      if (await lockedElsewhere(record)) return
      const result = await library.trash(record.id)
      if (result.ok) setToast({ text: STRINGS.toastTrashed(record.name) })
      else if (result.error === 'guarded') setDialog({ kind: 'save-failed' })
    },
    [library, lockedElsewhere],
  )

  /**
   * Read this Project's Recovery Points and show them.
   *
   * Reading is the whole of it: opening the picker writes nothing, which is what lets `Cancel`
   * and `Esc` be enough. The count is read again rather than taken from the card so the number
   * is the one `persistence` has right now.
   */
  const recover = useCallback(
    async (record: LibraryRecord): Promise<void> => {
      if (await lockedElsewhere(record)) return
      setBusy(true)
      const points = await services.recoveryPoints(record.id)
      setBusy(false)
      setDialog({ kind: 'recovery', id: record.id, name: record.name, points })
    },
    [services, lockedElsewhere],
  )

  /** The last dialog before a Project and its Recovery Points are gone (#51 §3). */
  const deletePermanently = useCallback(
    async (record: LibraryRecord): Promise<void> => {
      if (await lockedElsewhere(record)) return
      setBusy(true)
      const points = await services.recoveryPoints(record.id)
      setBusy(false)
      setDialog({ kind: 'delete', id: record.id, name: record.name, record, recoveryPoints: points.length })
    },
    [services, lockedElsewhere],
  )

  /** Put a trashed Project back. Its id and revision come back with it (#51 §4). */
  const restoreFromTrash = useCallback(
    async (record: LibraryRecord): Promise<void> => {
      const restored = await library.restore(record.id)
      if (restored.ok) {
        setToast({ text: STRINGS.toastRestored(record.name) })
        refreshCounts()
      } else if (restored.error === 'guarded') setDialog({ kind: 'save-failed' })
    },
    [library, refreshCounts],
  )

  const purge = useCallback(
    async (record: LibraryRecord): Promise<void> => {
      setDialog({ kind: 'none' })
      const purged = await library.purge(record.id)
      if (purged.ok) setToast({ text: STRINGS.toastPurged(record.name) })
      else if (purged.error === 'guarded') setDialog({ kind: 'save-failed' })
    },
    [library],
  )

  /**
   * Return a Project to a Recovery Point, opening it first if this tab is not already in it.
   *
   * The session writes the `pre-restore` Point for the state about to be replaced before it
   * replaces it, so this is the one Library action that cannot be undone by accident — which is
   * why it goes through the session rather than writing the record here.
   */
  const restorePoint = useCallback(
    async (projectId: string, pointId: string): Promise<void> => {
      setDialog({ kind: 'none' })
      setBusy(true)
      const restored = await services.restoreRecoveryPoint(projectId, pointId)
      setBusy(false)
      if (restored.ok) {
        await library.refresh()
        refreshCounts()
        setToast({ text: STRINGS.toastRecoveryRestored })
      } else if (restored.error === 'guarded') setDialog({ kind: 'save-failed' })
    },
    [services, library, refreshCounts],
  )

  /**
   * The brand and the two nav tabs all leave the Project this tab may be holding (#51 §2).
   *
   * One rule for all three, because the guard is about the work rather than the destination: a
   * tab switch is a close, and a close with unsaved changes is the Save failed dialog.
   */
  const goto = useCallback(
    (next: Surface): void => {
      if (blockedId !== null) {
        setDialog({ kind: 'save-failed' })
        return
      }
      setSelected(null)
      setSurface(next)
    },
    [blockedId],
  )

  // `Retry save` has no callback to report success, so the dialog watches the snapshot instead:
  // once the store has taken the write, the question it asks has been answered.
  useEffect(() => {
    if (dialog.kind === 'save-failed' && saveState !== null && saveState.kind !== 'failed') {
      setDialog({ kind: 'none' })
    }
  }, [dialog, saveState])

  const startProject = useCallback(
    async (name: string): Promise<void> => {
      const created = await library.createProject(name)
      if (created.ok) await services.openProject(created.value)
    },
    [library, services],
  )

  return (
    <div className="bb-library">
      <header className="app-header">
        <button type="button" className="brand" onClick={() => goto('projects')}>
          {STRINGS.brand} <span>{STRINGS.brandSuffix}</span>
        </button>
        <nav>
          <button
            type="button"
            className={`nav-tab ${surface === 'projects' ? 'active' : ''}`}
            onClick={() => {
              goto('projects')
            }}
          >
            {STRINGS.navProjects}
          </button>
          {/* #52 owns Migration review; it is drawn in the finished position and marked
              unavailable, which is truer than hiding a destination this build does not have. */}
          <button type="button" className="nav-tab" aria-disabled="true">
            {STRINGS.navMigration}
          </button>
          <button
            type="button"
            className={`nav-tab ${surface === 'trash' ? 'active' : ''}`}
            onClick={() => {
              goto('trash')
            }}
          >
            {STRINGS.navTrash}
          </button>
        </nav>
        <div className="header-status">
          <span className="status-dot" /> {STRINGS.headerStatus(due.length)}
        </div>
      </header>

      {surface === 'trash' ? (
        <TrashView
          records={snapshot.trash}
          now={now}
          notice={storageUnavailable ? <StorageNotice /> : undefined}
          onRestore={(id) => {
            const record = snapshot.trash.find((candidate) => candidate.id === id)
            if (record !== undefined) void restoreFromTrash(record)
          }}
          onDeletePermanently={(id) => {
            const record = snapshot.trash.find((candidate) => candidate.id === id)
            if (record !== undefined) void deletePermanently(record)
          }}
          onBack={() => {
            goto('projects')
          }}
        />
      ) : (
      <main className="page visual-library">
        {storageUnavailable && <StorageNotice />}
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
                void open(record)
              }}
              onBackup={() => void openBackup(record)}
              onRecover={() => void recover(record)}
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
      )}

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

      {dialog.kind === 'recovery' && (
        <RecoveryDialog
          name={dialog.name}
          points={dialog.points}
          now={now}
          onRestore={(pointId) => {
            void restorePoint(dialog.id, pointId)
          }}
          onClose={() => {
            setDialog({ kind: 'none' })
          }}
        />
      )}
      {dialog.kind === 'delete' && (
        <PermanentDeleteDialog
          name={dialog.name}
          summary={dialog.record.summary}
          recoveryPoints={dialog.recoveryPoints}
          onDownloadBackup={() => void confirmBackup(dialog.id, dialog.name)}
          onDelete={() => void purge(dialog.record)}
          onClose={() => {
            setDialog({ kind: 'none' })
          }}
        />
      )}
      {/* A revision conflict is another tab having written, which is §5's dialog rather than §2's
          — and that one belongs to the editor, where the reload and the copy have something to
          act on. So this dialog speaks every reason but that one. */}
      {dialog.kind === 'save-failed' && failedReason !== null && failedReason !== 'revision-conflict' && (
        <SaveFailedDialog
          reason={failedReason}
          lastSavedAt={saveState !== null && saveState.kind === 'failed' ? saveState.lastSavedAt : null}
          now={now}
          onRetry={() => {
            services.retrySave()
          }}
          onEmergencyBackup={() => {
            services.downloadEmergencyBackup()
          }}
          onDiscard={() => {
            services.discardUnsaved()
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
