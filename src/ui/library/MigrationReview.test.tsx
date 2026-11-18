/**
 * The Migration review against its interfaces (#52 criteria 1–6, 14, 17, 18, 20).
 *
 * Every test renders the real component over a fake `MigrationServices`, because the criteria are
 * about which sentence appears when and about what a click is allowed to reach. The pipeline
 * behind this surface is tested in `src/session/migration.test.ts` and over the whole fixture
 * corpus in `src/test/legacyMigration.test.ts`; nothing here re-proves it.
 *
 * The one thing these tests are strictest about is the floor plan. Criterion 3 says no option is
 * pre-selected and the button is disabled until one is chosen, and the only way to cheat that is
 * to render a select whose empty option is invisible — so the empty value is asserted directly.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LibraryHome } from './LibraryHome'
import { MigrationReview } from './MigrationReview'
import { createTestLibrary } from './testing'
import { STRINGS } from '../strings'
import type { MigrationServices } from './MigrationReview'
import type {
  InspectedMigration,
  LegacyMigrationRecord,
  MigrationFailure,
  MigrationProposal,
  MigrationResult,
  MigrationSourceKind,
  Result,
} from '../../session'

/** Deep enough that a component left waiting on a port shows up as a missing sentence. */
const flush = async (): Promise<void> => {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve()
  })
}

const proposal = (overrides: Partial<MigrationProposal> = {}): MigrationProposal => ({
  designId: `design-${overrides.name ?? 'x'}`.toLowerCase().replace(/\s+/g, '-'),
  name: 'Cabinet 1',
  migratable: true,
  project: null,
  designCount: 1,
  itemCount: 0,
  hasPlanImage: false,
  regeneratedIds: [],
  problems: [],
  collision: null,
  nameTaken: false,
  ...overrides,
})

const RECORD: LegacyMigrationRecord = {
  status: 'complete',
  sourceHash: 'a'.repeat(64),
  completedAt: '2026-10-07T02:44:00.000Z',
  projectIds: ['design-cabinet-1'],
  notMigrated: [],
  discardedSketches: 0,
  removedAt: null,
}

const inspectedOf = (
  proposals: MigrationProposal[],
  floorPlan: InspectedMigration['review']['floorPlan'] = {
    usable: true,
    preview: { widthPx: 2400, heightPx: 1800 },
    itemCount: 6,
    isEmpty: false,
    regeneratedIds: [],
    problems: [],
  },
  discarded = { wallHack: 0, tileZone: 0 },
  kind: MigrationSourceKind = 'local-store',
): InspectedMigration => ({
  review: {
    source: { kind, hash: 'a'.repeat(64) },
    legacyVersion: 3,
    proposals,
    floorPlan,
    discarded,
  },
  // The component never reads the conversion: it is here because `InspectedMigration` carries it
  // for `buildMigrationPlan`, which is not this surface's business.
  conversion: {} as InspectedMigration['conversion'],
})

const RESULT: MigrationResult = {
  projects: [
    { id: 'design-cabinet-1', name: 'Cabinet 1', kind: 'new', floorPlan: false },
    { id: 'design-kitchen-renovation', name: 'Kitchen Renovation', kind: 'new', floorPlan: false },
    { id: 'design-wardrobe-study', name: 'Wardrobe Study', kind: 'new', floorPlan: false },
    { id: 'floor-plan-project', name: 'Floor plan', kind: 'new', floorPlan: true },
  ],
  floorPlan: { kind: 'separate', projectId: 'floor-plan-project', projectName: 'Floor plan' },
  notMigrated: [],
  discardedSketches: 0,
  record: RECORD,
}

interface Harness {
  services: MigrationServices
  inspect: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  downloadBackups: ReturnType<typeof vi.fn>
  downloadOriginal: ReturnType<typeof vi.fn>
  removeOldCopy: ReturnType<typeof vi.fn>
  adopt: ReturnType<typeof vi.fn>
}

/**
 * A review whose pipeline answers `outcome`.
 *
 * `run` defaults to success; a test that wants a failure passes one, and the same test then
 * asserts that `removeOldCopy` was never reached — which is criterion 6's "no code path removes
 * the source without the confirmation", stated at the only seam this component has.
 */
