/**
 * The Notes switches and the Comment Register through the real workspace (#83 criteria 1, 5, 6, 7, 8, 12).
 *
 * The dialog's own tests hold it in a hand and pull its strings; what only a rendered workspace can
 * show is the round trip a person makes: the toolbar's Export opens on the view they were looking at,
 * the three chips change the recipe and nothing else, the file is asked for with those three answers
 * in it, the Project document is byte-for-byte the document it was before the dialog opened, and the
 * next time they open the dialog the switches are where they left them.
 *
 * The port is a recording one — jsdom composes no sheet and downloads no file — but it records the
 * recipe verbatim, so every assertion below is about what the real dialog handed the real export code.
 * The sheet's own pixels and the Register's own bytes are pinned in `src/export/notesExport.test.ts`,
 * `src/export/comments.test.ts` and the browser smoke spec.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { ListsRecipe, NotesSwitches, Recipe, RecipeViewRef, RecordedComposition, TableId } from '../export'
import type { DrawingLayerChip, ListsSummary } from '../export'
import type { Project } from '../domain'
import type { QuantityScope } from '../derive'
import type { DisplayList } from '../drawing'
import { flush } from '../session/testing'
import {
  notesSessionStore,
  PLAN_IMAGE_ACCEPT,
  WorkspaceProvider,
  workspaceStore,
  type BlockedView,
  type ExportPort,
  type ExportPreview,
  type ExportRunOutcome,
  type ListsOptions,
  type Viewport,
  type ViewportCache,
  type WorkspaceServices,
} from '../ui'
import { openTestView, renderWithBindings as render, type TestView } from '../ui/legacy/testing'

if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const PLAN_REF: RecipeViewRef = { kind: 'plan', viewId: 'seed-view-001' }

function sceneProject(): Project {
  const text = readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'notes-review-scene.json'), 'utf8')
  const envelope = JSON.parse(text) as { projects: { data: Project }[] }
  return structuredClone(envelope.projects[0]!.data)
}

/** A sheet with nothing on it: the preview's pixels are pinned elsewhere, its presence is what matters. */
const EMPTY_LIST: DisplayList = {
  space: 'floor',
  bounds: { x: 0, y: 0, w: 297, h: 210 },
  layers: [{ key: 'plan-notes', items: [] }],
  missingGlyphs: [],
}

const SCOPE: QuantityScope = {
  floorIds: ['seed-001', 'seed-floor-002'],
  designOptionIds: 'existing-only',
  renovationStates: ['existing', 'proposed', 'demolition'],
  drawingLayers: 'all',
}

/** Stands for a scope the Comments do not reach: the summary answers with no rows at all. */
let noCommentsInScope = false

const SUMMARY: ListsSummary = {
  statement: 'Both Floors · Existing Model only',
  commentStatement: 'Both Floors · Existing Model only · Open Comments',
  rows: {
    items: 4,
    'cut-list': 2,
    rooms: 2,
    walls: 6,
    openings: 1,
    beams: 0,
    skirting: 0,
    services: 0,
    'placed-items': 5,
    warnings: 0,
    comments: 5,
  },
  cutListCapable: true,
  hiddenInView: { count: 0, refs: [] },
}

/** What the dialog asked the export code for, in the order it asked. */
interface Recorded {
  readonly previews: NotesSwitches[]
  readonly compositions: NotesSwitches[]
  readonly runs: Recipe[]
  readonly summaries: boolean[]
  readonly listRuns: ListsRecipe[]
  readonly remembered: Recipe[]
  readonly rememberedLists: ListsRecipe[]
}

