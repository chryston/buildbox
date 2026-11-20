/**
 * The six golden drawings of the display list (#60 criterion 7).
 *
 * A golden is the whole point of this module: the same Project, run twice, must produce the
 * same bytes. That is a stronger claim than "the pixels look the same" — it is what lets
 * #61 write an SVG file that a reviewer can diff, and what lets the renderer be swapped under
 * a screenshot test and still show nothing moved. So each scene is serialised twice, in two
 * sizings, and compared byte for byte:
 *
 *   @screen  the Plan View at 0.2 px per millimetre, the zoom a whole Floor is read at
 *   @paper   a sheet at 1:50, which is what an export will be
 *
 * `includeRefs` is off, because a `data-*` attribute is a test hook and has no business in a
 * file that is meant to be a drawing, and `resolveAsset` answers with the asset's hash rather
 * than a URL, because a URL would be a path through the host.
 *
 * Regenerate with `UPDATE_GOLDEN=1 npx vitest run --project pure src/drawing/golden.test.ts`,
 * then read the diff. A golden that changes because a number moved by a micrometre is a bug
 * in the number, not a golden to be accepted.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  cabinetSceneUnits,
  effectiveFloor,
  effectiveItemDetail,
} from '../derive'
import type { Floor, GenericItemDesign, ItemDesign, ItemFootprint, PlanView, PlacedItem, PresetItemFootprint, Project } from '../domain'
import { computeSceneLayout } from '../cabinet'
import { drawItemDetail } from './itemDetail'
import { measureRect } from './font/layoutText'
import { drawPlanView } from './planView'
import { drawSelectionAnnotations } from './annotations'
import { serializeSvg, toSvgTree } from './svg'
import { FONT_STACK } from './styles'
import type { DisplayList, Sizing } from './types'
import { basicProject } from '../derive/testing'

/** Write the file instead of comparing, for the run that means to change the drawing. */
const UPDATE = process.env.UPDATE_GOLDEN === '1'

/** The two sizings every scene is drawn at. */
const SCREEN: Sizing = { kind: 'screen', pxPerMm: 0.2 }
const PAPER: Sizing = { kind: 'paper', scale: 50 }

/** Millimetres as a whole number: the drawing must not depend on a locale or a preference. */
const wholeMm = (mm: number): string => String(Math.round(mm))

/** The scene as bytes, with no test hooks and no host paths in them. */
function draw(list: DisplayList, sizing: Sizing): string {
  return serializeSvg(toSvgTree(list, {
    sizing,
    includeRefs: false,
    resolveAsset: (hash) => `asset:${hash}`,
  }))
}

function golden(name: string, svg: string): void {
  const file = fileURLToPath(new URL(`./__golden__/${name}.svg`, import.meta.url))
  if (UPDATE) writeFileSync(file, svg)
  expect(svg).toBe(readFileSync(file, 'utf8'))
}

/** Both sizings of one scene, under the two names the file pair uses. */
function goldenBoth(name: string, build: (sizing: Sizing) => DisplayList | null): void {
  const render = (sizing: Sizing): string => {
    const list = build(sizing)
    if (list === null) throw new Error(`${name}: the scene drew nothing`)
    return draw(list, sizing)
  }
  it(`${name} at 0.2 px per millimetre`, () => golden(`${name}@screen`, render(SCREEN)))
  it(`${name} at 1:50 on paper`, () => golden(`${name}@paper`, render(PAPER)))
}

// --- The fixtures ---------------------------------------------------------------

const FLOOR: Floor = { id: 'floor-1', name: 'Floor 1', planImage: null }

const design = (
  id: string,
  name: string,
  footprint: ItemFootprint,
  size: { x: number, y: number },
  color: string,
): GenericItemDesign => ({
  id,
  kind: 'generic',
  name,
  footprint,
  origin: size,
  height: 900,
  heightIsTypical: true,
  color,
})

const preset = (p: PresetItemFootprint['preset'], w: number, h: number): ItemFootprint => ({
  kind: 'preset',
  preset: p,
  centre: { x: w / 2, y: h / 2 },
  orientationDeg: 0,
})

