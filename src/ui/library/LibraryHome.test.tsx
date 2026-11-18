/**
 * The Library home against its interfaces (#50 criteria 2–4, 6–15, 18).
 *
 * Every test here renders the real component over the doubles in `testing.ts`, because the
 * criteria are all about which sentence appears where: the plural forms, the two states of the
 * Backup line, the exact words of each dialog and each toast. None of them needs IndexedDB, and
 * none of them should have to wait for it.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LibraryHome } from './LibraryHome'
import { NOW, STAGED, createTestLibrary, record } from './testing'
import type { TestLibrary } from './testing'
import type { RestoreProblem } from '../../session'

const DAY = 86_400_000
const ago = (days: number): string => new Date(Date.parse(NOW) - days * DAY).toISOString()

/** The parity fixture's three Projects: two due, one not. */
const FIXTURE = [
  record({ id: 'home', name: 'Tiong Bahru Home', address: '18 Yong Siak Street' }),
  record({
    id: 'parents',
    name: 'Parents’ Flat',
    address: '48 Marine Parade Road',
    revision: 3,
    savedAt: '2026-10-06T20:42:00.000Z',
    lastBackupInitiatedAt: ago(6),
    lastBackupRevision: 3,
    summary: { ...record().summary, floorCount: 1 },
  }),
  record({
    id: 'studio',
    name: 'Studio Renovation',
    address: '71 Ayer Rajah Crescent',
    revision: 9,
    savedAt: ago(4),
    lastBackupInitiatedAt: ago(19),
    lastBackupRevision: 5,
    summary: { ...record().summary, floorCount: 1 },
  }),
]

/** Render and let the Recovery Point counts land, which is the one thing that arrives async. */
/**
 * Let every promise the component started settle inside React's `act`.
 *
 * `src/test/setup.ts` turns an act() warning into a failure, and a component that awaits a port in
 * an effect resolves its promise some ticks after `render` or `fireEvent` returned — outside
 * `act`. Draining the queue inside `act` is the only way to see the result without racing a
 * half-committed tree, and the drain has to outlast the deepest chain the component can start:
 * renaming re-reads the list, whose notification re-runs the Recovery Point count read, which is
 * four awaits deep before anything reaches React.
 */
const flush = async (): Promise<void> => {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve()
  })
}

const renderLibrary = async (records = FIXTURE, recoveryCount = 8): Promise<TestLibrary> => {
  const test = createTestLibrary(records)
  test.services.recoveryCounts = async () => new Map(records.map((entry) => [entry.id, recoveryCount]))
  render(<LibraryHome services={test.services} />)
  await flush()
  await screen.findAllByText(`${recoveryCount} Recovery Point${recoveryCount === 1 ? '' : 's'}`)
  // The store starts empty and fills itself, so the count read runs twice: once against the
  // empty list and once when the Projects land. Waiting for the first render is not waiting for
  // the second, and an update left in flight is charged to whichever test runs next.
  await flush()
  return test
}

const card = (name: string): HTMLElement => screen.getByText(name).closest('.project-card') as HTMLElement