function recordingPort(record: Recorded, memory: Map<string, Recipe>, listMemory: Map<string, ListsRecipe>): ExportPort {
  const outcome: ExportRunOutcome = { kind: 'downloaded', files: 1, missingGlyphs: [] }
  const composition: RecordedComposition = {
    view_id: 'seed-view-001',
    view_name: 'Floor 1',
    design_option_id: null,
    renovation_display: 'existing',
    layer_order: [{ id: 'unlayered', name: 'Unlayered' }],
    included_layers: [{ id: 'unlayered', name: 'Unlayered' }],
    color_overrides: [],
    notes: { view_annotations: true, comment_pins: false, include_resolved_pins: false },
  }
  return {
    views: () => [{ ref: PLAN_REF, label: 'Floor 1', group: 'Floor 1' }],
    measure: async () => ({ bounds: { x: 0, y: 0, w: 4000, h: 3000 } }),
    unacknowledgedWarnings: () => 0,
    recall: async (key) => memory.get(key) ?? null,
    remember: (key, recipe) => {
      record.remembered.push(recipe)
      memory.set(key, recipe)
    },
    run: async (_recipe, onProgress) => {
      record.runs.push(_recipe)
      onProgress({ stage: 'file', done: 1, total: 1, label: 'Floor 1' })
      return outcome
    },
    listsOptions: async (): Promise<ListsOptions> => ({
      floors: [
        { id: 'seed-001', label: 'Floor 1' },
        { id: 'seed-floor-002', label: 'Floor 2' },
      ],
      designOptions: [],
      layers: [{ id: 'unlayered', label: 'Unlayered' }],
      defaultScope: SCOPE,
    }),
    drawingLayers: async (): Promise<readonly DrawingLayerChip[]> => [{ id: 'unlayered', name: 'Unlayered', visible: true }],
    composition: async (_ref, _toggles, notes) => {
      if (notes !== undefined) record.compositions.push(notes)
      return { ...composition, notes: { view_annotations: notes?.viewAnnotations ?? true, comment_pins: notes?.commentPins ?? false, include_resolved_pins: notes?.includeResolvedPins ?? false } }
    },
    preview: async (_ref, recipe) => {
      record.previews.push(recipe.notes ?? { viewAnnotations: true, commentPins: false, includeResolvedPins: false })
      const preview: ExportPreview = { list: EMPTY_LIST, widthMm: 297, heightMm: 210 }
      return preview
    },
    blocking: async (): Promise<BlockedView | null> => null,
    summariseLists: async (_scope, _origin, includeResolvedComments) => {
      record.summaries.push(includeResolvedComments)
      // A scope the Comments do not reach answers with no rows at all — the file behind it is a header.
      if (noCommentsInScope) return { ...SUMMARY, rows: { ...SUMMARY.rows, comments: 0 } }
      return includeResolvedComments
        ? { ...SUMMARY, commentStatement: 'Both Floors · Existing Model only · Open and Resolved Comments', rows: { ...SUMMARY.rows, comments: 8 } }
        : SUMMARY
    },
    recallLists: async (key) => listMemory.get(key) ?? null,
    rememberLists: (key, recipe) => {
      record.rememberedLists.push(recipe)
      listMemory.set(key, recipe)
    },
    runLists: async (recipe) => {
      record.listRuns.push(recipe)
      return { ...outcome, files: 10 }
    },
    cancel: () => {},
  }
}

let view: TestView
let record: Recorded
let memory: Map<string, Recipe>
let listMemory: Map<string, ListsRecipe>
let documentBefore: string
let revisionBefore: number

async function renderWorkspace(): Promise<void> {
  view = await openTestView(sceneProject())
  workspaceStore.getState().reset()
  notesSessionStore.getState().reset()
  record = { previews: [], compositions: [], runs: [], summaries: [], listRuns: [], remembered: [], rememberedLists: [] }
  memory = new Map()
  listMemory = new Map()
  const cache = new Map<string, Viewport>()
  const viewportCache: ViewportCache = {
    read: async (viewKey) => cache.get(viewKey),
    write: (viewKey, viewport) => {
      cache.set(viewKey, viewport)
    },
    readActive: async () => null,
    writeActive: () => {},
    readPane: async () => null,
    writePane: () => {},
  }
  const services: WorkspaceServices = {
    intent: view.services.intent,
    assetUrls: view.services.assetUrls,
    now: () => '2026-01-01T00:00:00.000Z',
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [{ key: 'sofa-2', label: 'Sofa 2-seater' }],
    viewportCache,
    exportDrawings: recordingPort(record, memory, listMemory),
  }
  documentBefore = JSON.stringify(view.session.getSnapshot().project)
  revisionBefore = view.session.getSnapshot().revision
  render(
    <WorkspaceProvider
      session={view.session}
      services={services}
      onReturnToProjects={view.returnToProjects}
      onShowSaveFailure={() => {}}
    >
      <App />
    </WorkspaceProvider>,
    view,
  )
}

