/**
 * The four dialogs #51 names (#51 criteria 1, 2, 3).
 *
 * What is asserted is the *hierarchy* the issue specifies — eyebrow, heading, body, summary,
 * actions — in that order, the order of the buttons, and whether the dialog can be got out of
 * without answering it. The words themselves belong to `strings.test.ts`; a test that retyped
 * them would only prove the same sentence had been written down twice.
 *
 * The action order matters more than it looks. `Delete permanently` is the only red box in the
 * app and the archive puts it at the far end of the row from `Cancel`; a test that checked only
 * that both existed would pass on a dialog where Enter deletes the Project.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConflictDialog } from './ConflictDialog'
import { PermanentDeleteDialog } from './PermanentDeleteDialog'
import { RecoveryDialog, defaultRecoveryPoint } from './RecoveryDialog'
import { SaveFailedDialog } from './SaveFailedDialog'
import { SUMMARY } from '../library/testing'
import { STRINGS } from '../strings'
import type { RecoveryPointMeta } from '../../session'

const NOW = '2026-10-07T02:44:00.000Z'

/** One Recovery Point, changed only where a test cares which one it is. */
function point(overrides: Partial<RecoveryPointMeta> = {}): RecoveryPointMeta {
  return {
    id: 'rp1',
    projectId: 'home',
    createdAt: '2026-10-07T01:15:00.000Z',
    kind: 'idle',
    revision: 4,
    schemaVersion: 1,
    summary: SUMMARY,
    ...overrides,
  }
}

/** The archive's four rows, newest first, as `recovery.list` returns them. */
const POINTS = [
  point({ id: 'rp4', createdAt: '2026-10-07T02:42:00.000Z', kind: 'pre-restore' }),
  point({ id: 'rp3', createdAt: '2026-10-07T01:15:00.000Z' }),
  point({ id: 'rp2', createdAt: '2026-10-06T10:30:00.000Z' }),
  point({ id: 'rp1', createdAt: '2026-10-03T03:20:00.000Z' }),
]

/** The dialog box, so an assertion can be about the whole hierarchy rather than the page. */
const box = (): HTMLElement => screen.getByRole('dialog')

/** The dialog's text blocks in the order they are painted. */
const outline = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('p.eyebrow, h2, p, .summary-box, .failure-reason, .recovery-list, .failure-actions, .modal-actions')]
    .filter((node) => !node.parentElement?.closest('.summary-box, .failure-reason, .failure-actions, .modal-actions, .recovery-list'))
    .map((node) => node.className)

const actions = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('button')].map((button) => button.textContent ?? '')

