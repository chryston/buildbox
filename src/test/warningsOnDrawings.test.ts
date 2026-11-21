/**
 * Warnings never reach a drawing (#68 criterion 6, export contract §5).
 *
 * Three open warnings is the worst case the model can offer: the strip counts them, the canvas
 * badges them, and the Lists tab will write them to a CSV. None of that may cross onto a sheet —
 * a drawing handed over is not a to-do list — and none of it may stop an export either, because
 * a plan that refuses to export while it is being fixed is a plan that gets exported from a copy.
 *
 * `src/test` is where a test may read every layer: the sentence a drawing must not contain is
 * `ui/strings`' copy, the bytes are `export`'s, and the badge is `drawing`'s.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { countUnacknowledged, deriveWarnings, effectiveFloor } from '../derive'
import { referenceProject } from '../derive/testing'
import type { Acknowledgement, Project, Wall } from '../domain'
import { drawPlanView, drawWarningBadges } from '../drawing'
import type { DisplayItem, Sizing } from '../drawing'
import { composeSheet, exportFiles } from '../export'
import type { DrawingFormat, ExportClock, ExportDeps, ExportFile, Rasterizer, Recipe } from '../export'
import { warningSentence } from '../ui/strings'

const CLOCK: ExportClock = {
  now: () => '2026-11-20T09:00:00.000Z',
  localDate: () => '2026-11-20',
}

/** A one-pixel PNG: what the recording surface hands back in place of a rasterized sheet. */
const ONE_PIXEL_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05,
  0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
])

/**
 * A rasterizer for a Node process, which has no canvas.
 *
 * It records every string the sheet asked to have painted — the one thing criterion 6 is about —
 * and hands back a fixed PNG: what the encoder does with the pixels is `png.ts`'s business, and
 * whether a headless test process has a GPU is nobody's.
 */
function recordingRasterizer(painted: string[]): Rasterizer {
  const noop = (): void => {}
  return {
    decode: async () => null,
    create: (width: number, height: number) => ({
      width,
      height,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineDashOffset: 0,
      globalAlpha: 1,
      font: '',
      textAlign: '',
      textBaseline: '',
      save: noop,
      restore: noop,
      setTransform: noop,
      translate: noop,
      rotate: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      bezierCurveTo: noop,
      quadraticCurveTo: noop,
      ellipse: noop,
      closePath: noop,
      fill: noop,
      stroke: noop,
      fillRect: noop,
      setLineDash: noop,
      drawImage: noop,
      fillText: (text: string): void => {
        painted.push(text)
      },
      toBlob: async () => ONE_PIXEL_PNG,
    }),
  }
}

/** Every string the PNG sheet asked to have painted, newest last. */
const PAINTED: string[] = []

const DEPS: ExportDeps = {
  clock: CLOCK,
  buildboxVersion: '0.0.0-test',
  font: { bytes: readFileSync(new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url)) },
  rasterizer: recordingRasterizer(PAINTED),
}

const SCREEN: Sizing = { kind: 'screen', pxPerMm: 1 }

const base = referenceProject()
const FLOOR_ID = base.floors[0]!.id
const VIEW_ID = base.views.find((view) => view.kind === 'plan' && view.floorId === FLOOR_ID)!.id