/** Every test ends here: the write settles inside `act`, or CI reads it as a warning. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await flush()
  })
}

const chip = (which: 'annotations' | 'pins' | 'resolved'): HTMLElement => screen.getByTestId(`export-notes-${which}`)
const checked = (element: HTMLElement): boolean => (element as HTMLInputElement).checked
/** The most recent entry of a recording: the answer the controls settled on. */
function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1]
}

async function openDialog(): Promise<void> {
  await userEvent.click(screen.getByTestId('export-open'))
  await settle()
}

async function closeDialog(): Promise<void> {
  // A run that wrote its files closes the dialog itself, and the Lists tab has no footer of its own
  // while it is open: the Close button belongs to the Drawing tab.
  if (screen.queryByTestId('export-tabs') === null) return
  await userEvent.click(screen.getByTestId('export-tab-drawing'))
  await settle()
  await userEvent.click(screen.getByTestId('export-close'))
  await settle()
}

async function run(): Promise<void> {
  await userEvent.click(screen.getByTestId('export-run'))
  await settle()
}

beforeEach(async () => {
  await renderWorkspace()
})

describe('the Notes switches (#83 criteria 1, 5, 6, 7, 8)', () => {
  it('opens on the contract’s defaults, with the Resolved chip unable to be pressed', async () => {
    await openDialog()
    expect(checked(chip('annotations'))).toBe(true)
    expect(checked(chip('pins'))).toBe(false)
    expect(checked(chip('resolved'))).toBe(false)
    // Criterion 1: a Resolved pin without any pin is not a question worth asking, so the control
    // that would ask it is disabled rather than quietly ignored.
    expect(chip('resolved')).toBeDisabled()
    expect(screen.getByTestId('export-preview-svg')).toBeInTheDocument()
    expect(last(record.previews)).toEqual({ viewAnnotations: true, commentPins: false, includeResolvedPins: false })
    await settle()
  })

  it('sends the three switches with the file and records them in the recipe (#83 criteria 2, 8)', async () => {
    await openDialog()
    await userEvent.click(chip('pins'))
    await settle()
    await userEvent.click(chip('resolved'))
    await settle()
    await run()
    expect(record.runs).toHaveLength(1)
    expect(record.runs[0]!.notes).toEqual({ viewAnnotations: true, commentPins: true, includeResolvedPins: true })
    // The composition block — the words the file’s metadata will carry — answers in the same breath.
    expect(last(record.compositions)).toEqual({ viewAnnotations: true, commentPins: true, includeResolvedPins: true })
    await settle()
  })

  it('changes nothing but the recipe: the document and its revision are untouched (#83 criteria 5, 6)', async () => {
    await openDialog()
    await userEvent.click(chip('pins'))
    await settle()
    await userEvent.click(chip('resolved'))
    await settle()
    await userEvent.click(chip('annotations'))
    await settle()
    await userEvent.click(chip('annotations'))
    await settle()
    await run()
    expect(view.session.getSnapshot().revision).toBe(revisionBefore)
    expect(JSON.stringify(view.session.getSnapshot().project)).toBe(documentBefore)
    await settle()
  })

  it('clears the Resolved switch when the pins it belongs to go off', async () => {
    await openDialog()
    await userEvent.click(chip('pins'))
    await settle()
    await userEvent.click(chip('resolved'))
    await settle()
    expect(checked(chip('resolved'))).toBe(true)
    await userEvent.click(chip('pins'))
    await settle()
    expect(checked(chip('resolved'))).toBe(false)
    expect(chip('resolved')).toBeDisabled()
    await run()
    expect(record.runs[0]!.notes).toEqual({ viewAnnotations: true, commentPins: false, includeResolvedPins: false })
    await settle()
  })

  it('comes back with the switches where the last export left them (#83 criterion 7)', async () => {
    await openDialog()
    await userEvent.click(chip('pins'))
    await settle()
    await userEvent.click(chip('resolved'))
    await settle()
    await run()
    // A run that wrote its file and had nothing to say closes the dialog itself, so the second
    // opening is the one a person makes after the download has landed.
    expect(record.remembered).toHaveLength(1)
    await openDialog()
    expect(checked(chip('pins'))).toBe(true)
    expect(checked(chip('resolved'))).toBe(true)
    expect(checked(chip('annotations'))).toBe(true)
    await closeDialog()
    await settle()
  })

  it('opens on the defaults again for a Project nobody has exported yet (#83 criterion 7)', async () => {
    await openDialog()
    expect(record.previews.length).toBeGreaterThan(0)
    expect(checked(chip('pins'))).toBe(false)
    await closeDialog()
    // A remembered recipe that never carried the switches — one written before #83 — reads as off.
    memory.set('plan:seed-view-001', {
      views: [PLAN_REF],
      format: 'svg',
      pageSize: 'A4',
      orientation: 'auto',
      scale: 'fit',
      pngLongEdge: 2048,
      titleBlock: true,
      grid: false,
      unit: 'mm',
      precision: 0,
    })
    await openDialog()
    expect(checked(chip('pins'))).toBe(false)
    expect(checked(chip('resolved'))).toBe(false)
    await closeDialog()
    await settle()
  })
})

