/**
 * #73 §1–3 through the real dialog with the flag on: the layer chips a view starts from, the
 * composition the sheet will record, the scope the Lists tab opens with, and the one blocking
 * error a Display with no Option raises. The flag-off half of the dialog lives in
 * `ExportDialog.test.tsx`; this is the half `VITE_FF_RENOVATION` lights up, so it runs in the
 * `renovation-dom` project (`npm run test:renovation`).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExportDialog } from './ExportDialog'
import type { BlockedView, ExportPort, ExportRunOutcome, ExportableView, ListsOptions } from './port'
import type {
  DrawingLayerChip,
  DrawingToggles,
  ListsRecipe,
  ListsSummary,
  Recipe,
  RecipeViewRef,
  RecordedComposition,
} from '../../../export'

const ORIGIN: RecipeViewRef = { kind: 'plan', viewId: 'v-1' }
const BOUNDS = { x: 0, y: 0, w: 4000, h: 3000 }
const VIEW_NAME = 'Ground Floor · Plan · Demolition'

/** The view hides Furniture, so the chips must start with it off (#73 §1). */
const CHIPS: readonly DrawingLayerChip[] = [
  { id: 'l-1', name: 'Structure', visible: true },
  { id: 'l-2', name: 'Furniture', visible: false },
  { id: 'unlayered', name: 'Unlayered', visible: true },
]

/** Two Options, the view on the first, and one Drawing Layer besides `Unlayered`. */
const OPTIONS: ListsOptions = {
  floors: [{ id: 'f-1', label: 'Ground Floor' }],
  designOptions: [
    { id: 'option-a', label: 'Option A · Open kitchen' },
    { id: 'option-b', label: 'Option B · Widened opening' },
  ],
  layers: [
    { id: 'l-1', label: 'Structure' },
    { id: 'unlayered', label: 'Unlayered' },
  ],
  defaultScope: {
    floorIds: ['f-1'],
    designOptionIds: ['option-a'],
    renovationStates: ['existing', 'demolition', 'proposed'],
    drawingLayers: 'all',
  },
}

const COMPOSITION: RecordedComposition = {
  view_id: 'v-1',
  view_name: VIEW_NAME,
  design_option_id: 'option-a',
  renovation_display: 'demolition',
  layer_order: [
    { id: 'l-1', name: 'Structure' },
    { id: 'unlayered', name: 'Unlayered' },
  ],
  included_layers: [{ id: 'l-1', name: 'Structure' }],
  color_overrides: [],
  notes: { overlay: false },
}

/** Four Placed Items in scope, all four of them hidden by the view the dialog was opened from. */
const SUMMARY: ListsSummary = {
  statement: 'Floor plan · Ground Floor · Option A · Existing, Demolition, Proposed · Structure, Unlayered',
  rows: { items: 4, 'cut-list': 0, rooms: 2, walls: 6, openings: 1, 'placed-items': 4, warnings: 0 },
  cutListCapable: false,
  hiddenInView: { count: 4, refs: ['Sofa', 'Armchair', 'Floor lamp', 'Side table'] },
}

const CANCELLED: ExportRunOutcome = { kind: 'cancelled' }

interface Answers {
  chips?: readonly DrawingLayerChip[]
  composition?: RecordedComposition | null
  blocked?: BlockedView | null
  listsOptions?: ListsOptions
  summary?: ListsSummary
}

/**
 * The port the dialog talks to, answering from the fixtures above and recording what it was asked
 * to do. Nothing here mutates a snapshot: the only writes a test can see are the recipe the person
 * pressed Export with and the recipe the dialog was told to remember.
 */
function portFor(answers: Answers = {}): {
  port: ExportPort
  runs: Recipe[]
  listsRuns: ListsRecipe[]
  saved: Recipe[]
  views: readonly ExportableView[]
} {
  const runs: Recipe[] = []
  const listsRuns: ListsRecipe[] = []
  const saved: Recipe[] = []
  const views: readonly ExportableView[] = [{ ref: ORIGIN, label: VIEW_NAME, group: 'Ground Floor' }]
  const port: ExportPort = {
    views: () => views,
    measure: () => Promise.resolve({ bounds: BOUNDS }),
    unacknowledgedWarnings: () => 0,
    recall: () => Promise.resolve(null),
    remember: (_key, recipe) => {
      saved.push(recipe)
    },
    run: (recipe) => {
      runs.push(recipe)
      return Promise.resolve(CANCELLED)
    },
    listsOptions: () => Promise.resolve(answers.listsOptions ?? OPTIONS),
    drawingLayers: () => Promise.resolve(answers.chips ?? CHIPS),
    composition: (_ref, toggles) => Promise.resolve(record(answers.composition ?? COMPOSITION, toggles)),
    blocking: () => Promise.resolve(answers.blocked ?? null),
    summariseLists: () => Promise.resolve(answers.summary ?? SUMMARY),
    recallLists: () => Promise.resolve(null),
    rememberLists: () => {},
    runLists: (recipe) => {
      listsRuns.push(recipe)
      return Promise.resolve(CANCELLED)
    },
    cancel: () => {},
  }
  return { port, runs, listsRuns, saved, views }
}