const wall = (id: string, ref: string, x1: number, y1: number, x2: number, y2: number): Wall => ({
  id,
  ref,
  floorId: FLOOR_ID,
  line: { kind: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } },
  thickness: 100,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

/** Three pairs of Walls crossing with no join: three warnings, none of them acknowledged. */
const CROSSING: readonly Wall[] = [
  wall('warn-wall-a', 'W-A', 0, 0, 5000, 0),
  wall('warn-wall-b', 'W-B', 1000, -600, 1000, 600),
  wall('warn-wall-c', 'W-C', 0, 2000, 5000, 2000),
  wall('warn-wall-d', 'W-D', 2000, 1400, 2000, 2600),
  wall('warn-wall-e', 'W-E', 0, 4000, 5000, 4000),
  wall('warn-wall-f', 'W-F', 3000, 3400, 3000, 4600),
]

const project: Project = {
  ...base,
  existingModel: { ...base.existingModel, walls: [...CROSSING] },
}

const open = deriveWarnings(project, FLOOR_ID, null).warnings

/** Every sentence the strip would say about this Floor, in the strip's own words. */
const SENTENCES = open.map((warning) => warningSentence(warning.messageKey, warning.params))

/**
 * The same Project with every warning acknowledged and a note on it.
 *
 * The key is rebuilt from the warning's own `key` because the engine keeps the subject ids inside
 * `subjects` and the record needs them as a sorted list — and the key is the only place the pair is
 * written down in both shapes.
 */
const acknowledged: Project = {
  ...project,
  warningAcknowledgements: open.map(
    (warning): Acknowledgement => {
      const [, subjectIds] = warning.key.split('|')
      return {
        id: `ack-${warning.key}`,
        warningType: warning.type,
        subjectIds: subjectIds.split(','),
        designOptionId: null,
        signature: warning.signature,
        note: 'Builder to check.',
        acknowledgedAt: '2026-11-19T10:00:00.000Z',
      }
    },
  ),
}

const recipeFor = (format: DrawingFormat): Recipe => ({
  views: [{ kind: 'plan', viewId: VIEW_ID }],
  format,
  pageSize: 'A4',
  orientation: 'auto',
  scale: 'fit',
  pngLongEdge: 2048,
  titleBlock: true,
  grid: false,
  unit: 'mm',
  precision: 0,
})

async function one(format: DrawingFormat, at: Project = project): Promise<ExportFile> {
  const result = await exportFiles({ project: at, revision: 3 }, recipeFor(format), DEPS)
  if (!result.ok) throw new Error(JSON.stringify(result.failures))
  if (result.kind !== 'single') throw new Error('expected one file')
  return result.file
}

/** Every piece of text a display list carries, groups walked. */
function texts(items: readonly DisplayItem[]): string[] {
  return items.flatMap((item) =>
    item.kind === 'group' ? texts(item.items) : item.kind === 'text' ? [item.text] : [],
  )
}

describe('three open warnings (#68 criterion 6)', () => {
  it('is three warnings the dialog would count', () => {
    expect(open.map((warning) => warning.status)).toEqual(['open', 'open', 'open'])
    expect(SENTENCES.every((sentence) => sentence.includes('crosses'))).toBe(true)
    expect(countUnacknowledged(project, [FLOOR_ID], [null])).toBe(3)
    expect(countUnacknowledged(acknowledged, [FLOOR_ID], [null])).toBe(0)
  })

  it.each([
    ['svg', 'image/svg+xml'],
    ['pdf', 'application/pdf'],
  ] as const)('exports the view as %s anyway', async (format, mediaType) => {
    const file = await one(format)
    expect(file.mediaType).toBe(mediaType)
    expect(file.bytes.byteLength).toBeGreaterThan(0)
    expect(file.name.endsWith(`.${format}`)).toBe(true)
  })

  /**
   * PNG goes through a rasterizer the Node process does not have, so the assertion is on what the
   * sheet asked to have painted: every string that reaches a canvas is recorded, and none of them
   * is a warning.
   */
  it('exports the view as PNG and paints no warning into it', async () => {
    PAINTED.length = 0
    const file = await one('png')
    expect(file.mediaType).toBe('image/png')
    expect(file.name.endsWith('.png')).toBe(true)
    // The sheet was painted: title block, footer and labels all went through the canvas.
    expect(PAINTED.length).toBeGreaterThan(10)
    for (const sentence of SENTENCES) expect(PAINTED).not.toContain(sentence)
    expect(PAINTED.filter((text) => text.trim() === '!')).toEqual([])
    expect(PAINTED.filter((text) => text.toLowerCase().includes('warning'))).toEqual([])
  })

  it('draws no warning sentence and no badge', () => {
    const composed = composeSheet({ project, revision: 3 }, { kind: 'plan', viewId: VIEW_ID }, recipeFor('svg'), CLOCK, '0.0.0-test')
    if (!composed.ok) throw new Error(composed.reason)
    const drawn = [...texts(composed.drawing.layers.flatMap((layer) => layer.items))]
    for (const sentence of SENTENCES) expect(drawn).not.toContain(sentence)
    // The badge is a disc with one character in it; nothing on a sheet is a lone `!`.
    expect(drawn.filter((text) => text.trim() === '!')).toEqual([])
    // Nor is the word `warning` anywhere on the sheet, title block and footer included.
    const sheet = texts(composed.list.layers.flatMap((layer) => layer.items))
    expect(sheet.filter((text) => text.toLowerCase().includes('warning'))).toEqual([])
  })

  it('draws the same sheet whether the warnings are open or acknowledged', async () => {
    const before = await one('svg')
    const after = await one('svg', acknowledged)
    expect(after.bytes).toEqual(before.bytes)
  })

  /**
   * The contrast that keeps the assertions above from being vacuous: the same Floor, drawn for the
   * screen and badged the way the canvas badges it, does say these things. The export's list is
   * missing them because it never asks for them, not because there was nothing to say.
   */
  it('says them on the screen, where the badges belong', () => {
    const drawn = drawPlanView(effectiveFloor(project, 3, FLOOR_ID, null), { showPlanImage: false }, { sizing: SCREEN })
    const badges = drawWarningBadges(
      CROSSING.filter((one2) => ['warn-wall-b', 'warn-wall-d', 'warn-wall-f'].includes(one2.id)).map((one2) => ({
        id: one2.id,
        bounds: { x: one2.line.start.x, y: Math.min(one2.line.start.y, one2.line.end.y), w: 100, h: 1200 },
      })),
      { sizing: SCREEN },
    )
    if (badges === null) throw new Error('expected a badge for each open warning')
    expect(texts(badges.layers.flatMap((layer) => layer.items))).toContain('!')
    expect(texts(drawn.layers.flatMap((layer) => layer.items)).filter((text) => text === '!')).toEqual([])
  })
})