describe('the Comment Register in the Lists tab (#83 criteria 9, 10, 11, 12)', () => {
  async function openLists(): Promise<void> {
    await openDialog()
    await userEvent.click(screen.getByTestId('export-tab-lists'))
    await settle()
  }

  it('offers the Register last, with no Resolved box until it is asked for', async () => {
    await openLists()
    const tables = screen.getAllByTestId(/^export-lists-table-/).map((one) => one.getAttribute('data-testid'))
    expect(last(tables)).toBe('export-lists-table-comments')
    expect(screen.queryByTestId('export-lists-include-resolved')).not.toBeInTheDocument()
    expect(screen.getByTestId('export-lists-rows-comments')).toHaveTextContent('5')
    await settle()
  })

  it('asks for the row count again with the flag, and shows the statement it answered with', async () => {
    await openLists()
    await userEvent.click(screen.getByTestId('export-lists-table-comments'))
    await settle()
    const box = screen.getByTestId('export-lists-include-resolved')
    expect(box).not.toBeChecked()
    expect(screen.getByTestId('export-lists-rows-comments')).toHaveTextContent('5')
    await userEvent.click(box)
    await settle()
    expect(screen.getByTestId('export-lists-rows-comments')).toHaveTextContent('8')
    expect(screen.getByText('Both Floors · Existing Model only · Open and Resolved Comments')).toBeInTheDocument()
    expect(last(record.summaries)).toBe(true)
    await settle()
  })

  it('says `0 rows` for a scope with nothing in it (#83 criterion 15)', async () => {
    await openLists()
    await userEvent.click(screen.getByTestId('export-lists-table-comments'))
    await settle()
    noCommentsInScope = true
    await userEvent.click(screen.getByTestId('export-lists-floor-seed-floor-002'))
    await settle()
    expect(screen.getByTestId('export-lists-rows-comments')).toHaveTextContent('0 rows')
    noCommentsInScope = false
    await closeDialog()
    await settle()
  })

  it('sends the flag with the lists recipe and remembers it there', async () => {
    await openLists()
    await userEvent.click(screen.getByTestId('export-lists-table-comments'))
    await settle()
    await userEvent.click(screen.getByTestId('export-lists-include-resolved'))
    await settle()
    await userEvent.click(screen.getByTestId('export-lists-run'))
    await settle()
    expect(record.listRuns).toHaveLength(1)
    expect(record.listRuns[0]!.includeResolvedComments).toBe(true)
    expect(last(record.listRuns[0]!.tables)).toBe('comments' satisfies TableId)
    expect(last(record.rememberedLists)?.includeResolvedComments).toBe(true)
    await closeDialog()
    await openLists()
    // The remembered recipe already names the Register, so the box is on the screen without asking
    // for the table again — and it comes back ticked, because the flag is remembered with the recipe.
    expect(screen.getByTestId('export-lists-include-resolved')).toBeChecked()
    await closeDialog()
    await settle()
  })

  it('leaves the Register out of the recipe when its row is unticked, box and all', async () => {
    await openLists()
    await userEvent.click(screen.getByTestId('export-lists-table-comments'))
    await settle()
    await userEvent.click(screen.getByTestId('export-lists-include-resolved'))
    await settle()
    await userEvent.click(screen.getByTestId('export-lists-table-comments'))
    await settle()
    expect(screen.queryByTestId('export-lists-include-resolved')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('export-lists-run'))
    await settle()
    expect(last(record.listRuns)?.tables).not.toContain('comments')
    await closeDialog()
    await settle()
  })
})
