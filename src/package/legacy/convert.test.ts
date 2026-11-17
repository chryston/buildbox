/**
 * One test per fixture, plus acceptance criteria 4–9 of #43. Every fixture the issue names
 * is discovered from disk, so a fixture added later is converted here or the run is shorter
 * than the folder.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../lib'
import { validateProject } from '../../domain'
import { convertLegacy, type LegacyConversion, type LegacyConversionResult } from '../index'

const fixturesRoot = fileURLToPath(new URL('../../../fixtures/legacy', import.meta.url))
const read = (rel: string): string => readFileSync(join(fixturesRoot, rel), 'utf8')
const listed = (dir: string, suffix: string): string[] =>
  readdirSync(join(fixturesRoot, dir)).filter((name) => name.endsWith(suffix)).sort().map((name) => `${dir}/${name}`)

const STORE_FIXTURES = ['v0', 'v1', 'v2', 'v3', 'v3-large-image'].map((name) => `${name}/buildbox-store.json`)
const WORKSPACE_FIXTURES = listed('workspace', '.buildbox.json')
const PLAN_FIXTURES = listed('floor-plan', '.json')

/** A fresh allocator per call: two runs of the same sequence must agree (#43 criterion 10). */
const allocator = (): (() => string) => {
  let issued = 0
  return () => `gen-${++issued}`
}

const convert = (raw: string): Promise<LegacyConversionResult> => convertLegacy(raw, { newId: allocator() })

/** The whole conversion as one string, with the image bytes reduced to their hash. */
function serialise(conversion: LegacyConversion): string {
  return canonicalJson({
    ...conversion,
    assets: conversion.assets.map((asset) => ({
      sha256: asset.sha256,
      mediaType: asset.mediaType,
      bytes: Buffer.from(asset.bytes).toString('hex'),
    })),
  })
}

/** The conversion of a fixture that must succeed, or a failure that names itself. */
async function conversionOf(rel: string): Promise<LegacyConversion> {
  const result = await convert(read(rel))
  if (!result.ok) throw new Error(`${rel}: ${JSON.stringify(result.problems)}`)
  return result.conversion
}

const okProjects = (conversion: LegacyConversion) =>
  conversion.projects.flatMap((proposal) => (proposal.status === 'ok' ? [proposal] : []))

const storeCases = STORE_FIXTURES.map((path) => ({ path, version: Number(/v(\d)/.exec(path)?.[1]) }))

describe('every legacy source converts (#43 criterion 4)', () => {
  it.each(storeCases)('$path store envelope', async ({ path, version }) => {
    const conversion = await conversionOf(path)

    expect(conversion.source).toBe('store')
    expect(conversion.legacyVersion).toBe(version)
    expect(conversion.projects.length).toBeGreaterThan(0)
    expect(conversion.projects.map((proposal) => proposal.status)).toEqual(
      conversion.projects.map(() => 'ok'),
    )
    expect(conversion.floorPlan?.status ?? 'ok').toBe('ok')
    for (const proposal of okProjects(conversion)) expect(validateProject(proposal.project).ok).toBe(true)
  })

  it.each(WORKSPACE_FIXTURES)('$path workspace file', async (path) => {
    const conversion = await conversionOf(path)

    expect(conversion.source).toBe('workspace-file')
    expect(conversion.legacyVersion).toBe(1)
    // A workspace file carries no floor plan, so there is nothing to offer the review.
    expect(conversion.floorPlan).toBeNull()
    expect(conversion.projects.length).toBeGreaterThan(0)
    expect(conversion.projects.map((proposal) => proposal.status)).toEqual(
      conversion.projects.map(() => 'ok'),
    )
    for (const proposal of okProjects(conversion)) expect(validateProject(proposal.project).ok).toBe(true)
  })

  it.each(PLAN_FIXTURES)('$path floor-plan file', async (path) => {
    const conversion = await conversionOf(path)

    expect(conversion.source).toBe('floor-plan-file')
    expect(conversion.legacyVersion).toBe(3)
    expect(conversion.projects).toEqual([])
    expect(conversion.floorPlan?.status).toBe('ok')
  })

  it('names the source it could not read instead of guessing', async () => {
    expect(await convertLegacy('{"nonsense":true}', { newId: allocator() })).toEqual({
      ok: false,
      problems: [{
        path: '',
        code: 'unknown-source',
        message: 'Expected saved BuildBox data, a workspace file, or a floor plan.',
      }],
    })
    expect(await convertLegacy('{not json', { newId: allocator() })).toMatchObject({
      ok: false,
      problems: [{ path: '', code: 'bad-json' }],
    })
    expect(await convertLegacy('{"state":{"projects":[]},"version":3}', { newId: allocator() })).toMatchObject({
      ok: false,
      problems: [{ path: 'projects', code: 'empty-list' }],
    })
    expect(await convertLegacy('{"state":{"projects":[]},"version":9}', { newId: allocator() })).toMatchObject({
      ok: false,
      problems: [{ path: 'version', code: 'newer-version' }],
    })
  })
})