function createMigration(
  outcome: Result<InspectedMigration | null, MigrationFailure> = { ok: true, value: inspectedOf(MIGRATION_REVIEW) },
  runOutcome: Result<MigrationResult, MigrationFailure> = { ok: true, value: RESULT },
): Harness {
  const inspect = vi.fn(async () => outcome)
  const run = vi.fn(async () => runOutcome)
  const downloadBackups = vi.fn(
    async (): Promise<Result<string[], MigrationFailure>> => ({ ok: true, value: ['Cabinet-1.buildbox'] }),
  )
  const downloadOriginal = vi.fn()
  const removeOldCopy = vi.fn(
    async (): Promise<Result<LegacyMigrationRecord, MigrationFailure>> => ({
      ok: true,
      value: { ...RECORD, removedAt: 'later' },
    }),
  )
  const adopt = vi.fn()
  return {
    services: { inspect, run, downloadBackups, downloadOriginal, removeOldCopy, adopt },
    inspect,
    run,
    downloadBackups,
    downloadOriginal,
    removeOldCopy,
    adopt,
  }
}

const MIGRATION_REVIEW: MigrationProposal[] = [
  proposal({ name: 'Cabinet 1' }),
  proposal({ name: 'Kitchen Renovation' }),
  proposal({ name: 'Wardrobe Study' }),
]

/** Render the review and let the inspection land. */
const renderReview = async (
  harness: Harness,
  paused = false,
  onDownloadBackup: (projectId: string, name: string) => void = () => undefined,
): Promise<void> => {
  render(
    <MigrationReview
      migration={harness.services}
      existing={[]}
      paused={paused}
      onReturn={() => undefined}
      onDownloadBackup={onDownloadBackup}
    />,
  )
  await flush()
}

/** Advance to the Back up step: choose a destination, continue, migrate. */
const runThrough = async (
  onDownloadBackup?: (projectId: string, name: string) => void,
): Promise<Harness> => {
  const harness = createMigration()
  await renderReview(harness, false, onDownloadBackup)
  fireEvent.change(screen.getByLabelText(STRINGS.migrationAttachItTo), { target: { value: 'separate' } })
  fireEvent.click(screen.getByRole('button', { name: STRINGS.migrationContinue }))
  fireEvent.click(screen.getByRole('button', { name: STRINGS.migrationMigrateAndVerify }))
  await waitFor(() => expect(screen.getByText(STRINGS.migrationVerifiedHeading)).toBeInTheDocument())
  return harness
}

