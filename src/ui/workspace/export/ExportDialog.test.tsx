/**
 * The `Export…` dialog as a form (#61 §12–§17, criteria 9, 13, 15).
 *
 * What is pinned here is what only the dialog can pin: the defaults a person meets, the sentences
 * that must be on screen before a file exists, the two things that block an export and the one-click
 * fixes that unblock the second, and the fact that the dialog itself writes nothing — it calls
 * `port.remember` and `port.run` and is otherwise inert.
 *
 * The port is a fake. The real one reaches `platform`, `persistence` and `session`, none of which a
 * form test should meet; the byte-for-byte identity of the Worker path and the main-thread path is
 * `src/app`'s and the browsers' concern, not this file's.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExportDialog } from './ExportDialog'
import { viewKey } from './port'
import type { ExportPort, ExportRunOutcome, ExportableView } from './port'
import type { ExportFailure, ExportProgress, Recipe, RecipeViewRef } from '../../../export'

const ORIGIN: RecipeViewRef = { kind: 'plan', viewId: 'v-1' }
const OTHER: RecipeViewRef = { kind: 'plan', viewId: 'v-2' }
/** A 4 m × 3 m Floor: 400 mm wide at 1:10, 40 mm at 1:100, so 1:10 cannot hold A4 and 1:100 can. */
const BOUNDS = { x: 0, y: 0, w: 4000, h: 3000 }

interface Fake {
  readonly port: ExportPort
  readonly runs: Recipe[]
  readonly remembered: Recipe[]
  setOutcome(outcome: ExportRunOutcome): void
  /** The dialog's own progress callback, once a run has started. */
  progress(progress: ExportProgress): void
}

function fakePort(options?: {
  views?: readonly ExportableView[]
  bounds?: { x: number; y: number; w: number; h: number } | null
  remembered?: Recipe | null
}): Fake {
  const runs: Recipe[] = []
  const remembered: Recipe[] = []
  let outcome: ExportRunOutcome = { kind: 'cancelled' }
  let resolveRun: ((value: ExportRunOutcome) => void) | null = null
  let emit: ((progress: ExportProgress) => void) | null = null
  return {
    runs,
    remembered,
    setOutcome(next) {
      outcome = next
      resolveRun?.(next)
      resolveRun = null
    },
    progress(progress) {
      // A progress tick is the Worker talking, not the person clicking, so it arrives outside
      // React's own batching and has to be announced to it.
      act(() => {
        emit?.(progress)
      })
    },
    port: {
      views: () => options?.views ?? [
        { ref: ORIGIN, label: 'Floor plan', group: 'Ground floor' },
        { ref: OTHER, label: 'Second plan', group: 'Ground floor' },
      ],
      measure: () => Promise.resolve({ bounds: options?.bounds === undefined ? BOUNDS : options.bounds }),
      unacknowledgedWarnings: () => 0,
      recall: () => Promise.resolve(options?.remembered ?? null),
      remember: (_key, recipe) => {
        remembered.push(recipe)
      },
      run: (recipe, onProgress) => {
        runs.push(recipe)
        emit = onProgress
        return new Promise<ExportRunOutcome>((resolve) => {
          resolveRun = () => resolve(outcome)
        })
      },
      cancel: vi.fn(),
    },
  }
}

async function open(
  port: ExportPort,
  options?: { unsavedChanges?: boolean; onClose?: () => void; origin?: RecipeViewRef },
): Promise<void> {
  render(
    <ExportDialog
      origin={options?.origin ?? ORIGIN}
      unit="mm"
      precision={0}
      unsavedChanges={options?.unsavedChanges ?? false}
      port={port}
      onClose={options?.onClose ?? (() => {})}
    />,
  )
  // The dialog measures the view and reads the remembered recipe, so both land after the first
  // paint. Awaiting the button settles them inside `act` rather than in the middle of the next
  // assertion.
  await screen.findByTestId('export-run')
}

const RECIPE = (overrides: Partial<Recipe> = {}): Recipe => ({
  views: [ORIGIN],
  format: 'svg',
  pageSize: 'A4',
  orientation: 'auto',
  scale: 'fit',
  pngLongEdge: 2048,
  titleBlock: true,
  grid: false,
  unit: 'mm',
  precision: 0,
  ...overrides,
})