const placed = (
  id: string,
  itemDesignId: string,
  x: number,
  y: number,
  rotationDeg = 0,
): PlacedItem => ({
  id,
  itemDesignId,
  floorId: 'floor-1',
  translation: { x, y },
  rotationDeg,
  baseElevation: 0,
})

const projectOf = (designs: ItemDesign[], placements: PlacedItem[]): Project => ({
  id: 'project-1',
  meta: { name: 'Golden' },
  preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
  floors: [FLOOR],
  views: [{ id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Floor 1', isDefault: true, showPlanImage: true }],
  itemDesigns: designs,
  existingModel: { placedItems: placements, walls: [], wallJunctions: [], openings: [] },
})

/**
 * A reflex arc: three quarters of a circle, which is the one sweep an SVG `A` can get wrong.
 *
 * Past 180° the large-arc flag has to be 1, and a converter that always wrote 0 would draw the
 * short way round — a shape that is still closed, still the right size, and simply not the
 * shape that was asked for. Nothing else in the app's vocabulary produces one, so it is here.
 */
const REFLEX: ItemFootprint = {
  kind: 'path',
  path: {
    start: { x: 0, y: 0 },
    segments: [
      { kind: 'arc', to: { x: 400, y: 0 }, center: { x: 200, y: 0 }, sweepDeg: 270 },
      { kind: 'line', to: { x: 0, y: 0 } },
    ],
  },
}

/**
 * Four curved footprints, turned: the scene that proves an arc is still an arc.
 *
 * Every one of these has a curve in it, and none of them is axis-aligned, so a renderer that
 * flattened a path or dropped the large-arc flag would differ here and nowhere else.
 */
const CURVES = projectOf(
  [
    design('d-rounded', 'Rounded 600', preset({ kind: 'roundedRectangle', width: 600, depth: 400, radius: 60 }, 600, 400), { x: 300, y: 200 }, '#3b82f6'),
    design('d-circle', 'Circle 500', preset({ kind: 'circle', diameter: 500 }, 500, 500), { x: 250, y: 250 }, '#ef4444'),
    design('d-ellipse', 'Ellipse 700×400', preset({ kind: 'ellipse', width: 700, depth: 400 }, 700, 400), { x: 350, y: 200 }, '#10b981'),
    design('d-capsule', 'Capsule 800×300', preset({ kind: 'capsule', length: 800, width: 300 }, 800, 300), { x: 400, y: 150 }, '#f59e0b'),
    design('d-reflex', 'Reflex 400', REFLEX, { x: 200, y: 200 }, '#8b5cf6'),
    design('d-kitchen', 'Kitchen 厨房', preset({ kind: 'rectangle', width: 900, depth: 600 }, 900, 600), { x: 450, y: 300 }, '#0ea5e9'),
  ],
  [
    placed('p-rounded', 'd-rounded', 1200, 900, 37),
    placed('p-circle', 'd-circle', 2600, 900, 118),
    placed('p-ellipse', 'd-ellipse', 1200, 2100, 205),
    placed('p-capsule', 'd-capsule', 2900, 2100, 292),
    placed('p-reflex', 'd-reflex', 2400, 3100, 0),
    placed('p-kitchen', 'd-kitchen', 1200, 3300, 0),
  ],
)

/** A Floor with a Plan Image and a cabinet and two generics on it, from a committed fixture. */
const BASIC = basicProject()
const BASIC_FLOOR = BASIC.floors.find((f) => f.planImage !== null) ?? BASIC.floors[0]!
const BASIC_VIEW: PlanView = BASIC.views.find((v) => v.floorId === BASIC_FLOOR.id) ?? BASIC.views[0]!
const BASIC_CABINET = BASIC.itemDesigns.find((d) => d.kind === 'cabinet')!
const BASIC_GENERIC = BASIC.itemDesigns.find((d) => d.kind === 'generic')!

// --- The six scenes -------------------------------------------------------------

describe('golden: the display list', () => {
  goldenBoth('plan-empty', (sizing) => drawPlanView(
    effectiveFloor(BASIC, 1, 'floor-1', null),
    { showPlanImage: false },
    { sizing },
  ))

  goldenBoth('plan-image-items', (sizing) => drawPlanView(
    effectiveFloor(BASIC, 1, BASIC_FLOOR.id, null),
    { showPlanImage: BASIC_VIEW.showPlanImage },
    { sizing },
  ))

  goldenBoth('plan-curves', (sizing) => drawPlanView(
    effectiveFloor(CURVES, 1, 'floor-1', null),
    { showPlanImage: true },
    { sizing },
  ))

  goldenBoth('plan-selected-annotations', (sizing) => drawSelectionAnnotations(
    effectiveFloor(CURVES, 1, 'floor-1', null),
    'p-rounded',
    { sizing, formatLength: wholeMm },
  ))

  goldenBoth('cabinet-detail', (sizing) => drawItemDetail(
    {
      kind: 'cabinet',
      designId: BASIC_CABINET.id,
      layout: computeSceneLayout(cabinetSceneUnits(BASIC, BASIC_FLOOR.id), BASIC_CABINET.id),
    },
    { pinnedNodeId: null },
    { sizing, formatLength: wholeMm },
  ))

  goldenBoth('item-detail-generic', (sizing) => drawItemDetail(
    effectiveItemDetail(BASIC, 1, BASIC_GENERIC.id, BASIC_FLOOR.id),
    { pinnedNodeId: null },
    { sizing, formatLength: wholeMm },
  ))
})

// --- What every golden must, and must not, contain -------------------------------

/** The twelve files, by the name the pair is written under. */
const SCENES = [
  'plan-empty', 'plan-image-items', 'plan-curves',
  'plan-selected-annotations', 'cabinet-detail', 'item-detail-generic',
] as const

const bytesOf = (name: string, sizing: 'screen' | 'paper'): string =>
  readFileSync(fileURLToPath(new URL(`./__golden__/${name}@${sizing}.svg`, import.meta.url)), 'utf8')

const everyGolden = SCENES.flatMap((name) => [
  [`${name}@screen`, bytesOf(name, 'screen')] as const,
  [`${name}@paper`, bytesOf(name, 'paper')] as const,
])

/** Every number an attribute value holds, which is where a float would show itself. */
function numbers(svg: string): string[] {
  return [...svg.matchAll(/(?:^|[\s"=,(-])(-?\d*\.?\d+)/g)].map((m) => m[1])
}

/** Every text item of a list, groups unwound. */
function textItems(list: DisplayList): Extract<DisplayList['layers'][number]['items'][number], { kind: 'text' }>[] {
  return list.layers.flatMap((layer) => layer.items.flatMap(function of(item): ReturnType<typeof textItems> {
    return item.kind === 'group' ? item.items.flatMap(of) : item.kind === 'text' ? [item] : []
  }))
}

describe('golden: what the bytes say (#60 criteria 8, 9, 10, 12)', () => {
  it.each(everyGolden)('%s spells every number plainly', (_name, svg) => {
    for (const value of numbers(svg)) {
      expect(value, `${_name}: ${value}`).not.toBe('-0')
      expect(value).not.toMatch(/e[+-]?\d/i)
      expect(value.includes('.') ? value.split('.')[1].length : 0).toBeLessThanOrEqual(3)
    }
  })

  it.each(SCENES)('%s is byte-identical when drawn twice', (name) => {
    expect(bytesOf(name, 'screen')).toBe(bytesOf(name, 'screen'))
    expect(bytesOf(name, 'paper')).toBe(bytesOf(name, 'paper'))
  })

  it('turns no Plan View word, and still turns the cabinet height', () => {
    for (const name of ['plan-empty', 'plan-image-items', 'plan-curves', 'plan-selected-annotations'] as const) {
      for (const sizing of ['screen', 'paper'] as const) {
        expect(bytesOf(name, sizing), `${name}@${sizing}`).not.toContain('rotate(')
      }
    }
    expect(bytesOf('cabinet-detail', 'screen')).toContain('rotate(-90,')
  })

  it.each(everyGolden)('%s names the face on every word it draws', (_name, svg) => {
    // The stack as it appears once XML-escaped, so the golden says the drawing asked for a
    // face by name rather than inheriting whatever the host page happened to set.
    const face = FONT_STACK.replace(/"/g, '&quot;')
    for (const tag of svg.match(/<text\b[^>]*>/g) ?? []) {
      expect(tag).toContain(`font-family="${face}"`)
    }
  })

  // #57 criterion 3 through the shared list: a pending Item Origin change moves the crosshair
  // and nothing else. The committed pivot stays on screen beside it, so both are emitted.
  it('shows a pending Item Origin without moving the footprint', () => {
    const floor = effectiveFloor(CURVES, 1, 'floor-1', null)
    const still = drawSelectionAnnotations(floor, 'p-rounded', { sizing: SCREEN, formatLength: wholeMm })
    const moved = drawSelectionAnnotations(floor, 'p-rounded', {
      sizing: SCREEN,
      formatLength: wholeMm,
      preview: { scope: 'design', id: 'd-rounded', origin: { x: 0, y: 400 } },
    })
    expect(moved).not.toBeNull()
    const roles = (list: DisplayList | null): string[] =>
      (list === null ? '' : serializeSvg(toSvgTree(list, { sizing: SCREEN, includeRefs: true, resolveAsset: () => null })))
        .match(/data-ref-role="(origin[a-z-]*)"/g)?.map((m) => m.slice(15, -1)) ?? []
    expect(roles(still)).toEqual(['origin-marker'])
    expect(roles(moved)).toEqual(['origin-preview', 'origin-marker'])
    const paths = (list: DisplayList | null): string[] =>
      (list === null ? '' : serializeSvg(toSvgTree(list, { sizing: SCREEN, includeRefs: false, resolveAsset: () => null })))
        .match(/data-layer="plan-annotations"[\s\S]*?<\/g><\/g>/)?.[0]
        .match(/ d="[^"]+"/g) ?? []
    // Two crosshairs where there was one — three paths each, two arms and a dot — and the
    // committed one is byte-identical: the footprint is not in this band at all, so nothing
    // about it can have moved.
    expect(paths(moved)).toHaveLength(6)
    expect(paths(still)).toHaveLength(3)
    expect(paths(moved).slice(3)).toEqual(paths(still))
  })

  it('keeps a reflex arc reflex', () => {
    // Three quarters of a circle, so the large-arc flag has to be 1; a converter that always
    // wrote 0 would close the shape the short way round and still look like a drawing.
    expect(bytesOf('plan-curves', 'screen')).toContain('A 200 200 0 1 1')
  })

  it('bounds every word it drew (#60 criterion 12)', () => {
    for (const list of [
      drawSelectionAnnotations(effectiveFloor(CURVES, 1, 'floor-1', null), 'p-rounded', { sizing: SCREEN, formatLength: wholeMm }),
      drawPlanView(effectiveFloor(CURVES, 1, 'floor-1', null), { showPlanImage: true }, { sizing: SCREEN }),
    ]) {
      if (list === null) throw new Error('the scene drew nothing')
      for (const item of textItems(list)) {
        const box = measureRect(item.layout, item.at, item.anchor)
        expect(box.x, item.text).toBeGreaterThanOrEqual(list.bounds.x - 1e-9)
        expect(box.y, item.text).toBeGreaterThanOrEqual(list.bounds.y - 1e-9)
        expect(box.x + box.w, item.text).toBeLessThanOrEqual(list.bounds.x + list.bounds.w + 1e-9)
        expect(box.y + box.h, item.text).toBeLessThanOrEqual(list.bounds.y + list.bounds.h + 1e-9)
      }
      expect(textItems(list).length, 'a list with no words would prove nothing').toBeGreaterThan(0)
    }
  })

  it('reports the glyphs Noto Sans has not got and draws them anyway (#60 criterion 11)', () => {
    const list = drawPlanView(effectiveFloor(CURVES, 1, 'floor-1', null), { showPlanImage: true }, { sizing: SCREEN })
    const missing = list.missingGlyphs.filter((m) => m.ref?.id === 'p-kitchen')
    expect(missing).toHaveLength(1)
    expect(missing[0].chars).toEqual(['厨', '房'])
    expect(missing[0].ref).toEqual({ id: 'p-kitchen', role: 'item-label' })
    // The word is still drawn: a missing glyph is a warning about a font, not a reason to
    // lose a label, and the advance it was laid out with is `.notdef`'s.
    const label = textItems(list).find((item) => item.text === 'Kitchen 厨房')
    expect(label).toBeDefined()
    expect(bytesOf('plan-curves', 'screen')).toContain('Kitchen 厨房')
  })
})