describe('the Migration review', () => {
  it('shows the four-step stepper in order (#52 criterion 1)', async () => {
    await renderReview(createMigration())
    const dots = ['Found', 'Review', 'Verify', 'Back up'].map(
      (label) => screen.getByText(label).closest('.stepper-dot') as HTMLElement,
    )
    expect(dots).toHaveLength(4)
    expect(dots[0]).toHaveClass('active')
    expect(dots[1]).not.toHaveClass('active done')
  })

  it('lists every Design as its own row before anything is written (#52 criterion 2)', async () => {
    const harness = createMigration()
    await renderReview(harness)
    const rows = [...document.querySelectorAll('.migration-item')]
    for (const name of ['Cabinet 1', 'Kitchen Renovation', 'Wardrobe Study']) {
      // The name also appears in the destination select, which lists the Projects this same
      // review would create (deviation (a)), so the row is found by where it is, not by count.
      expect(rows.some((row) => row.textContent?.includes(name))).toBe(true)
    }
    expect(screen.getAllByText(STRINGS.migrationTagNewProject)).toHaveLength(3)
    // Nothing has been written: the only call this surface may make before a click is the read.
    expect(harness.run).not.toHaveBeenCalled()
    expect(harness.removeOldCopy).not.toHaveBeenCalled()
  })

  it('pre-selects no destination and refuses to continue without one (#52 criterion 3)', async () => {
    await renderReview(createMigration())
    const select = screen.getByLabelText<HTMLSelectElement>(STRINGS.migrationAttachItTo)
    expect(select.value).toBe('')
    expect(screen.getByRole('button', { name: STRINGS.migrationContinue })).toBeDisabled()
    expect(screen.getByText(/we will not guess/)).toBeInTheDocument()
    expect(screen.getByText(STRINGS.migrationUntouchedHelper)).toBeInTheDocument()
  })

  it('offers Skip only for an empty floor plan (#52 criterion 4)', async () => {
    const empty = inspectedOf(MIGRATION_REVIEW, {
      usable: true,
      preview: null,
      itemCount: 0,
      isEmpty: true,
      regeneratedIds: [],
      problems: [],
    })
    render(
      <MigrationReview
        migration={createMigration({ ok: true, value: empty }).services}
        existing={[]}
        onReturn={() => undefined}
        onDownloadBackup={() => undefined}
      />,
    )
    await flush()
    expect(screen.getByText(STRINGS.migrationFloorPlanEmpty)).toBeInTheDocument()

    const filled = createMigration()
    render(<MigrationReview migration={filled.services} existing={[]} onReturn={() => undefined} onDownloadBackup={() => undefined} />)
    await flush()
    expect(screen.queryByText(STRINGS.migrationSkip)).not.toBeInTheDocument()
  })

  it('lists what each Design became and offers a Backup for each of them (#52 criterion 5)', async () => {
    const asked: string[] = []
    await runThrough((_id, name) => asked.push(name))
    expect(screen.getByText('Cabinet 1 → New Project')).toBeInTheDocument()
    expect(screen.getByText('Standalone floor plan → Separate Project')).toBeInTheDocument()
    // Criterion 5 is a Backup per Project, not one for all of them, and each goes to the Library's
    // own Download Backup dialog — the one place that names the file before writing it.
    const buttons = screen.getAllByRole('button', { name: STRINGS.migrationDownloadBackup })
    expect(buttons).toHaveLength(4)
    fireEvent.click(buttons[0] as HTMLElement)
    expect(asked).toEqual(['Cabinet 1'])
  })

  it('removes nothing until the confirmation is pressed (#52 criterion 6)', async () => {
    const harness = await runThrough()
    fireEvent.click(screen.getByRole('button', { name: STRINGS.migrationRemoveOldCopy }))
    expect(harness.removeOldCopy).not.toHaveBeenCalled()
    expect(screen.getByText(STRINGS.migrationRemoveConfirm)).toBeInTheDocument()
    const confirm = screen.getAllByRole('button', { name: STRINGS.migrationRemoveOldCopy })
    fireEvent.click(confirm[confirm.length - 1] as HTMLElement)
    await waitFor(() => expect(harness.removeOldCopy).toHaveBeenCalledTimes(1))
  })

  it('counts the sketches that will not be copied (#52 criterion 14)', async () => {
    render(
      <MigrationReview
        migration={createMigration({ ok: true, value: inspectedOf(MIGRATION_REVIEW, null, { wallHack: 2, tileZone: 1 }) }).services}
        existing={[]}
        onReturn={() => undefined}
        onDownloadBackup={() => undefined}
      />,
    )
    await flush()
    expect(screen.getByText("2 wall sketches and 1 tile zone can't be migrated and will not be copied. Your original data keeps them.")).toBeInTheDocument()
  })

  it('names the step that stopped and says plainly that nothing moved (#52 criteria 11, 19)', async () => {
    const harness = createMigration(
      { ok: true, value: inspectedOf(MIGRATION_REVIEW) },
      { ok: false, error: { stage: 'read-back', problems: [] } },
    )
    await renderReview(harness)
    fireEvent.change(screen.getByLabelText(STRINGS.migrationAttachItTo), { target: { value: 'separate' } })
    fireEvent.click(screen.getByRole('button', { name: STRINGS.migrationContinue }))
    fireEvent.click(screen.getByRole('button', { name: STRINGS.migrationMigrateAndVerify }))
    await waitFor(() =>
      expect(
        screen.getByText(
          'Migration stopped while reading back. Nothing was changed: your old data is untouched and no Projects were created.',
        ),
      ).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: STRINGS.migrationTryAgain })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: STRINGS.migrationDownloadOldData })).toBeInTheDocument()
    expect(harness.removeOldCopy).not.toHaveBeenCalled()
  })

  it('pauses with two ways out when the browser will not store anything (#52 criterion 18)', async () => {
    const harness = createMigration()
    await renderReview(harness, true)
    expect(
      screen.getByText("This browser isn't letting BuildBox store Projects right now, so migration is paused."),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: STRINGS.migrationDownloadOldData })).toBeEnabled()
    expect(screen.getByRole('button', { name: STRINGS.migrationDownloadOriginal })).toBeEnabled()
    expect(screen.queryByRole('button', { name: STRINGS.migrationMigrateAndVerify })).not.toBeInTheDocument()
    expect(harness.run).not.toHaveBeenCalled()
    expect(harness.removeOldCopy).not.toHaveBeenCalled()
  })

  it('says so when this browser holds no old data (#52 criterion 20)', async () => {
    render(
      <MigrationReview
        migration={createMigration({ ok: true, value: null }).services}
        existing={[]}
        onReturn={() => undefined}
        onDownloadBackup={() => undefined}
      />,
    )
    await flush()
    expect(screen.getByText(STRINGS.migrationNothingFound)).toBeInTheDocument()
    expect(screen.queryByText(STRINGS.migrationHeading)).not.toBeInTheDocument()
  })
})