describe('the Export dialog', () => {
  it('opens on the view it was called from, as an SVG with a title block', async () => {
    const { port } = fakePort()
    await open(port)
    expect(screen.getByTestId(`export-view-${viewKey(ORIGIN)}`)).toBeChecked()
    expect(screen.getByTestId('export-format')).toHaveValue('svg')
    expect(screen.getByTestId('export-title-block')).toBeChecked()
    expect(screen.getByTestId('export-grid')).not.toBeChecked()
    expect(screen.getByTestId('export-unit-line')).toHaveTextContent('Dimensions in mm')
  })

  it('offers Lists and Handoff pack as tabs that do nothing yet', async () => {
    const { port } = fakePort()
    await open(port)
    expect(screen.getByTestId('export-tab-drawing')).toBeEnabled()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[1]).toBeDisabled()
    expect(tabs[2]).toBeDisabled()
    expect(tabs[1]).toHaveAttribute('title', 'Coming soon')
  })

  it('says what the files carry and how many warnings are unacknowledged', async () => {
    const { port } = fakePort()
    await open(port)
    expect(screen.getByTestId('export-notice-privacy')).toHaveTextContent(
      'Files include the Project name and any label text you typed.',
    )
    expect(screen.getByTestId('export-notice-warnings')).toHaveTextContent(
      '0 unacknowledged warnings in this scope',
    )
    expect(screen.getByTestId('export-backup-link')).toHaveTextContent('Download Backup in the Project Library')
  })

  it('warns about unsaved changes only when there are some', async () => {
    const saved = fakePort()
    const { unmount } = render(
      <ExportDialog origin={ORIGIN} unit="mm" precision={0} unsavedChanges={false} port={saved.port} onClose={() => {}} />,
    )
    expect(screen.queryByTestId('export-notice-unsaved')).toBeNull()
    unmount()
    await open(fakePort().port, { unsavedChanges: true })
    expect(screen.getByTestId('export-notice-unsaved')).toHaveTextContent(
      'Exported from unsaved changes. Download a Backup to keep them.',
    )
  })

  it('says a view with nothing in it still exports', async () => {
    const { port } = fakePort({ bounds: null })
    await open(port)
    await waitFor(() => expect(screen.getByTestId('export-notice-empty')).toBeInTheDocument())
    expect(screen.getByTestId('export-run')).toBeEnabled()
  })

  it('shows the sheet only for PDF, where a page exists', async () => {
    const { port } = fakePort()
    await open(port)
    expect(screen.queryByTestId('export-page-size')).toBeNull()
    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'pdf' } })
    expect(screen.getByTestId('export-page-size')).toBeInTheDocument()
    expect(screen.getByTestId('export-orientation')).toBeInTheDocument()
    expect(screen.getByTestId('export-scale')).toBeInTheDocument()
  })

  it('shows the PNG size only for PNG, and exports one view at a time as PDF', async () => {
    const { port } = fakePort()
    await open(port)
    expect(screen.queryByTestId('export-png-size')).toBeNull()
    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'png' } })
    expect(screen.getByTestId('export-png-size')).toHaveValue('2048')
    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'pdf' } })
    expect(screen.getByTestId('export-notice-privacy')).toBeInTheDocument()
    expect(screen.getByTestId(`export-view-${viewKey(OTHER)}`)).toBeDisabled()
    expect(screen.getByText('PDF exports one view at a time.')).toBeInTheDocument()
  })

  it('blocks an export with no view chosen and says what is missing', async () => {
    const { port } = fakePort()
    await open(port)
    fireEvent.click(screen.getByTestId(`export-view-${viewKey(ORIGIN)}`))
    expect(screen.getByTestId('export-blocked')).toHaveTextContent('Choose at least one view to export.')
    expect(screen.getByTestId('export-run')).toBeDisabled()
  })

  it('blocks a fixed scale that will not fit and offers the fixes', async () => {
    const { port } = fakePort()
    await open(port)
    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'pdf' } })
    fireEvent.change(screen.getByTestId('export-scale'), { target: { value: '10' } })
    await waitFor(() => expect(screen.getByTestId('export-blocked')).toBeInTheDocument())
    expect(screen.getByTestId('export-blocked')).toHaveTextContent('1:10')
    expect(screen.getByTestId('export-run')).toBeDisabled()
    fireEvent.click(screen.getByTestId('export-fix-0'))
    await waitFor(() => expect(screen.queryByTestId('export-blocked')).toBeNull())
    expect(screen.getByTestId('export-run')).toBeEnabled()
  })

  it('leaves a fixed scale that fits unblocked', async () => {
    const { port } = fakePort()
    await open(port)
    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'pdf' } })
    fireEvent.change(screen.getByTestId('export-scale'), { target: { value: '100' } })
    await waitFor(() => expect(screen.getByTestId('export-scale')).toHaveValue('100'))
    expect(screen.queryByTestId('export-blocked')).toBeNull()
  })

  it('runs the recipe it shows and remembers it for this view', async () => {
    const fake = fakePort()
    const onClose = vi.fn()
    await open(fake.port, { onClose })
    fireEvent.click(screen.getByTestId('export-grid'))
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(fake.runs).toHaveLength(1))
    expect(fake.runs[0]).toMatchObject({ views: [ORIGIN], format: 'svg', grid: true, titleBlock: true })
    expect(fake.remembered).toEqual(fake.runs)
    fake.setOutcome({ kind: 'downloaded', files: 2, missingGlyphs: [] })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('stays open when a label could not be drawn, and names it', async () => {
    const fake = fakePort()
    const onClose = vi.fn()
    await open(fake.port, { onClose })
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(fake.runs).toHaveLength(1))
    fake.setOutcome({ kind: 'downloaded', files: 2, missingGlyphs: ['Bench 🔧'] })
    await waitFor(() => expect(screen.getByTestId('export-notice-glyphs')).toBeInTheDocument())
    expect(screen.getByTestId('export-notice-glyphs')).toHaveTextContent('Bench')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lists what failed and downloads nothing', async () => {
    const fake = fakePort()
    const onClose = vi.fn()
    await open(fake.port, { onClose })
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(fake.runs).toHaveLength(1))
    const failures: readonly ExportFailure[] = [
      { output: 'plan.svg', reason: 'out-of-paper' },
    ]
    fake.setOutcome({ kind: 'failed', failures })
    await waitFor(() => expect(screen.getByTestId('export-failed')).toBeInTheDocument())
    expect(screen.getByTestId('export-failed')).toHaveTextContent('Nothing was downloaded.')
    expect(screen.getByTestId('export-failed')).toHaveTextContent('plan.svg: It does not fit the page at that scale.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers Cancel while a run is in flight, and only then', async () => {
    const fake = fakePort()
    await open(fake.port)
    expect(screen.queryByTestId('export-cancel')).toBeNull()
    fireEvent.click(screen.getByTestId('export-run'))
    expect(screen.getByTestId('export-cancel')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('export-cancel'))
    expect(fake.port.cancel).toHaveBeenCalled()
  })

  it('reports progress as each view is written', async () => {
    const fake = fakePort()
    await open(fake.port)
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(fake.runs).toHaveLength(1))
    fake.progress({ stage: 'drawing', done: 1, total: 2, label: 'Second plan' })
    await waitFor(() => expect(screen.getByTestId('export-run')).toHaveTextContent('Exporting… 1/2'))
    fake.setOutcome({ kind: 'cancelled' })
    await waitFor(() => expect(screen.getByTestId('export-run')).toBeEnabled())
    expect(screen.getByTestId('export-run')).toHaveTextContent('Export')
  })

  it('starts from the recipe this view was last exported with', async () => {
    const fake = fakePort({ remembered: RECIPE({ format: 'pdf', scale: 50, pageSize: 'A3' }) })
    await open(fake.port)
    await waitFor(() => expect(screen.getByTestId('export-format')).toHaveValue('pdf'))
    expect(screen.getByTestId('export-page-size')).toHaveValue('A3')
    expect(screen.getByTestId('export-scale')).toHaveValue('50')
  })

  it('keeps the Project\'s unit and precision over the remembered ones', async () => {
    const fake = fakePort({ remembered: RECIPE({ unit: 'm', precision: 2 }) })
    await open(fake.port)
    await waitFor(() => expect(screen.getByTestId('export-format')).toHaveValue('svg'))
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(fake.runs).toHaveLength(1))
    expect(fake.runs[0]).toMatchObject({ unit: 'mm', precision: 0 })
  })
})
