/**
 * The scale, measured with a ruler (#61 criterion 2).
 *
 * A drawing is a promise about paper: two Item Origins 5 000 mm apart must land 100 mm apart on an
 * A4 sheet at 1:50, and the printed scale bar's metre must measure 20 mm — because a photocopy
 * changes the ratio and the bar is what survives it. Both are measured here out of the written
 * bytes, not out of the arithmetic that produced them: the SVG's user units are millimetres of
 * paper, and the PDF's are points, so the same two numbers are read twice, from two writers.
 *
 * The fixture is `fixtures/export/plan-1to50.json`: the same cabinet placed twice on one Floor, its
 * Item Origin at x = 0 and at x = 5 000, rotation zero. Nothing else is in the drawing but the Plan
 * Image, so the two numbers the test reads cannot be anyone else's.
 */
import { readFileSync } from 'node:fs'
import { unzlibSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { migrateProject, type Project } from '../domain'
import { exportFiles } from './index'
import type { ExportClock, ExportDeps, Recipe } from './types'

const PT_PER_MM = 72 / 25.4
/** Criterion 2's tolerance, in millimetres of paper. */
const TOLERANCE_MM = 0.2

const CLOCK: ExportClock = { now: () => '2026-03-04T09:30:00.000Z', localDate: () => '2026-03-04' }

const project: Project = (() => {
  const envelope = JSON.parse(
    readFileSync(new URL('../../fixtures/export/plan-1to50.json', import.meta.url), 'utf8'),
  ) as { domainSchemaVersion: number; project: unknown }
  let issued = 0
  const result = migrateProject(envelope.project, envelope.domainSchemaVersion, (count) =>
    Array.from({ length: count }, () => `view-${++issued}`),
  )
  if (!result.ok) throw new Error(`plan-1to50: ${result.error.message}`)
  return result.project
})()

const snapshot = { project, revision: 1 }

const deps: ExportDeps = {
  clock: CLOCK,
  buildboxVersion: '0.0.0-test',
  font: {
    bytes: new Uint8Array(
      readFileSync(new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url)),
    ),
  },
  assets: async () => null,
}

const recipe = (format: Recipe['format']): Recipe => ({
  views: [{ kind: 'plan', viewId: project.views.find((one) => one.kind === 'plan')!.id }],
  format,
  pageSize: 'A4',
  orientation: 'portrait',
  scale: 50,
  pngLongEdge: 2048,
  titleBlock: true,
  grid: false,
  unit: 'mm',
  precision: 0,
})

const bytesOf = async (format: Recipe['format']): Promise<Uint8Array> => {
  const result = await exportFiles(snapshot, recipe(format), deps)
  if (!result.ok) throw new Error(`export failed: ${JSON.stringify(result.failures)}`)
  if (result.kind !== 'single') throw new Error('expected one file')
  return result.file.bytes
}

/** The x of every `<text>` element that says this, in millimetres of paper. */
function svgTextXs(svg: string, says: string): number[] {
  const out: number[] = []
  const pattern = /<text x="(-?[\d.]+)"[^>]*>([^<]*)<\/text>/g
  for (let match = pattern.exec(svg); match !== null; match = pattern.exec(svg)) {
    if (match[2] === says) out.push(Number(match[1]))
  }
  return out
}

/**
 * The two Item labels. Both placements are the same design at the same rotation, so each label sits
 * the same distance from its own Item Origin and the labels are as far apart as the origins are.
 */
const ITEM_LABEL = 'Base Cabinet'

/** Every text position in the PDF's content streams, in points. */
function pdfTextPositions(bytes: Uint8Array): Array<{ x: number; y: number }> {
  const text = new TextDecoder('latin1').decode(bytes)
  const contents: string[] = []
  const streams = /stream\r?\n/g
  for (let match = streams.exec(text); match !== null; match = streams.exec(text)) {
    const start = match.index + match[0].length
    const end = text.indexOf('endstream', start)
    if (end < 0) continue
    const raw = bytes.subarray(start, end)
    try {
      // `pdf-lib` compresses a content stream with zlib, which is a raw deflate stream with a header
      // and a checksum around it.
      contents.push(new TextDecoder('latin1').decode(unzlibSync(raw)))
    } catch {
      // A stream that will not inflate is already the operators themselves.
      contents.push(new TextDecoder('latin1').decode(raw))
    }
  }
  const out: Array<{ x: number; y: number }> = []
  for (const content of contents) {
    // `pdf-lib` places each run with a text matrix rather than a `Td`: the last two numbers of
    // `1 0 0 1 x y Tm` are where the run starts, in points from the bottom-left of the page.
    const pattern = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g
    for (let at = pattern.exec(content); at !== null; at = pattern.exec(content)) {
      out.push({ x: Number(at[1]), y: Number(at[2]) })
    }
  }
  return out
}

describe('the scale on the paper', () => {
  it('puts the two Item Origins 100 mm apart in the SVG', async () => {
    const svg = new TextDecoder().decode(await bytesOf('svg'))
    const xs = svgTextXs(svg, ITEM_LABEL)
    expect(xs).toHaveLength(2)
    const apart = Math.abs(xs[1]! - xs[0]!)
    expect(Math.abs(apart - 100)).toBeLessThan(TOLERANCE_MM)
  })

  it('prints a scale bar whose metre measures 20 mm', async () => {
    const svg = new TextDecoder().decode(await bytesOf('svg'))
    const label = svgTextXs(svg, '1 m')
    expect(label).toHaveLength(1)
    // The bar's outer rule is the horizontal line centred under its own label.
    const rules: Array<{ from: number; to: number }> = []
    const pattern = /<path d="M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+)"/g
    for (let match = pattern.exec(svg); match !== null; match = pattern.exec(svg)) {
      if (match[2] === match[4]) rules.push({ from: Number(match[1]), to: Number(match[3]) })
    }
    const bar = rules.filter((one) => Math.abs((one.from + one.to) / 2 - label[0]!) < 0.01)
    expect(bar).toHaveLength(1)
    const length = Math.abs(bar[0]!.to - bar[0]!.from)
    expect(length).toBeCloseTo(20, 10)
    expect(Math.abs(length - 20)).toBeLessThan(TOLERANCE_MM)
  })

  it('puts the same two labels 100 mm apart in the PDF', async () => {
    const bytes = await bytesOf('pdf')
    // A4 portrait, in the points a printer measures: 210 mm by 297 mm.
    const doc = await PDFDocument.load(bytes)
    const page = doc.getPage(0)
    const size = page.getSize()
    expect(size.width / PT_PER_MM).toBeCloseTo(210, 6)
    expect(size.height / PT_PER_MM).toBeCloseTo(297, 6)

    const positions = pdfTextPositions(bytes)
    expect(positions.length).toBeGreaterThan(10)
    // The two Item labels are the only pair of text positions exactly 100 mm apart along X.
    const apart = 100 * PT_PER_MM
    const pairs: Array<[number, number]> = []
    for (const one of positions) {
      for (const other of positions) {
        if (other.x - one.x > apart - TOLERANCE_MM * PT_PER_MM && other.x - one.x < apart + TOLERANCE_MM * PT_PER_MM) {
          pairs.push([one.x, other.x])
        }
      }
    }
    expect(pairs.length).toBe(1)
    expect(Math.abs(pairs[0]![1] - pairs[0]![0]) / PT_PER_MM - 100).toBeLessThan(TOLERANCE_MM)
  })
})