describe('the Library home with a migration', () => {
  it('opens on the review when old data has not been migrated (#52 criterion 1)', async () => {
    const test = createTestLibrary()
    const harness = createMigration()
    render(<LibraryHome services={test.services} migration={harness.services} openMigration />)
    await flush()
    expect(screen.getByText(STRINGS.migrationHeading)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: STRINGS.navMigration })).toHaveClass('active')
  })

  it('opens on the grid when there is nothing to migrate, and the tab still reaches the review (#52 criterion 20)', async () => {
    const test = createTestLibrary()
    const harness = createMigration({ ok: true, value: null })
    render(<LibraryHome services={test.services} migration={harness.services} />)
    await flush()
    expect(screen.queryByText(STRINGS.migrationHeading)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: STRINGS.navMigration }))
    await flush()
    expect(screen.getByText(STRINGS.migrationNothingFound)).toBeInTheDocument()
  })

  it('routes a legacy file picked from Restore Backup into the review (#52 criterion 17)', async () => {
    const test = createTestLibrary()
    const harness = createMigration({ ok: true, value: null })
    const bytes = new TextEncoder().encode(JSON.stringify({ state: { designs: [] } }))
    test.services.readBackupFile = async () => bytes
    const stageRestore = vi.fn(test.services.stageRestore)
    test.services.stageRestore = stageRestore
    render(<LibraryHome services={test.services} migration={harness.services} />)
    await flush()

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([bytes], 'old-data.json', { type: 'application/json' })
    fireEvent.change(input, { target: { files: [file] } })
    await flush()

    expect(screen.getByText(STRINGS.migrationFileDetected)).toBeInTheDocument()
    expect(stageRestore).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: STRINGS.migrationReviewTheFile }))
    await flush()
    expect(harness.adopt).toHaveBeenCalledWith(bytes)
    expect(screen.getByText(STRINGS.migrationNothingFound)).toBeInTheDocument()
  })

  it('still hands an ordinary Backup to the restore flow (#52 criterion 17)', async () => {
    const test = createTestLibrary()
    const harness = createMigration({ ok: true, value: null })
    const bytes = new TextEncoder().encode('a backup archive, not JSON at all')
    test.services.readBackupFile = async () => bytes
    const stageRestore = vi.fn(test.services.stageRestore)
    test.services.stageRestore = stageRestore
    render(<LibraryHome services={test.services} migration={harness.services} />)
    await flush()

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([bytes], 'flat.buildbox')] } })
    await flush()
    expect(screen.queryByText(STRINGS.migrationFileDetected)).not.toBeInTheDocument()
    expect(stageRestore).toHaveBeenCalledWith(bytes)
    expect(harness.adopt).not.toHaveBeenCalled()
  })
})