/** What the composition would be with these toggles — the same answer the writer would record. */
function record(base: RecordedComposition, toggles: DrawingToggles): RecordedComposition {
  if (toggles.layers === undefined) return base
  const kept = base.layer_order.filter((layer) => toggles.layers?.includes(layer.id))
  return { ...base, included_layers: kept }
}

const checked = (testId: string): boolean => (screen.getByTestId(testId) as HTMLInputElement).checked
const disabled = (testId: string): boolean => (screen.getByTestId(testId) as HTMLInputElement).disabled

/** Flush the promises the dialog's effects start, inside `act` so React hears about the answers. */
async function settle(): Promise<void> {
  await act(async () => {
    // The executor form, not `Promise.withResolvers`: the project's lib is ES2022.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}

async function open(port: ExportPort, onOpenView?: (viewId: string) => void): Promise<void> {
  render(
    <ExportDialog
      origin={ORIGIN}
      unit="mm"
      precision={0}
      unsavedChanges={false}
      port={port}
      onOpenView={onOpenView}
      onClose={() => {}}
    />,
  )
  await screen.findByTestId('export-run')
  await settle()
}

async function openLists(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('export-tab-lists'))
  })
  await settle()
}

describe('the Export dialog with renovation on', () => {
  it('starts the layer chips from the saved view and keeps a toggle inside the recipe', async () => {
    const { port, runs, views } = portFor()
    await open(port)

    expect(screen.getByTestId('export-layers-start')).toHaveTextContent(
      `Starts from the saved view. Toggles here are temporary and don't change “${VIEW_NAME}”.`,
    )
    expect(checked('export-layer-l-1')).toBe(true)
    expect(checked('export-layer-l-2')).toBe(false)
    expect(checked('export-layer-unlayered')).toBe(true)
    // The chip that has nothing to overlay yet is there and cannot be moved (#80, #81).
    expect(disabled('export-layer-notes')).toBe(true)

    fireEvent.click(screen.getByTestId('export-layer-l-2'))
    expect(checked('export-layer-l-2')).toBe(true)

    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(runs).toHaveLength(1))
    // The toggle is a recipe field and nothing else: the view Export was offered is the saved one,
    // with no toggles on it, because the dialog never writes to the view it came from.
    expect(runs[0]?.views).toEqual([{ kind: 'plan', viewId: 'v-1', toggles: { layers: ['l-1', 'unlayered', 'l-2'] } }])
    expect(views[0]?.ref).toEqual({ kind: 'plan', viewId: 'v-1' })
  })

  it('shows the composition the sheet will record', async () => {
    const { port } = portFor()
    await open(port)

    const block = screen.getByTestId('export-composition')
    expect(block).toHaveTextContent('Recorded composition (repeat export is deterministic):')
    expect(block).toHaveTextContent(VIEW_NAME)
    // The Option by its name, not its ID, and the Display by the word the mode bar uses.
    expect(block).toHaveTextContent('Option A · Open kitchen')
    expect(block).toHaveTextContent('Demolition')
    expect(block).toHaveTextContent('Structure, Unlayered')
    expect(block).toHaveTextContent('Colour overrides')
    expect(block).toHaveTextContent('none')
    expect(block).toHaveTextContent('off')
  })

  it('blocks a Display with no Option and opens the view that needs one', async () => {
    const onOpenView = vi.fn()
    const { port } = portFor({
      blocked: { viewId: 'v-2', viewName: 'First floor · Plan', display: 'proposed' },
    })
    await open(port, onOpenView)

    expect(screen.getByTestId('export-blocked')).toHaveTextContent(
      'First floor · Plan: Proposed display needs an active Design Option.',
    )
    expect(screen.getByTestId('export-run')).toBeDisabled()

    fireEvent.click(screen.getByTestId('export-open-view'))
    expect(onOpenView).toHaveBeenCalledWith('v-2')
  })

  it('names the blocked view and offers no way out where there is no workspace to move', async () => {
    const { port } = portFor({ blocked: { viewId: 'v-2', viewName: 'First floor · Plan', display: 'combined' } })
    await open(port)
    expect(screen.getByTestId('export-blocked')).toHaveTextContent('Combined display needs an active Design Option.')
    expect(screen.queryByTestId('export-open-view')).toBeNull()
    expect(screen.getByTestId('export-run')).toBeDisabled()
  })

  it('opens the Lists tab on the view’s own Option and follows the radio group', async () => {
    const { port, listsRuns } = portFor()
    await open(port)
    await openLists()

    expect(screen.getByTestId('export-lists-scope-explicit')).toHaveTextContent(
      'Data exports never inherit view hiding. Scope is explicit:',
    )
    expect(checked('export-lists-option-this')).toBe(true)
    expect(screen.getByTestId('export-lists-options')).toHaveTextContent('This option: Option A · Open kitchen')
    expect(screen.queryByTestId('export-lists-option-list')).toBeNull()

    // `Existing Model only` is the whole scope, so every State is in it and none can be moved.
    fireEvent.click(screen.getByTestId('export-lists-option-existing'))
    expect(checked('export-lists-state-existing')).toBe(true)
    expect(disabled('export-lists-state-existing')).toBe(true)
    expect(disabled('export-lists-state-proposed')).toBe(true)

    fireEvent.click(screen.getByTestId('export-lists-option-choose'))
    expect(screen.getByTestId('export-lists-option-list')).toBeInTheDocument()
    // A comparison starts with every Option in; the person removes the ones not being compared.
    expect(checked('export-lists-option-option-a')).toBe(true)
    expect(checked('export-lists-option-option-b')).toBe(true)
    fireEvent.click(screen.getByTestId('export-lists-option-option-a'))
    expect(checked('export-lists-option-option-a')).toBe(false)
    expect(screen.getByTestId('export-lists-option-choose')).toBeChecked()

    fireEvent.click(screen.getByTestId('export-lists-run'))
    await waitFor(() => expect(listsRuns).toHaveLength(1))
    expect(listsRuns[0]?.scope.designOptionIds).toEqual(['option-b'])
  })

  it('counts the rows the view hides without narrowing the scope', async () => {
    const { port, listsRuns } = portFor()
    await open(port)
    await openLists()

    const notice = screen.getByTestId('export-lists-notice-hidden')
    expect(notice).toHaveTextContent('4 items included that are hidden in this view')
    expect(notice).toHaveTextContent('Sofa')
    expect(notice).toHaveTextContent('Side table')

    // Informational only: the scope the person chose is what goes in the file, notice or no notice.
    fireEvent.click(screen.getByTestId('export-lists-run'))
    await waitFor(() => expect(listsRuns).toHaveLength(1))
    expect(listsRuns[0]?.scope).toEqual(OPTIONS.defaultScope)
  })

  it('says nothing about hidden rows when the view hides none', async () => {
    const { port } = portFor({ summary: { ...SUMMARY, hiddenInView: { count: 0, refs: [] } } })
    await open(port)
    await openLists()
    expect(screen.queryByTestId('export-lists-notice-hidden')).toBeNull()
  })

  it('lists the Project’s layers with everything on when the scope has no opinion', async () => {
    const { port, listsRuns } = portFor()
    await open(port)
    await openLists()
    expect(checked('export-lists-layer-l-1')).toBe(true)
    expect(checked('export-lists-layer-unlayered')).toBe(true)
    fireEvent.click(screen.getByTestId('export-lists-layer-l-1'))
    fireEvent.click(screen.getByTestId('export-lists-run'))
    await waitFor(() => expect(listsRuns).toHaveLength(1))
    expect(listsRuns[0]?.scope.drawingLayers).toEqual({ layerIds: [], includeUnlayered: true })
  })

  it('keeps the whole layer set when every layer is ticked back on', async () => {
    const { port, listsRuns } = portFor()
    await open(port)
    await openLists()
    fireEvent.click(screen.getByTestId('export-lists-layer-l-1'))
    fireEvent.click(screen.getByTestId('export-lists-layer-l-1'))
    fireEvent.click(screen.getByTestId('export-lists-run'))
    await waitFor(() => expect(listsRuns).toHaveLength(1))
    expect(listsRuns[0]?.scope.drawingLayers).toBe('all')
  })
})
