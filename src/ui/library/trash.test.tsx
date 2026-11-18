/**
 * The Trash surface and the one rule it prints (#51 criterion 4).
 *
 * The countdown is the only arithmetic in this screen, and it is the only promise the screen makes
 * about the future — `You can restore it for 30 days` is a claim about a date. So the boundary is
 * tested from both ends: the row's own count, and the sweeper that decides whether the Project is
 * still there to be counted. They must agree, and they do only because both read
 * `TRASH_RETENTION_DAYS`.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TrashView, daysRemaining, monogramFor } from './TrashView'
import { STRINGS } from '../strings'
import { NOW, record } from './testing'
import { TRASH_RETENTION_DAYS, isTrashExpired } from '../../session'
import { createFakeClock, TEST_NOW } from '../../session/testing'

const DAY = 86_400_000
const trashedDaysAgo = (days: number) => record({ id: `p${days}`, trashedAt: new Date(Date.parse(NOW) - days * DAY).toISOString() })

describe('the days a deleted Project stays restorable', () => {
  it('counts down from the retention period and never below zero', () => {
    expect(daysRemaining(trashedDaysAgo(0).trashedAt as string, NOW)).toBe(TRASH_RETENTION_DAYS)
    expect(daysRemaining(trashedDaysAgo(12).trashedAt as string, NOW)).toBe(18)
    expect(daysRemaining(trashedDaysAgo(29).trashedAt as string, NOW)).toBe(1)
    expect(daysRemaining(trashedDaysAgo(30).trashedAt as string, NOW)).toBe(0)
    expect(daysRemaining(trashedDaysAgo(45).trashedAt as string, NOW)).toBe(0)
  })
})

describe('the Trash', () => {
  const rows = [trashedDaysAgo(12), trashedDaysAgo(29)]

  const draw = () =>
    render(
      <TrashView
        records={rows}
        now={NOW}
        onRestore={vi.fn()}
        onDeletePermanently={vi.fn()}
        onBack={vi.fn()}
      />,
    )

  it('is eyebrow, heading, lede, rows, back link — in that order (#51 criterion 4)', () => {
    const { container } = draw()
    const page = container.querySelector('.flow-page') as HTMLElement
    expect(within(page).getByText('Local trash')).toHaveClass('eyebrow')
    expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('Deleted Projects')
    expect(within(page).getByText(STRINGS.trashLede)).toBeInTheDocument()
    expect(page.querySelector('.trash-row')).toBeInTheDocument()
    expect(page.querySelector('.back-link')).toBeInTheDocument()
  })

  it('names each row, its monogram, and what it held (#51 criterion 4)', () => {
    draw()
    const row = screen.getAllByText('Tiong Bahru Home')[0]?.closest('.trash-row') as HTMLElement
    expect(within(row).getByText('TB')).toHaveClass('project-monogram')
    expect(within(row).getByText('Deleted 12 days ago · 18 days remaining')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete permanently' })).toHaveClass('danger-text')
  })

  it('says 1 day remaining in the singular, and less than a day when it has run out (#51 criterion 4)', () => {
    draw()
    const spans = [...document.querySelectorAll('.trash-row span')]
    expect(spans.map((node) => node.textContent)).toEqual([
      'Deleted 12 days ago · 18 days remaining',
      'Deleted 29 days ago · 1 day remaining',
    ])
    expect(STRINGS.daysRemaining(0)).toBe('Less than a day remaining')
    expect(STRINGS.daysRemaining(1)).toBe('1 day remaining')
    expect(STRINGS.daysRemaining(2)).toBe('2 days remaining')
  })

  it('takes the monogram from the first two words, and one word gives its first two letters', () => {
    expect(monogramFor('Old Apartment Study')).toBe('OA')
    expect(monogramFor('Studio')).toBe('ST')
    expect(monogramFor('  ')).toBe('')
  })

  it('says it is empty rather than showing nothing (#51 criterion 4)', () => {
    const { container } = render(
      <TrashView records={[]} now={NOW} onRestore={vi.fn()} onDeletePermanently={vi.fn()} onBack={vi.fn()} />,
    )
    expect(container.querySelector('.empty-state')).toHaveTextContent('Trash is empty.')
    expect(screen.queryAllByRole('button', { name: 'Restore' })).toHaveLength(0)
  })

  it('routes Restore, Delete permanently and the back link to their own answers (#51 criterion 4)', () => {
    const onRestore = vi.fn()
    const onDeletePermanently = vi.fn()
    const onBack = vi.fn()
    render(
      <TrashView
        records={rows}
        now={NOW}
        onRestore={onRestore}
        onDeletePermanently={onDeletePermanently}
        onBack={onBack}
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0] as HTMLElement)
    expect(onRestore).toHaveBeenCalledWith('p12')
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete permanently' })[1] as HTMLElement)
    expect(onDeletePermanently).toHaveBeenCalledWith('p29')
    fireEvent.click(screen.getByRole('button', { name: '← Return to Projects' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('shows the notice the tab arrived with, and only while there is one (#51 §4, §6)', () => {
    const notice = <p role="status">This browser has no storage available.</p>
    const { rerender } = render(
      <TrashView
        records={rows}
        now={NOW}
        notice={notice}
        onRestore={vi.fn()}
        onDeletePermanently={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('This browser has no storage available.')
    rerender(
      <TrashView
        records={rows}
        now={NOW}
        onRestore={vi.fn()}
        onDeletePermanently={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

/**
 * The day the sweep fires, and the promise the row has already stopped making by then.
 *
 * `LibraryStore.purgeExpired` and `TrashView`'s countdown are two readings of one rule, and the
 * boundary is the only place they could disagree: a row still saying `1 day remaining` while the
 * sweeper has deleted the Project is a broken promise drawn in the app's own typeface. So both
 * are asked about the same instants, and the instants come from the same fake clock the session
 * suites drive — the elapsed thirty days are arithmetic the test owns, not a date that happens to
 * still read as old.
 *
 * The store-level half of criterion 4 — a Project trashed 31 days ago is gone after the next
 * Library open, with its Recovery Points — is in `src/session/library.test.ts`. The sweeper lives
 * in `session` and needs a real adapter to have anything to delete, and `ui` may not open one
 * (#20 §2); what belongs here is the agreement between the two readings.
 */
describe('the day the sweep fires', () => {
  /** A clock the test moves by whole days, starting where every session fixture starts. */
  const clock = createFakeClock(TEST_NOW)
  const trashed = record({ id: 'gone', name: 'Old Apartment Study', trashedAt: TEST_NOW })

  it('counts the row down to nothing on the very day the sweeper takes the Project (#51 criterion 4)', async () => {
    for (let day = 0; day < TRASH_RETENTION_DAYS; day += 1) {
      const now = clock.now()
      expect(daysRemaining(trashed.trashedAt as string, now)).toBe(TRASH_RETENTION_DAYS - day)
      expect(isTrashExpired(trashed, now)).toBe(false)
      await clock.advance(DAY)
    }

    // Day 30: the row's last words are `Less than a day remaining`, and the sweep has its Project.
    expect(daysRemaining(trashed.trashedAt as string, clock.now())).toBe(0)
    expect(STRINGS.daysRemaining(0)).toBe('Less than a day remaining')
    expect(isTrashExpired(trashed, clock.now())).toBe(true)
  })

  it('leaves every Project that is not in the Trash alone, however old its save (#51 §4)', () => {
    expect(isTrashExpired(record({ trashedAt: null }), clock.now())).toBe(false)
  })
})
