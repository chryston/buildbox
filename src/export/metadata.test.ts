/**
 * What a file says about itself, and what it must not say (#61 acceptance 4, 13; Verification's
 * metadata privacy walker, `fitCheck` table and palette coverage).
 *
 * The walker is deliberately dumb: it takes every metadata key and value it can find in each format
 * and asks one question of each — could this have come from the machine rather than the drawing? A
 * path, a locale, a time zone, an author, a user agent and a device name are all shapes, so the
 * test looks for the shapes rather than for a list of fields the writers happened to have yesterday.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { referenceProject } from '../derive/testing'
import type { Rect } from '../derive'
import { STYLES } from '../drawing'
import { exportFiles } from './index'
import { PRINT_PALETTE_KEYS, resolveColour } from './palette'
import { readITxt, spliceITxt } from './pngMeta'
import { FIXED_SCALES, fitCheck, sheetOf, suggestionsFor } from './fit'
import type { Orientation, PageSize } from './types'
import type { ExportClock, ExportDeps, ExportFile, ExportResult, ExportSnapshot, Recipe } from './types'

/** The subset the PDF embeds; the same file the browser loads, read once for the Node tests. */
const FONT_PATH = new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url)

/** A one-pixel PNG: enough for a chunk splicer to have something to splice into. */
const BLANK_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4AWMAAQAABQABNtCI3QAAAABJRU5ErkJggg==',
    'base64',
  ),
)

const FIXED_CLOCK: ExportClock = { now: () => '2026-03-04T09:30:00.000Z', localDate: () => '2026-03-04' }
const deps: ExportDeps = { clock: FIXED_CLOCK, buildboxVersion: '0.0.0-test' }

const snapshotOf = (): ExportSnapshot => ({ project: referenceProject(), revision: 3 })

function recipeFor(viewId: string, over: Partial<Recipe> = {}): Recipe {
  return {
    views: [{ kind: 'plan', viewId }],
    format: 'svg',
    pageSize: 'A4',
    orientation: 'auto',
    scale: 'fit',
    pngLongEdge: 2048,
    titleBlock: true,
    grid: false,
    unit: 'mm',
    precision: 0,
    ...over,
  }
}

const single = (result: ExportResult): ExportFile => {
  if (!result.ok || result.kind !== 'single') throw new Error('expected one file')
  return result.file
}

const latin = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes)

/** Every `<key>value</key>` and `"key":value` pair a format carries as metadata. */
function svgMetadata(text: string): Map<string, string> {
  const block = /<metadata>([\s\S]*?)<\/metadata>/.exec(text)
  const found = new Map<string, string>()
  if (block === null) return found
  const json = JSON.parse(block[1]) as Record<string, unknown>
  for (const [key, value] of Object.entries(json)) found.set(key, JSON.stringify(value) ?? '')
  return found
}

/** The PDF's own metadata: the document info dictionary and the XMP packet, both plain text. */
function pdfMetadata(text: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of text.matchAll(/\/(Title|Author|Subject|Keywords|Creator|Producer)\s*\(([^)]*)\)/g)) {
    found.set(match[1]!, match[2]!)
  }
  for (const match of text.matchAll(/<([a-zA-Z0-9]+:[A-Za-z0-9]+)[^>]*>([^<]*)</g)) {
    found.set(match[1]!, match[2]!)
  }
  for (const match of text.matchAll(/<x:xmpmeta[\s\S]*?>/g)) found.set('xmpmeta', match[0])
  return found
}