describe('the floor plan travels separately (#43 criteria 5 and 6)', () => {
  it('hashes the ~4 MB image once and copies the calibration exactly', async () => {
    const conversion = await conversionOf('v3-large-image/buildbox-store.json')
    const plan = conversion.floorPlan
    if (plan === null || plan.status !== 'ok') throw new Error(JSON.stringify(plan))

    const stored = JSON.parse(read('v3-large-image/buildbox-store.json')) as {
      state: { floorPlan: { image: { dataUrl: string } | null } }
    }
    const body = stored.state.floorPlan.image?.dataUrl.split(',')[1] ?? ''
    const bytes = Buffer.from(body, 'base64')
    const hash = createHash('sha256').update(bytes).digest('hex')

    expect(plan.content.planImage).toMatchObject({ assetHash: hash, mediaType: 'image/png', widthPx: 1200, heightPx: 1000 })
    // This fixture's plan was never calibrated, and that stays a null rather than a 1.
    expect(plan.content.planImage?.pixelsPerMm).toBeNull()
    expect(conversion.assets).toHaveLength(1)
    expect(conversion.assets[0]?.sha256).toBe(hash)
    expect(Buffer.from(conversion.assets[0]?.bytes ?? new Uint8Array()).equals(bytes)).toBe(true)
  })

  it('counts the discarded sketches and leaves no trace of them', async () => {
    const conversion = await conversionOf('edge-cases/floor-plan-sketches.json')
    const plan = conversion.floorPlan
    if (plan === null || plan.status !== 'ok') throw new Error(JSON.stringify(plan))

    expect(plan.discarded).toEqual({ wallHack: 3, tileZone: 2 })
    expect(plan.isEmpty).toBe(false)

    const output = serialise(conversion)
    for (const id of ['sk-wall-1', 'sk-wall-2', 'sk-wall-3', 'sk-tile-1', 'sk-tile-2']) {
      expect(output).not.toContain(id)
    }
    // Only the one object and the one template survive; the five sketches are gone.
    expect(plan.content.itemDesigns).toHaveLength(2)
    expect(plan.content.placements).toHaveLength(1)
  })

  it('calls an untouched floor plan empty, and a store without one absent', async () => {
    const empty = await conversionOf('v0/buildbox-store.json')
    const plan = empty.floorPlan
    if (plan === null || plan.status !== 'ok') throw new Error(JSON.stringify(plan))

    expect(plan.isEmpty).toBe(true)
    expect(plan.discarded).toEqual({ wallHack: 0, tileZone: 0 })
    expect(plan.content.planImage).toBeNull()
    expect(empty.assets).toEqual([])
  })
})

