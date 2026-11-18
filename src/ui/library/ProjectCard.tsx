/**
 * One Project in the Library grid (#50 §2; the archive's `ProjectCard` at `8787ba4`).
 *
 * The DOM order is the archive's, element for element, because the screenshot comparison in
 * `e2e/screenshots/library.spec.ts` overlays the two and a reordered card is a diff nobody
 * intended. What differs is where the numbers come from: the archive printed fixture literals,
 * and production reads a `LibraryRecord` and its `ProjectSummary`, so the Design Option count
 * shows the truth — `0 Design Options` for a Project with none — which is named deviation 9.
 *
 * The card is a container, not a control: it takes clicks to select, and every action inside it
 * stops propagation, because a `Delete` that also selected the card would be a card that
 * disagrees with itself.
 */
import { useEffect, useState } from 'react'
import { STRINGS } from '../strings'
import { formatSince } from './formatSince'
import type { LibraryRecord, SaveState } from '../../session'
import type { ProjectOutline } from '../../domain'
import type { MouseEvent, ReactNode } from 'react'

/** The archive's artwork box; the real outline is fitted into it, not stretched across it. */
const PREVIEW_VIEWBOX = { width: 220, height: 110, inset: 12 }

/**
 * The Plan Image-free thumbnail: the Project's own walls, fitted into the archive's box.
 *
 * `previewOutline` is in model millimetres and can be any shape, so the fit is the smaller of
 * the two scale factors and the result stays centred. A Project with no geometry draws an empty
 * box, which is honest: there is nothing to show yet.
 */
function outlineRects(outline: ProjectOutline): { x: number; y: number; w: number; d: number; rot: number }[] {
  const [minX, minY, maxX, maxY] = outline.bounds
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const boxW = PREVIEW_VIEWBOX.width - PREVIEW_VIEWBOX.inset * 2
  const boxH = PREVIEW_VIEWBOX.height - PREVIEW_VIEWBOX.inset * 2
  const scale = Math.min(boxW / spanX, boxH / spanY)
  const offsetX = PREVIEW_VIEWBOX.inset + (boxW - spanX * scale) / 2
  const offsetY = PREVIEW_VIEWBOX.inset + (boxH - spanY * scale) / 2
  return outline.rects.map(([cx, cy, w, d, rot]) => ({
    x: offsetX + (cx - minX - w / 2) * scale,
    y: offsetY + (cy - minY - d / 2) * scale,
    w: w * scale,
    d: d * scale,
    rot,
  }))
}

export interface ProjectCardProps {
  record: LibraryRecord
  /** The live save state, present only while this Project's session is open in this tab. */
  saveState: SaveState | null
  /** "Now", from the clock port, for the two `{since}` lines. */
  now: string
  /** `isBackupDue`, answered by the caller so the card and the header cannot disagree. */
  due: boolean
  selected: boolean
  /**
   * How many Recovery Points this Project has. `ui` may not read `persistence` (#42 §2), so the
   * count arrives as data — and it is the number the archive faked with a fixture literal.
   */
  recoveryPoints: number
  /** The Plan Image thumbnail, or `null` when the Project has none or it is still being read. */
  planImageUrl: string | null
  onSelect: () => void
  onOpen: () => void
  onBackup: () => void
  /** Open the Recovery Point picker (#51 §1), which #50 drew disabled and this enables. */
  onRecover: () => void
  onRename: () => void
  onDuplicate: () => void
  onTrash: () => void
}

/** Every action in the card is a click the card itself must not also take. */
const stop = (run: () => void) => (event: MouseEvent): void => {
  event.stopPropagation()
  run()
}