describe('the Library home', () => {
  it('shows the brand and the three tabs (#50 criterion 2)', async () => {
    await renderLibrary()
    expect(screen.getByText('BuildBox')).toBeInTheDocument()
    expect(screen.getByText('Project Library')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Projects' })).toHaveClass('active')
    // #50 left this tab disabled because it had not built the review; #52 §4 built it, so all
    // three tabs are destinations now.
    expect(screen.getByRole('button', { name: 'Migration review' })).toBeEnabled()
    // #51 §4 gave the Trash a screen, so its tab is a destination rather than a promise.
    expect(screen.getByRole('button', { name: 'Trash' })).toBeEnabled()
  })

  it('counts the reminders in the header, in the singular when there is one (#50 criteria 3, 6)', () => {
    renderLibrary()
    expect(screen.getByText('Local only · 2 backup reminders')).toBeInTheDocument()
  })

  it('says reminder in the singular when one Project is due (#50 criterion 6)', async () => {
    await renderLibrary([FIXTURE[0]])
    expect(screen.getByText('Local only · 1 backup reminder')).toBeInTheDocument()
  })

  it('counts no reminder where the Backup covered the latest revision (#50 criterion 12)', async () => {
    await renderLibrary([FIXTURE[1]])
    expect(screen.getByText('Local only · 0 backup reminders')).toBeInTheDocument()
  })

  it('shows the hero copy and both hero actions (#50 criterion 2)', async () => {
    await renderLibrary()
    expect(screen.getByText('Your properties')).toBeInTheDocument()
    expect(screen.getByText('Pick up where you left off')).toBeInTheDocument()
    expect(
      screen.getByText('Projects save automatically in this browser. Download backups to keep your own copies.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore Backup' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Project' })).toBeInTheDocument()
  })

  it('draws one card per Project with its four actions (#50 criterion 4)', async () => {
    await renderLibrary()
    const home = card('Tiong Bahru Home')
    expect(within(home).getByText('18 Yong Siak Street')).toBeInTheDocument()
    expect(within(home).getByText('Saved locally 2 min ago')).toBeInTheDocument()
    expect(within(home).getByText('No backup downloaded yet')).toBeInTheDocument()
    expect(within(home).getByText('2 Floors')).toBeInTheDocument()
    expect(within(home).getByText('8 Recovery Points')).toBeInTheDocument()
    expect(within(home).getByRole('button', { name: 'Open' })).toBeInTheDocument()
    expect(within(home).getByRole('button', { name: 'Backup' })).toBeInTheDocument()
    // #51 §1 made this real: the card's fourth action opens the Recovery Point picker.
    expect(within(home).getByRole('button', { name: 'Recover' })).toBeEnabled()
    expect(within(home).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('reads the Design Option count as zero, which is what domain v1 holds (#50 deviation 9)', async () => {
    await renderLibrary()
    expect(card('Tiong Bahru Home').querySelector('[data-stat="design-options"]')).toHaveTextContent(
      '0 Design Options',
    )
  })

  it('pluralises the counts the archive got wrong (#50 deviation 6)', async () => {
    await renderLibrary()
    expect(card('Parents’ Flat')).toHaveTextContent('1 Floor')
    expect(card('Tiong Bahru Home')).toHaveTextContent('2 Floors')
    expect(card('Parents’ Flat')).toHaveTextContent('0 Design Options')
  })

  it('uses the singular everywhere for a Project with one of each (#50 deviation 6)', async () => {
    await renderLibrary(
      [record({ id: 'x', name: 'One Of Each', summary: { ...record().summary, floorCount: 1, designOptionCount: 1 } })],
      1,
    )
    expect(card('One Of Each')).toHaveTextContent('1 Floor')
    expect(card('One Of Each')).toHaveTextContent('1 Design Option')
    expect(card('One Of Each')).toHaveTextContent('1 Recovery Point')
  })

  it('marks the Backup line due only where the rule says so (#50 criterion 12)', async () => {
    await renderLibrary()
    expect(card('Tiong Bahru Home').querySelector('.backup-line')).toHaveClass('due')
    expect(card('Studio Renovation').querySelector('.backup-line')).toHaveClass('due')
    expect(card('Parents’ Flat').querySelector('.backup-line')).not.toHaveClass('due')
    expect(card('Parents’ Flat')).toHaveTextContent('Backup download started 6 days ago')
  })

  it('shows the reminder banner with the count and dismisses on the cross (#50 criterion 12)', async () => {
    await renderLibrary()
    const banner = document.querySelector('.backup-reminder') as HTMLElement
    expect(within(banner).getByText('Keep a copy you control')).toBeInTheDocument()
    expect(
      within(banner).getByText(
        '2 Projects have meaningful changes without a recent backup download. Local saves can be removed with browser data.',
      ),
    ).toBeInTheDocument()
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss backup reminder' }))
    expect(document.querySelector('.backup-reminder')).toBeNull()
  })

  it('says it in the singular when one Project is due (#50 criterion 6)', async () => {
    await renderLibrary([FIXTURE[0]])
    const banner = document.querySelector('.backup-reminder') as HTMLElement
    expect(
      within(banner).getByText(
        '1 Project has meaningful changes without a recent backup download. Local saves can be removed with browser data.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the save line of the Project whose session this tab holds (#50 criterion 4)', async () => {
    const test = createTestLibrary(FIXTURE)
    render(<LibraryHome services={test.services} saveState={{ kind: 'saving' }} saveStateFor="home" />)
    await flush()
    expect(card('Tiong Bahru Home')).toHaveTextContent('Saving…')
  })

  it('names a save failure as a failure (#50 criterion 4)', async () => {
    const test = createTestLibrary(FIXTURE)
    render(
      <LibraryHome
        services={test.services}
        saveState={{ kind: 'failed', lastSavedAt: null, reason: 'quota' }}
        saveStateFor="home"
      />,
    )
    await flush()
    const line = card('Tiong Bahru Home').querySelector('.save-line') as HTMLElement
    expect(line).toHaveClass('failed')
    expect(line).toHaveTextContent('Save failed · changes not stored')
  })

  it('opens Rename and Duplicate from the card menu (#50 criterion 7)', async () => {
    const test = await renderLibrary()
    fireEvent.click(within(card('Tiong Bahru Home')).getByRole('button', { name: 'More actions for Tiong Bahru Home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByRole('dialog', { name: 'Rename Project' })).toBeInTheDocument()
    expect(test.calls.renamed).toEqual([])

    fireEvent.click(within(card('Studio Renovation')).getByRole('button', { name: 'More actions for Studio Renovation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(test.calls.duplicated).toEqual(['studio'])
    // Duplicating adds a Project, and a new Project means the Recovery Point counts are read
    // again. That read belongs to this test whether or not the test looks at it.
    await flush()
  })

  it('treats Cancel, Esc and a backdrop click on the Rename dialog as the same thing (#50 criterion 13)', async () => {
    const test = await renderLibrary()
    const open = (): void => {
      fireEvent.click(within(card('Tiong Bahru Home')).getByRole('button', { name: 'More actions for Tiong Bahru Home' }))
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    }
    const dialog = (): HTMLElement | null => screen.queryByRole('dialog', { name: 'Rename Project' })

    open()
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(test.calls.renamed).toEqual([])
    expect(dialog()).toBeNull()

    open()
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Renamed' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(test.calls.renamed).toEqual([])
    expect(dialog()).toBeNull()

    open()
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Renamed' } })
    fireEvent.mouseDown(document.querySelector('.modal-backdrop') as HTMLElement)
    expect(test.calls.renamed).toEqual([])
    expect(dialog()).toBeNull()

    open()
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(test.calls.renamed).toEqual([['home', 'Renamed']])
    // Renaming re-reads the list, and that read resolves after this assertion — the only way to
    // see it is to wait for it here rather than let it land in whichever test runs next.
    await flush()
  })

  it('sends a card to Trash and says for how long (#50 criterion 14)', async () => {
    const test = await renderLibrary()
    fireEvent.click(within(card('Tiong Bahru Home')).getByRole('button', { name: 'Delete' }))
    // #51 §5: `Delete` asks whether another tab holds the Project before it asks the store, so
    // the trashing lands one microtask later than it did when the card acted on its own.
    await flush()
    expect(test.calls.trashed).toEqual(['home'])
    expect(screen.getByRole('status')).toHaveTextContent(
      'Moved Tiong Bahru Home to Trash. You can restore it for 30 days.',
    )
  })

  it('asks before downloading, naming the file it will write (#50 criterion 15, deviation 10)', async () => {
    const test = await renderLibrary()
    fireEvent.click(within(card('Tiong Bahru Home')).getByRole('button', { name: 'Backup' }))
    await flush()
    const dialog = screen.getByRole('dialog', { name: 'Download a complete copy?' })
    expect(within(dialog).getByText('Project Backup')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'The .buildbox file contains the full property record, including Plan Images and comments. It is not encrypted.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Tiong Bahru Home.buildbox')).toBeInTheDocument()
    expect(within(dialog).getByText('Estimated size 4.2 MB · all assets included')).toBeInTheDocument()
    expect(
      within(dialog).getByText('BuildBox can record that the download started, but cannot verify where you keep the file.'),
    ).toBeInTheDocument()
    expect(test.calls.download).toEqual([])

    fireEvent.click(within(dialog).getByRole('button', { name: 'Download Backup' }))
    await waitFor(() => expect(test.calls.download).toEqual(['home']))
    expect(screen.getByRole('status')).toHaveTextContent(
      'Backup download started for Tiong Bahru Home. BuildBox cannot verify where the file is kept.',
    )
  })

  it('answers a refusal with the sentence that names it (#50 criterion 8)', async () => {
    const cases: [RestoreProblem, string][] = [
      [packageProblem('export-not-backup'), 'This is an export, not a BuildBox Backup'],
      [packageProblem('not-a-backup'), "This file can't be restored"],
      [
        {
          kind: 'package',
          problem: { code: 'newer-package', detail: { detected: 2, supported: 1 } },
        } as unknown as RestoreProblem,
        'This Backup was saved by a newer BuildBox',
      ],
      [packageProblem('preview-package'), 'This Backup came from a preview build'],
      [{ kind: 'unverified' }, "The restored Project couldn't be verified"],
      [{ kind: 'media' }, "This file can't be restored"],
      [{ kind: 'session', error: 'guarded' }, "This file can't be restored"],
    ]
    for (const [refusal, heading] of cases) {
      const test = createTestLibrary(FIXTURE)
      test.failRestore(refusal)
      const view = render(<LibraryHome services={test.services} />)
      await flush()
      await pickFile(test)
      const dialog = await screen.findByRole('dialog', { name: heading })
      expect(dialog).toHaveTextContent('Restore Backup')
      expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument()
      view.unmount()
    }
  })

  it('names the failing check in plain words (#50 criterion 8)', async () => {
    const test = createTestLibrary(FIXTURE)
    test.failRestore(packageProblem('hash-mismatch'))
    render(<LibraryHome services={test.services} />)
    await flush()
    await pickFile(test)
    expect(await screen.findByText('The content hash check failed. Nothing was changed.')).toBeInTheDocument()
  })

  it('offers the two collision answers and a Cancel that changes nothing (#50 criterion 18)', async () => {
    const test = createTestLibrary(FIXTURE)
    test.stageAnswer({
      staged: STAGED,
      collision: { existing: record({ id: 'home', name: 'Tiong Bahru Home' }), copyName: 'Restored Flat — Copy' },
    })
    render(<LibraryHome services={test.services} />)
    await flush()
    await pickFile(test)
    const dialog = await screen.findByRole('dialog', { name: 'This Project already exists here' })
    expect(within(dialog).getByText('Restore Backup')).toBeInTheDocument()
    expect(dialog).toHaveTextContent(
      'The backup for Restored Flat has the same Project identity as a local Project. It passed validation and migration.',
    )
    expect(within(dialog).getByText('Restored Flat')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Create “Restored Flat — Copy” and assign new IDs to every owned record.'),
    ).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel—change nothing' }))
    await flush()
    expect(test.calls.commit).toEqual([])
    expect(screen.queryByRole('dialog', { name: 'This Project already exists here' })).toBeNull()

    await pickFile(test, 2)
    fireEvent.click(screen.getByRole('button', { name: /Replace existing Project/ }))
    await waitFor(() => expect(test.calls.commit).toHaveLength(1))
    await flush()
    expect(test.calls.commit[0]).toMatchObject({ decision: 'replace' })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Backup restored over Restored Flat. Previous state saved as Recovery Point.',
    )

    await pickFile(test, 3)
    fireEvent.click(screen.getByRole('button', { name: /Import as a copy/ }))
    await waitFor(() => expect(test.calls.commit).toHaveLength(2))
    await flush()
    expect(test.calls.commit[1]).toMatchObject({ decision: 'copy' })
    expect(screen.getByRole('status')).toHaveTextContent('Imported as “Restored Flat” with new IDs.')
  })
})

/** A `package` refusal, built without naming `package`'s own type — `ui` may not reach it. */
const packageProblem = (code: string): RestoreProblem =>
  ({ kind: 'package', problem: { code } }) as unknown as RestoreProblem

/**
 * Hand the hidden file input a picked Backup, which is the only way into a restore, and wait for
 * `stageRestore` to have been asked. The count is a parameter because a test that picks twice has
 * to wait for the second answer, not for the first one it already had.
 */
async function pickFile(test: TestLibrary, times = 1): Promise<void> {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['not really a backup'], 'a.buildbox', { type: 'application/zip' })
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(test.calls.stage).toHaveLength(times))
  await flush()
}