/** The shapes that can only have come from the machine that wrote the file. */
const MACHINE_VALUES: readonly (readonly [string, RegExp])[] = [
  ['a filesystem path', /(^|[\s"'])[/\\][A-Za-z0-9._-]+[/\\]/],
  ['a Windows path', /^[A-Za-z]:\\/],
  ['a user agent', /Mozilla|Chrome\/|Safari\/|Gecko\//i],
  ['a time zone', /\b[A-Z][a-z]+\/[A-Z][a-z]+\b/],
  ['a locale', /\b[a-z]{2}-[A-Z]{2}\b/],
  ['an author', /\b(author|username|user)\b.*[:=]/i],
  ['a device name', /\b(DESKTOP|LAPTOP|iPhone|MacBook|hostname)\b/i],
  ['a home directory', /\/home\/|\/Users\/|\/root\b/],
]

describe('the metadata privacy walker', () => {
  it('says nothing about the machine in an SVG', async () => {
    const project = referenceProject()
    const file = single(await exportFiles(snapshotOf(), recipeFor(project.views[0]!.id), deps))
    const text = new TextDecoder().decode(file.bytes)
    for (const [key, value] of svgMetadata(text)) {
      for (const [what, shape] of MACHINE_VALUES) {
        expect(shape.test(value), `${key} looks like ${what}: ${value}`).toBe(false)
      }
    }
  })

  it('says nothing about the machine in a PDF', async () => {
    const project = referenceProject()
    const file = single(
      await exportFiles(snapshotOf(), recipeFor(project.views[0]!.id, { format: 'pdf' }), {
        ...deps,
        font: { bytes: new Uint8Array(readFileSync(FONT_PATH)) },
      }),
    )
    const text = latin(file.bytes)
    for (const [key, value] of pdfMetadata(text)) {
      for (const [what, shape] of MACHINE_VALUES) {
        expect(shape.test(value), `${key} looks like ${what}: ${value}`).toBe(false)
      }
    }
    // An author entry would be the obvious leak; the dictionary must not carry the key at all.
    expect(text).not.toMatch(/\/Author\s*\(/)
  })

  it('keeps the Project id and revision in the metadata and off the drawing', async () => {
    const project = referenceProject()
    const file = single(await exportFiles(snapshotOf(), recipeFor(project.views[0]!.id), deps))
    const text = new TextDecoder().decode(file.bytes)
    const metadata = text.match(/<metadata>[\s\S]*?<\/metadata>/)?.[0] ?? ''
    expect(metadata).toContain(project.id)
    expect(metadata).toContain('"project_revision":3')
    const face = text.replace(/<metadata>[\s\S]*?<\/metadata>/, '')
    expect(face).not.toContain(project.id)
    expect(face).not.toContain('project_revision')
  })

  it('carries unsaved changes as a flag and nothing else', async () => {
    const project = referenceProject()
    const file = single(
      await exportFiles(snapshotOf(), recipeFor(project.views[0]!.id), { ...deps, unsavedChanges: true }),
    )
    const metadata = svgMetadata(new TextDecoder().decode(file.bytes))
    expect(metadata.get('unsaved_changes')).toBe('true')
    expect([...metadata.keys()].sort()).toEqual(
      ['buildbox_version', 'contract_version', 'exported_at', 'generator', 'project_id', 'project_revision', 'recipe', 'unsaved_changes'].sort(),
    )
  })

  it('round-trips the PNG keyword through the splice', () => {
    const text = '{"buildbox_version":"0.0.0-test","project_revision":3}'
    // A PNG the browser encoded has no BuildBox keyword in it yet.
    expect(readITxt(BLANK_PNG)).toBeNull()
    const spliced = spliceITxt(BLANK_PNG, text)
    expect(spliced).not.toBeNull()
    expect(readITxt(spliced!)).toBe(text)
    expect(readITxt(spliced!, 'absent')).toBeNull()
  })
})

describe('the print palette', () => {
  it('has a printed colour for every style the drawing can ask for', () => {
    const asked = new Set<string>()
    for (const style of Object.values(STYLES)) {
      for (const match of JSON.stringify(style).matchAll(/var\((--[a-z0-9-]+)\)/g)) asked.add(match[1]!)
    }
    expect(asked.size, 'no style asks for a colour; the scan is broken').toBeGreaterThan(0)
    for (const name of asked) {
      expect(PRINT_PALETTE_KEYS, `${name} has no printed colour`).toContain(name)
      expect(resolveColour(`var(${name})`)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('never leaves a CSS variable in a colour that goes to paper', () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.keys(STYLES)), (key) => {
        const style = STYLES[key as keyof typeof STYLES]
        for (const match of JSON.stringify(style).matchAll(/var\((--[a-z0-9-]+)\)/g)) {
          expect(resolveColour(`var(${match[1]})`)).not.toContain('var(')
        }
      }),
    )
  })
})

describe('the archive', () => {
  const twoViews = (): { snapshot: ExportSnapshot; views: string[] } => {
    const project = referenceProject()
    return {
      snapshot: { project, revision: 3 },
      views: project.views.slice(0, 2).map((view) => view.id),
    }
  }

  it('carries a manifest that says what each file is', async () => {
    const { snapshot, views } = twoViews()
    const result = await exportFiles(snapshot, recipeFor(views[0]!, { views: views.map((id) => ({ kind: 'plan', viewId: id })) }), deps)
    if (!result.ok || result.kind !== 'archive') throw new Error('expected an archive')
    const manifest = JSON.parse(new TextDecoder().decode(result.manifest.bytes)) as {
      format: string
      manifest_version: number
      files: Array<{ path: string; kind: string; bytes?: number; sha256?: string; contract_version: string }>
    }
    expect(manifest.format).toBe('buildbox-export')
    expect(manifest.manifest_version).toBe(1)
    const drawings = manifest.files.filter((one) => one.kind === 'drawing')
    expect(drawings.map((one) => one.path)).toEqual(result.files.map((one) => one.name))
    for (const [index, one] of drawings.entries()) {
      expect(one.bytes).toBe(result.files[index]!.bytes.length)
      expect(one.sha256).toBe(createHash('sha256').update(result.files[index]!.bytes).digest('hex'))
      expect(one.contract_version).toBe('1.0')
    }
    // The manifest lists itself last, so an extracted archive explains itself without a reader.
    expect(manifest.files[manifest.files.length - 1]).toMatchObject({ path: 'manifest.json', kind: 'manifest' })
  })

  it('writes its entries in the order given and the same bytes twice', async () => {
    const { snapshot, views } = twoViews()
    const recipe = recipeFor(views[0]!, { views: views.map((id) => ({ kind: 'plan', viewId: id })) })
    const first = await exportFiles(snapshot, recipe, deps)
    const second = await exportFiles(snapshot, recipe, deps)
    if (!first.ok || !second.ok || first.kind !== 'archive' || second.kind !== 'archive') {
      throw new Error('expected two archives')
    }
    // Criterion 1: the archive is the same bytes twice, because the only thing that could differ is
    // the clock, and the archiver does not use it.
    expect(Buffer.from(second.archive.bytes)).toEqual(Buffer.from(first.archive.bytes))
    const entries = unzipSync(first.archive.bytes)
    expect(Object.keys(entries)).toEqual([...first.files.map((one) => one.name), 'manifest.json'])
  })
})

describe('the fit check', () => {
  const pages: readonly PageSize[] = ['A4', 'A3']
  const orientations: readonly Orientation[] = ['portrait', 'landscape']
  const printable = (page: PageSize, orientation: Orientation): Rect =>
    sheetOf(page, orientation, { titleBlock: true }).content

  it('holds a drawing that is exactly the printable area at every page, orientation and scale', () => {
    for (const page of pages) {
      for (const orientation of orientations) {
        for (const scale of FIXED_SCALES) {
          const area = printable(page, orientation)
          // A drawing of `area × scale` millimetres on the ground is exactly the printable area.
          const bounds: Rect = { x: 0, y: 0, w: area.w * scale, h: area.h * scale }
          expect(fitCheck(bounds, page, orientation, scale).fits, `${page} ${orientation} 1:${scale}`).toBe(true)
        }
      }
    }
  })

  it('blocks a drawing one millimetre too wide and offers a fix that fits', () => {
    // The regression this pins: `fitCheck` and `suggestionsFor` used to call each other in a
    // circle, so any real non-fit recursed until the stack gave out.
    for (const page of pages) {
      for (const orientation of orientations) {
        const area = printable(page, orientation)
        const bounds: Rect = { x: 0, y: 0, w: area.w * 10 + 1, h: area.h * 10 + 1 }
        const result = fitCheck(bounds, page, orientation, 10)
        expect(result.fits, `${page} ${orientation}`).toBe(false)
        expect(result.suggestions.length).toBeGreaterThan(0)
        for (const one of result.suggestions) {
          expect(fitCheck(bounds, one.page, one.orientation, one.scale).fits).toBe(true)
        }
        expect(fitCheck(bounds, page, orientation, 'fit').fits).toBe(true)
      }
    }
  })

  it('offers only `Fit to page` when no fixed scale holds', () => {
    const bounds: Rect = { x: 0, y: 0, w: 1e9, h: 1e9 }
    const result = fitCheck(bounds, 'A4', 'portrait', 10)
    expect(result.fits).toBe(false)
    expect(result.suggestions.length).toBeGreaterThan(0)
    for (const one of result.suggestions) expect(one.scale).toBe('fit')
  })

  it('never suggests a scale that does not hold', () => {
    fc.assert(
      fc.property(
        fc.record({ w: fc.integer({ min: 1, max: 200_000 }), h: fc.integer({ min: 1, max: 200_000 }) }),
        fc.constantFrom<PageSize>('A4', 'A3'),
        fc.constantFrom<Orientation>('portrait', 'landscape'),
        (size, page, orientation) => {
          const bounds: Rect = { x: 0, y: 0, w: size.w, h: size.h }
          for (const one of suggestionsFor(bounds, page, orientation)) {
            expect(fitCheck(bounds, one.page, one.orientation, one.scale).fits).toBe(true)
          }
        },
      ),
    )
  })
})