describe('the one automatic fix and every other rejection (#43 criteria 7 and 8)', () => {
  it('regenerates a repeated Cabinet Node id and reports its path', async () => {
    const conversion = await conversionOf('edge-cases/workspace-duplicate-node-id.buildbox.json')
    const [unitScope, nodeScope] = conversion.projects

    if (unitScope?.status !== 'ok' || nodeScope?.status !== 'ok') throw new Error('expected both to convert')
    expect(validateProject(unitScope.project).ok).toBe(true)
    expect(validateProject(nodeScope.project).ok).toBe(true)

    expect(unitScope.regeneratedIds).toEqual([
      {
        scope: 'unit',
        path: 'projects[1].units[1].id',
        oldId: 'unit-twin',
        newId: 'gen-2',
      },
    ])
    expect(nodeScope.regeneratedIds).toEqual([
      {
        scope: 'cabinet-node',
        path: 'projects[0].units[0].root.children[1].id',
        oldId: 'space-shared',
        newId: 'gen-1',
      },
    ])

    // The first holder of the name keeps it; only the second one moved.
    const [first] = nodeScope.project.itemDesigns
    if (first === undefined || first.kind !== 'cabinet') throw new Error('expected a cabinet')
    const children = 'children' in first.construction.root ? first.construction.root.children ?? [] : []
    expect(children.map((child) => child.id)).toEqual(['space-shared', 'gen-1'])
  })

  it('rejects the Design with an unknown field by its exact path and converts the rest', async () => {
    const conversion = await conversionOf('edge-cases/workspace-unknown-setting-field.buildbox.json')
    const [first, second] = conversion.projects

    expect(first?.designId).toBe('proj-linen-cabinet')
    expect(first?.status).toBe('ok')
    expect(second?.designId).toBe('proj-painted-cabinet')
    expect(second?.status).toBe('rejected')
    if (second?.status !== 'rejected') throw new Error('expected a rejection')
    expect(second.problems).toEqual([
      {
        path: 'itemDesigns[0].construction.settings.colour',
        code: 'unknown-field',
        message: 'Unknown field "colour" — nothing in this schema writes it.',
      },
    ])

    // A Design is never partially converted, and never leaks into a Project that passed.
    const survivors = JSON.stringify(okProjects(conversion).map((proposal) => proposal.project))
    expect(survivors).not.toContain('colour')
    expect(survivors).not.toContain('proj-painted-cabinet')
    expect(survivors).not.toContain('Painted Unit')
  })

  it('rejects only the floor plan when its image is malformed', async () => {
    const result = await convertLegacy(JSON.stringify({
      pixelsPerMm: null,
      image: { dataUrl: 'data:image/png;base64,###', widthPx: 4, heightPx: 4 },
      objects: [{ id: 'fp-1', type: 'sofa-3', label: 'Sofa', x: 0, y: 0, w: 2200, h: 900, rotation: 0, color: '#8d6e63' }],
      annotations: [],
      customTemplates: [],
    }), { newId: allocator() })
    if (!result.ok) throw new Error(JSON.stringify(result.problems))

    expect(result.conversion.floorPlan?.status).toBe('rejected')
  })
})

describe('the display unit stays inside the cabinet payload (#43 criterion 9)', () => {
  it('keeps settings.unit "in" and reports the Project in mm', async () => {
    const conversion = await conversionOf('v3/buildbox-store.json')
    const vanity = conversion.projects.find((proposal) => proposal.designId === 'proj-bath-vanity')
    if (vanity === undefined || vanity.status !== 'ok') throw new Error('expected the vanity to convert')

    const [unit] = vanity.project.itemDesigns
    if (unit === undefined || unit.kind !== 'cabinet') throw new Error('expected a cabinet')

    expect(unit.construction.settings.unit).toBe('in')
    expect(unit.construction.settings.width).toBe(42)
    expect(vanity.project.preferences).toEqual({ displayUnit: 'mm', displayPrecision: 0 })
  })
})

describe('proposals are ordered and repeatable', () => {
  it('puts the active Design first and legacy order after it', async () => {
    const conversion = await conversionOf('v3/buildbox-store.json')

    expect(conversion.projects.map((proposal) => proposal.designId))
      .toEqual(['proj-kitchen-wall', 'proj-bath-vanity'])
  })

  it('gives the same canonical JSON for the same input and allocator (#43 criterion 10)', async () => {
    for (const path of [...STORE_FIXTURES, ...WORKSPACE_FIXTURES, ...PLAN_FIXTURES]) {
      const raw = read(path)
      const first = await convertLegacy(raw, { newId: allocator() })
      const second = await convertLegacy(raw, { newId: allocator() })
      if (!first.ok || !second.ok) throw new Error(`${path}: ${JSON.stringify(first)}`)

      expect(serialise(first.conversion)).toBe(serialise(second.conversion))
    }
  })
})