export const ProjectCard = ({
  record,
  saveState,
  now,
  due,
  selected,
  recoveryPoints,
  planImageUrl,
  onSelect,
  onOpen,
  onBackup,
  onRecover,
  onRename,
  onDuplicate,
  onTrash,
}: ProjectCardProps): ReactNode => {
  const { summary } = record
  const failed = saveState?.kind === 'failed'
  const saveLabel =
    saveState?.kind === 'saving'
      ? STRINGS.saving
      : failed
        ? STRINGS.saveFailed
        : STRINGS.savedLocally(formatSince(record.savedAt, now))

  return (
    <article
      className={selected ? 'project-card selected' : 'project-card'}
      data-project={record.id}
      onClick={onSelect}
    >
      <div className="plan-preview">
        <span>{STRINGS.floorBadge(summary.floorCount)}</span>
        {planImageUrl !== null ? (
          <img src={planImageUrl} alt="" />
        ) : (
          <svg viewBox={`0 0 ${PREVIEW_VIEWBOX.width} ${PREVIEW_VIEWBOX.height}`} aria-hidden="true">
            {outlineRects(summary.previewOutline).map((rect) => (
              <rect
                key={`${rect.x}-${rect.y}-${rect.w}-${rect.d}`}
                x={rect.x}
                y={rect.y}
                width={rect.w}
                height={rect.d}
                transform={rect.rot === 0 ? undefined : `rotate(${rect.rot} ${rect.x + rect.w / 2} ${rect.y + rect.d / 2})`}
              />
            ))}
          </svg>
        )}
      </div>
      <div className="card-body">
        <div className="card-title">
          <div>
            <h2>{record.name}</h2>
            <p>{record.address ?? STRINGS.noAddress}</p>
          </div>
          <CardMenu name={record.name} onRename={onRename} onDuplicate={onDuplicate} />
        </div>
        <div className={failed ? 'save-line failed' : 'save-line'}>
          <span className="status-dot" />
          {saveLabel}
        </div>
        <div className={due ? 'backup-line due' : 'backup-line'}>
          {record.lastBackupInitiatedAt === null
            ? STRINGS.backupNone
            : STRINGS.backupStarted(formatSince(record.lastBackupInitiatedAt, now))}
        </div>
        <div className="card-stats">
          <span>{STRINGS.floors(summary.floorCount)}</span>
          <span data-stat="design-options">{STRINGS.designOptions(summary.designOptionCount)}</span>
          <span>{STRINGS.recoveryPoints(recoveryPoints)}</span>
        </div>
        <div className="card-actions">
          <button type="button" className="button primary" onClick={stop(onOpen)}>
            {STRINGS.open}
          </button>
          <button type="button" className="button" onClick={stop(onBackup)}>
            {STRINGS.backup}
          </button>
          <button type="button" className="button" onClick={stop(onRecover)}>
            {STRINGS.recover}
          </button>
          <button type="button" className="button danger-text" onClick={stop(onTrash)}>
            {STRINGS.delete}
          </button>
        </div>
      </div>
    </article>
  )
}

/**
 * The `•••` menu (deviation 7): Rename and Duplicate, the two things a card can do to a name.
 *
 * The archive drew the button and attached nothing to it. Opening it is the only new behaviour
 * on the card, so it is deliberately small — two items, closed by choosing one, by clicking
 * anywhere else, or by `Esc`. It is not a `menu` role: two buttons under a toggle is what it
 * is, and claiming the full menu semantics would oblige a focus model this does not implement.
 */
function CardMenu({
  name,
  onRename,
  onDuplicate,
}: {
  name: string
  onRename: () => void
  onDuplicate: () => void
}): ReactNode {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const dismiss = (): void => {
      setOpen(false)
    }
    document.addEventListener('click', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => {
      document.removeEventListener('click', dismiss)
      document.removeEventListener('keydown', dismiss)
    }
  }, [open])

  return (
    <div className="card-menu">
      <button
        type="button"
        className="icon-button"
        aria-label={STRINGS.moreActions(name)}
        aria-expanded={open}
        onClick={stop(() => {
          setOpen((was) => !was)
        })}
      >
        •••
      </button>
      {open && (
        <ul>
          <li>
            <button
              type="button"
              onClick={stop(() => {
                setOpen(false)
                onRename()
              })}
            >
              {STRINGS.rename}
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={stop(() => {
                setOpen(false)
                onDuplicate()
              })}
            >
              {STRINGS.duplicate}
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}
