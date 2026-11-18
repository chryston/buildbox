/**
 * The Trash surface (#51 §4; the archive's `TrashView`).
 *
 * A row, not a card: a deleted Project has no Plan Image to browse by and no actions worth a
 * grid, and the archive's flat list with a monogram is what makes the two answers — put it back,
 * or finish the job — the only things in sight.
 *
 * The countdown is the one number here that is not stored. Thirty days is `TRASH_RETENTION_DAYS`;
 * the row shows what is left of it, and `session`'s `purgeExpired` is what acts on it when the
 * Library next opens. The two agree on the constant rather than each having their own, because a
 * row that promises 30 days and a sweeper that grants 31 is the kind of lie #14 is about.
 */
import { formatSince } from './formatSince'
import { STRINGS } from '../strings'
import { TRASH_RETENTION_DAYS } from '../../session'
import type { LibraryRecord } from '../../session'
import type { ReactNode } from 'react'

const DAY_MS = 86_400_000

/**
 * Whole days of the 30 still to run: `n = 30 − whole days elapsed`.
 *
 * Whole, not rounded — a Project deleted 12.7 days ago has been gone twelve days, and the
 * archive's row says `Deleted 12 days ago · 18 days remaining` for exactly that instant. The two
 * halves of the sentence are read together, so they count from the same floor.
 */
export function daysRemaining(trashedAt: string, now: string): number {
  const elapsed = Date.parse(now) - Date.parse(trashedAt)
  // Clamped, because a record the sweeper has not reached yet is not a negative number of days:
  // the row says `Less than a day remaining`, which is the truth the archive tells at that point.
  return Math.max(0, TRASH_RETENTION_DAYS - Math.floor(elapsed / DAY_MS))
}

/**
 * The monogram's two letters: the first letters of the first two words.
 *
 * The archive drew `OA` for `Old Apartment Study` as a literal. Two words is what a Project name
 * usually has; one word gets its first two letters rather than a lonely single one, and an empty
 * name gets nothing rather than a stray space.
 */
export function monogramFor(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 0 || words[0] === '') return ''
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export interface TrashViewProps {
  /** The trashed records, in the order the store lists them. */
  records: readonly LibraryRecord[]
  now: string
  /** The storage notice, when this tab has no durable storage (#51 §6). */
  notice?: ReactNode
  onRestore(id: string): void
  onDeletePermanently(id: string): void
  onBack(): void
}

export function TrashView({ records, now, notice, onRestore, onDeletePermanently, onBack }: TrashViewProps): ReactNode {
  return (
    <main className="flow-page">
      <p className="eyebrow">{STRINGS.eyebrowLocalTrash}</p>
      <h1>{STRINGS.trashHeading}</h1>
      <p className="lede">{STRINGS.trashLede}</p>
      {notice}
      {records.length === 0 ? (
        <div className="empty-state">{STRINGS.trashEmpty}</div>
      ) : (
        records.map((record) => (
          <div className="trash-row" key={record.id}>
            <div className="project-monogram" aria-hidden="true">
              {monogramFor(record.name)}
            </div>
            <div>
              <strong>{record.name}</strong>
              <span>
                {STRINGS.trashDeleted(
                  formatSince(record.trashedAt ?? now, now),
                  STRINGS.daysRemaining(daysRemaining(record.trashedAt ?? now, now)),
                )}
              </span>
            </div>
            <button onClick={() => onRestore(record.id)}>{STRINGS.restore}</button>
            <button className="danger-text" onClick={() => onDeletePermanently(record.id)}>
              {STRINGS.deletePermanently}
            </button>
          </div>
        ))
      )}
      <button className="back-link" onClick={onBack}>
        {STRINGS.returnToProjects}
      </button>
    </main>
  )
}