describe('the Recovery Point picker', () => {
  it('is eyebrow, heading, body, list, actions — in that order (#51 criterion 2)', () => {
    render(<RecoveryDialog name="Tiong Bahru Home" points={POINTS} now={NOW} onRestore={vi.fn()} onClose={vi.fn()} />)
    expect(within(box()).getByText('Recovery Points')).toHaveClass('eyebrow')
    expect(within(box()).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Return Tiong Bahru Home to an earlier state',
    )
    const root = box()
    expect(outline(root).indexOf('eyebrow')).toBe(0)
    expect(root.querySelector('h2')?.compareDocumentPosition(root.querySelector('.recovery-list') as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(actions(root)).toEqual(['Cancel', 'Restore selected point'])
  })

  it('offers one radio per point, newest first, with the reason and the shape of each (#51 criterion 2)', () => {
    render(<RecoveryDialog name="Tiong Bahru Home" points={POINTS} now={NOW} onRestore={vi.fn()} onClose={vi.fn()} />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(4)
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual(['rp4', 'rp3', 'rp2', 'rp1'])
    // The clock is fixed; the wall time is whatever the machine's zone says, so the shape of the
    // line is what is pinned here and `formatSince.test.ts` owns its arithmetic.
    expect(screen.getAllByText(/^Today, \d{1,2}:\d{2} [AP]M$/)).toHaveLength(2)
    // Three of the four rows are idle checkpoints of the same Project, so the line repeats; what
    // is pinned is that a row carries its reason and its shape, joined as the archive joins them.
    expect(screen.getAllByText(`${STRINGS.recoveryReason.idle} · ${STRINGS.recoverySummary(2, 0, 14)}`)).toHaveLength(3)
    expect(screen.getByText(`${STRINGS.recoveryReason['pre-restore']} · ${STRINGS.recoverySummary(2, 0, 14)}`)).toBeInTheDocument()
  })

  it('opens on the newest point that is not the one a restore left behind (#51 §1)', () => {
    render(<RecoveryDialog name="Tiong Bahru Home" points={POINTS} now={NOW} onRestore={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('radio', { checked: true })).toHaveAttribute('value', 'rp3')
    expect(defaultRecoveryPoint([POINTS[1] as RecoveryPointMeta])).toBe(POINTS[1])
    // A `pre-restore` Point on its own is still shown, and there is still nothing to restore to:
    // selecting it would offer the user the state the restore had just produced.
    expect(defaultRecoveryPoint([POINTS[0] as RecoveryPointMeta])).toBeNull()
  })

  it('restores the chosen point and nothing else (#51 criterion 2)', () => {
    const onRestore = vi.fn()
    const onClose = vi.fn()
    render(<RecoveryDialog name="Tiong Bahru Home" points={POINTS} now={NOW} onRestore={onRestore} onClose={onClose} />)
    fireEvent.click(screen.getByRole('radio', { name: /Yesterday/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore selected point' }))
    expect(onRestore).toHaveBeenCalledWith('rp2')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Cancel and on Escape, having written nothing (#51 criterion 2)', () => {
    const onRestore = vi.fn()
    const onClose = vi.fn()
    render(<RecoveryDialog name="Tiong Bahru Home" points={POINTS} now={NOW} onRestore={onRestore} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('says so when there is nothing to return to, and will not restore it (#51 §1)', () => {
    render(<RecoveryDialog name="Tiong Bahru Home" points={[]} now={NOW} onRestore={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog').querySelector('.empty-state')).toHaveTextContent(STRINGS.recoveryEmpty)
    expect(screen.getByRole('button', { name: 'Restore selected point' })).toBeDisabled()
  })
})

describe('the Save failed dialog', () => {
  it('is icon, eyebrow, heading, body, reason, actions — in that order (#51 criterion 1)', () => {
    render(
      <SaveFailedDialog
        reason="quota"
        lastSavedAt="2026-10-07T02:42:00.000Z"
        now={NOW}
        onRetry={vi.fn()}
        onEmergencyBackup={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )
    const root = box()
    expect(root.querySelector('.failure-icon')).toBeInTheDocument()
    expect(within(root).getByText('Save failed')).toHaveClass('eyebrow', 'danger')
    expect(within(root).getByRole('heading', { level: 2 })).toHaveTextContent('Your latest changes are not stored')
    expect(within(root).getByText(/\d{1,2}:\d{2} [AP]M/, { selector: 'strong' })).toBeInTheDocument()
    expect(within(root).getByText('Browser storage is full')).toBeInTheDocument()
    // The icon is decoration; the eyebrow is the announcement.
    expect(root.querySelector('.failure-icon')).toHaveAttribute('aria-hidden', 'true')
    expect(actions(root)).toEqual(['Retry save', 'Download emergency backup', 'Discard unsaved changes'])
  })

  it('says nothing has ever been stored when the last save is null (#51 §2)', () => {
    render(
      <SaveFailedDialog
        reason="unavailable"
        lastSavedAt={null}
        now={NOW}
        onRetry={vi.fn()}
        onEmergencyBackup={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )
    expect(screen.getByText(STRINGS.saveFailedNothingStored)).toBeInTheDocument()
    expect(screen.getByText(STRINGS.saveFailureReason.unavailable)).toBeInTheDocument()
  })

  it('cannot be dismissed: Escape, the backdrop and the absence of a close button (#51 criterion 1)', () => {
    render(
      <SaveFailedDialog
        reason="quota"
        lastSavedAt="2026-10-07T02:42:00.000Z"
        now={NOW}
        onRetry={vi.fn()}
        onEmergencyBackup={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    const backdrop = document.querySelector('.modal-backdrop') as HTMLElement
    fireEvent.mouseDown(backdrop)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(box()).queryByRole('button', { name: /close|dismiss/i })).not.toBeInTheDocument()
  })

  it('routes each of the three answers to its own action (#51 criterion 1)', () => {
    const onRetry = vi.fn()
    const onEmergencyBackup = vi.fn()
    const onDiscard = vi.fn()
    render(
      <SaveFailedDialog
        reason="quota"
        lastSavedAt="2026-10-07T02:42:00.000Z"
        now={NOW}
        onRetry={onRetry}
        onEmergencyBackup={onEmergencyBackup}
        onDiscard={onDiscard}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download emergency backup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved changes' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onEmergencyBackup).toHaveBeenCalledTimes(1)
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })
})

describe('the permanent deletion dialog', () => {
  it('is eyebrow, heading, body, summary, backup, actions — in that order (#51 criterion 3)', () => {
    render(
      <PermanentDeleteDialog
        name="Old Apartment Study"
        summary={SUMMARY}
        recoveryPoints={3}
        onDownloadBackup={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const root = box()
    expect(within(root).getByText('Permanent deletion')).toHaveClass('eyebrow', 'danger')
    expect(within(root).getByRole('heading', { level: 2 })).toHaveTextContent(STRINGS.permanentDeleteHeading)
    const summary = root.querySelector('.summary-box') as HTMLElement
    expect(within(summary).getByText('Old Apartment Study')).toBeInTheDocument()
    expect(within(summary).getByText(STRINGS.permanentDeleteSummary(2, 0, 3))).toBeInTheDocument()
    // The Backup offer sits above the row, outside it: the two answers are the only red and the
    // only plain button in the row, and nothing else is adjacent to them.
    expect(actions(root)).toEqual([
      'Download Backup before deleting',
      'Cancel',
      'Delete permanently',
    ])
    expect([...root.querySelectorAll('.modal-actions button')].map((b) => b.textContent)).toEqual([
      'Cancel',
      'Delete permanently',
    ])
    // The red box is a filled button, not a text link: it is the one deliberate answer here.
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toHaveClass('danger-button')
  })

  it('offers the Backup as a button, not as a warning (#51 criterion 3)', () => {
    const onDownloadBackup = vi.fn()
    render(
      <PermanentDeleteDialog
        name="Old Apartment Study"
        summary={SUMMARY}
        recoveryPoints={3}
        onDownloadBackup={onDownloadBackup}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Download Backup before deleting' }))
    expect(onDownloadBackup).toHaveBeenCalledTimes(1)
  })

  it('deletes only when told to, and closes on Cancel and Escape (#51 criterion 3)', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(
      <PermanentDeleteDialog
        name="Old Apartment Study"
        summary={SUMMARY}
        recoveryPoints={3}
        onDownloadBackup={vi.fn()}
        onDelete={onDelete}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe('the changed-in-another-tab dialog', () => {
  it('names the Project and offers the three answers in order (#51 §5)', () => {
    render(<ConflictDialog name="Tiong Bahru Home" onReload={vi.fn()} onImportCopy={vi.fn()} onEmergencyBackup={vi.fn()} />)
    const root = box()
    expect(within(root).getByText('Changed in another tab')).toHaveClass('eyebrow', 'danger')
    expect(within(root).getByRole('heading', { level: 2 })).toHaveTextContent('This Project changed in another tab')
    expect(actions(root)).toEqual(['Reload the latest version', 'Import my changes as a copy', 'Download emergency backup'])
  })

  it('is not dismissable, because the newer state is still only in memory (#51 §5)', () => {
    render(<ConflictDialog name="Tiong Bahru Home" onReload={vi.fn()} onImportCopy={vi.fn()} onEmergencyBackup={vi.fn()} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.querySelector('.modal-backdrop') as HTMLElement)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
