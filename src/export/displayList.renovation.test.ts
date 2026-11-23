/**
 * The exported drawing is the screen's display list (#73 criterion 1).
 *
 * Criterion 1 is not "the export looks like the Plan View"; it is that the export *is* the Plan
 * View's drawing — the same `drawFloorView` call, the same State map, the same Layer gates, so that
 * a Wall the screen does not paint cannot appear on the paper and a Wall it paints with a
 * demolition overlay cannot arrive without one. The check therefore compares the two lists item by
 * item, in the order the z-bands put them, and then pins the bytes the writer makes of that list.
 *
 * The two calls differ in exactly two ways, both of them the sheet's business and not the drawing's:
 * the export hands `drawing` millimetres of paper (`1 / denominator` of the model, so ink sizes
 * survive the shrink) and the screen hands it millimetres of model at the viewport's `pxPerMm`.
 * Neither is visible in the serialisation below, which names the band, the kind, the style, the
 * entity and the string — the identity of what is painted, not where it lands on the page. The
 * where is what the SVG golden holds.
 *
 *   UPDATE_GOLDEN=1 npx vitest run --project renovation src/export/displayList.renovation.test.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import renovationFixture from '../../fixtures/domain/v9/renovation-views.json?raw'
import type { PlanView, Project } from '../domain'
import {
  deriveRooms,
  deriveWalls,
  displayModel,
  displayProject,
  displayStates,
  effectiveFloor,
  effectiveModel,
} from '../derive'
import type { DisplayItem, DisplayList, Sizing } from '../drawing'
import { drawFloorView, wallOpenings } from '../drawing'
import { viewRenovationDisplay } from '../domain'
import { composeSheet } from './compose'
import { drawingComposition } from './composition'
import { exportFiles } from './index'
import type { ExportClock, ExportDeps, Recipe, RecipeViewRef } from './types'
import { roomLabel } from './strings'

const UPDATE = process.env['UPDATE_GOLDEN'] === '1'
const GOLDEN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/export/golden')

const project = (JSON.parse(renovationFixture) as { project: Project }).project
const snapshot = { project, revision: 7 }
const CLOCK: ExportClock = { now: () => '2026-11-23T09:30:00.000Z', localDate: () => '2026-11-23' }
const DEPS: ExportDeps = {
  clock: CLOCK,
  buildboxVersion: '0.0.0-test',
  font: { bytes: new Uint8Array(readFileSync(new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url))) },
}

/** The viewport the Plan View canvas draws at, for the list the screen gets. */
const SCREEN: Sizing = { kind: 'screen', pxPerMm: 1 }

const RECIPE: Recipe = {
  views: [],
  format: 'svg',
  pageSize: 'A3',
  orientation: 'auto',
  scale: 50,
  pngLongEdge: 2048,
  titleBlock: true,
  grid: false,
  unit: 'mm',
  precision: 0,
}

/** One saved view per Renovation Display, which is the fixture's own arrangement. */
const BY_DISPLAY = [
  ['existing', 'seed-view-001'],
  ['demolition', 'views-view-015'],
  ['proposed', 'views-view-014'],
  ['combined', 'views-view-016'],
] as const

const viewOf = (viewId: string): PlanView => project.views.find((each) => each.id === viewId) as PlanView

/** What the Plan View canvas draws for that saved view, at the model's own scale. */
function screenList(planView: PlanView): DisplayList {
  const floorId = planView.floorId
  const composition = drawingComposition(project, planView, floorId, undefined)
  const drawn = displayProject(project, composition.optionId)
  const states =
    composition.optionId === null
      ? null
      : displayStates(
          displayModel(effectiveModel(project, floorId, composition.optionId), viewRenovationDisplay(planView)),
        )
  const { list } = drawFloorView(
    {
      floor: effectiveFloor(drawn, snapshot.revision, floorId, composition.optionId),
      walls: deriveWalls(drawn, floorId, composition.optionId),
      rooms: deriveRooms(drawn, floorId, composition.optionId),
      openings: wallOpenings(
        project.existingModel.walls,
        project.existingModel.wallJunctions,
        project.existingModel.openings.filter((each) => each.floorId === floorId),
      ),
    },
    {
      sizing: SCREEN,
      showPlanImage: planView.showPlanImage,
      renovation: states === null ? null : { states },
      layers: composition.gates,
      formatRoomLabel: roomLabel,
    },
  )
  return list
}

/**
 * What is painted, in the order it is painted: band, kind, style, the entity it belongs to, and the
 * string when it is a string. Scale, page offset and ink size are deliberately absent — the sheet
 * moves and shrinks the drawing, and `drawing` is the same list either way.
 */
function serialise(list: DisplayList): string[] {
  const lineOf = (band: string, item: DisplayItem): string[] => {
    if (item.kind === 'group') return item.items.flatMap((each) => lineOf(band, each))
    const ref = item.ref === undefined ? '' : `${item.ref.role}:${item.ref.id}`
    if (item.kind === 'path') return [`${band} path ${item.style} ${ref}`]
    if (item.kind === 'image') return [`${band} image ${item.assetHash.slice(0, 8)} ${ref}`]
    return [`${band} text ${item.style} ${ref} ${item.text}`]
  }
  return list.layers.flatMap((layer) => layer.items.flatMap((item) => lineOf(layer.key, item)))
}

function golden(name: string, text: string): void {
  const file = join(GOLDEN_DIR, `${name}.svg`)
  if (UPDATE) {
    mkdirSync(GOLDEN_DIR, { recursive: true })
    writeFileSync(file, text)
  }
  expect(readFileSync(file, 'utf8'), name).toBe(text)
}

describe('Every Renovation Display exports the display list the screen shows (#73 criterion 1)', () => {
  for (const [display, viewId] of BY_DISPLAY) {
    it(`${display}: the sheet's drawing is the screen's list, item for item`, () => {
      const planView = viewOf(viewId)
      const view: RecipeViewRef = { kind: 'plan', viewId }
      const composed = composeSheet(snapshot, view, { ...RECIPE, views: [view] }, CLOCK, '0.0.0-test')
      if (!composed.ok) throw new Error(composed.reason)
      const screen = serialise(screenList(planView))
      expect(screen.length).toBeGreaterThan(0)
      expect(serialise(composed.drawing)).toEqual(screen)
    })

    it(`${display}: the SVG golden is those bytes`, async () => {
      const view: RecipeViewRef = { kind: 'plan', viewId }
      const result = await exportFiles(snapshot, { ...RECIPE, views: [view] }, DEPS)
      if (!result.ok) throw new Error(JSON.stringify(result.failures))
      if (result.kind !== 'single') throw new Error('expected one file')
      golden(`renovation-${display}`, new TextDecoder().decode(result.file.bytes))
    })
  }

  it('the four Displays do not draw the same thing', () => {
    const lists = BY_DISPLAY.map(([, viewId]) => serialise(screenList(viewOf(viewId))))
    const distinct = new Set(lists.map((list) => list.join('\n')))
    expect(distinct.size).toBe(BY_DISPLAY.length)
  })
})
