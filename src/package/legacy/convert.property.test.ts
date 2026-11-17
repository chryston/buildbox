/**
 * What #43 promises about inputs nobody thought of:
 *
 * - the JSON key order of a file means nothing — the same bytes in any order convert to the
 *   same result;
 * - a generated legacy `Design` never throws, and whatever comes back is either a strictly
 *   valid domain v1 `Project` or a non-empty list of problems that name a rule;
 * - the same input twice is the same output, so a re-run of the review shows the same thing.
 *
 * Seeds are fixed, so CI replays the same values on every machine.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { validateProject } from '../../domain'
import { canonicalJson, type ValidationProblem } from '../../lib'
import { convertLegacy, type LegacyConversion } from '../index'

const fixturesRoot = fileURLToPath(new URL('../../../fixtures/legacy', import.meta.url))
const read = (rel: string): string => readFileSync(join(fixturesRoot, rel), 'utf8')

const SEED = 20_260_117
const NUM_RUNS = 200
const params = { numRuns: NUM_RUNS, seed: SEED }

const allocator = (): (() => string) => {
  let issued = 0
  return () => `gen-${++issued}`
}

/** Deterministic PRNG: `Math.random` has no place in a pure module, even a test one. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The same object with every object's keys written in a different order. */
function shuffledKeys(value: unknown, rand: () => number): unknown {
  if (Array.isArray(value)) return value.map((item) => shuffledKeys(item, rand))
  if (value === null || typeof value !== 'object') return value

  const entries = Object.entries(value as Record<string, unknown>)
  for (let at = entries.length - 1; at > 0; at -= 1) {
    const swap = Math.floor(rand() * (at + 1))
    const held = entries[at] as [string, unknown]
    entries[at] = entries[swap] as [string, unknown]
    entries[swap] = held
  }
  return Object.fromEntries(entries.map(([key, item]) => [key, shuffledKeys(item, rand)]))
}

/**
 * A fingerprint of a conversion. The decoded image bytes are reduced to their length:
 * canonical JSON is for plain values, and 3.6 MB of pixel indexes are not the point.
 */
function fingerprint(source: LegacyConversion): string {
  return canonicalJson({
    ...source,
    assets: source.assets.map((asset) => ({ ...asset, bytes: asset.bytes.byteLength })),
  })
}

const wellFormed = (problems: ValidationProblem[]): boolean =>
  problems.every((problem) =>
    typeof problem.path === 'string'
    && typeof problem.code === 'string'
    && problem.code.length > 0
    && typeof problem.message === 'string'
    && problem.message.length > 0)

// --- Key order is not data -----------------------------------------------------

const FIXTURES = [
  'v0/buildbox-store.json',
  'v1/buildbox-store.json',
  'v2/buildbox-store.json',
  'v3/buildbox-store.json',
  'floor-plan/with-image-floor-plan.json',
  'floor-plan/no-image-floor-plan.json',
  'workspace/all-projects.buildbox.json',
  'edge-cases/floor-plan-sketches.json',
  'edge-cases/workspace-duplicate-node-id.buildbox.json',
]

describe('key order is not data (#43)', () => {
  it.each(FIXTURES)('converts %s the same however its keys are written', async (fixture) => {
    const raw = read(fixture)
    const baseline = await convertLegacy(raw, { newId: allocator() })
    if (!baseline.ok) throw new Error(`${fixture}: ${JSON.stringify(baseline.problems)}`)
    const expected = fingerprint(baseline.conversion)

    await fc.assert(fc.asyncProperty(fc.nat(0xffff_ffff), async (seed) => {
      const shuffled = JSON.stringify(shuffledKeys(JSON.parse(raw) as unknown, mulberry32(seed)))
      const again = await convertLegacy(shuffled, { newId: allocator() })
      if (!again.ok) throw new Error(`${fixture}: reordering keys broke it: ${JSON.stringify(again.problems)}`)
      expect(fingerprint(again.conversion)).toBe(expected)
    }), { numRuns: 25, seed: SEED })
  })
})

// --- Generated legacy Designs ---------------------------------------------------

const arbId = fc.string({ unit: fc.constantFrom(...'abcdefghijklmnop0123456789-'.split('')), minLength: 1, maxLength: 12 })
const arbSize = fc.integer({ min: 1, max: 3000 })

/** A leaf: an element space, sometimes still carrying the node-level `material` (#20 §3). */
const arbLeaf: fc.Arbitrary<Record<string, unknown>> = fc.record({
  id: arbId,
  elementType: fc.constantFrom('void' as const, 'drawer' as const, 'hanging-space' as const, 'microwave' as const),
  spaceLabel: fc.option(fc.string({ maxLength: 8 }), { nil: undefined }),
  material: fc.option(fc.constantFrom('oak', 'walnut', 'white'), { nil: undefined }),
})

/** A split of two of whatever the level below allows. */
const split = (child: fc.Arbitrary<Record<string, unknown>>): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({
    id: arbId,
    splitAxis: fc.constantFrom('horizontal' as const, 'vertical' as const),
    splitRatio: fc.integer({ min: 10, max: 90 }).map((percent) => percent / 100),
    children: fc.tuple(child, child),
    fixedSize: fc.option(arbSize, { nil: undefined }),
  })

const arbNode = fc.oneof(arbLeaf, split(arbLeaf))
/** Two levels deep, which is deeper than any fixture and shallow enough to read a failure. */
const arbRoot = fc.oneof(arbLeaf, split(arbNode))

const arbSettings = fc.record({
  unit: fc.constantFrom('mm' as const, 'cm' as const, 'in' as const),
  height: arbSize,
  width: arbSize,
  depth: arbSize,
  thickness: fc.integer({ min: 1, max: 40 }),
  backThickness: fc.integer({ min: 1, max: 40 }),
  toeKick: fc.option(fc.record({ height: fc.integer({ min: 0, max: 200 }), setback: fc.integer({ min: 0, max: 200 }) }), { nil: null }),
  material: fc.constantFrom('oak' as const, 'walnut' as const, 'white' as const, 'birch' as const, 'mdf' as const),
})

const arbUnit: fc.Arbitrary<Record<string, unknown>> = fc.record({
  type: fc.constant('cabinet' as const),
  id: arbId,
  label: fc.string({ maxLength: 12 }),
  x: fc.integer({ min: -5000, max: 5000 }),
  y: fc.integer({ min: -5000, max: 5000 }),
  settings: arbSettings,
  root: arbRoot,
})

/** A v3 store envelope holding one to three Designs, sometimes sharing an ID on purpose. */
const arbStore = fc.tuple(arbId, fc.array(arbUnit, { minLength: 1, maxLength: 3 })).chain(([designId, units]) =>
  fc.record({
    version: fc.constant(3),
    state: fc.record({
      projects: fc.array(
        fc.record({
          id: fc.oneof(fc.constant(designId), arbId),
          name: fc.string({ maxLength: 20 }),
          units: fc.constant(units),
        }),
        { minLength: 1, maxLength: 3 },
      ),
      activeProjectId: fc.constant(designId),
    }),
  }))

describe('a generated legacy Design never throws (#43)', () => {
  it('answers with a valid Project or with problems that name a rule', async () => {
    await fc.assert(fc.asyncProperty(arbStore, async (store) => {
      const raw = JSON.stringify(store)
      const result = await convertLegacy(raw, { newId: allocator() })

      if (!result.ok) {
        expect(result.problems.length).toBeGreaterThan(0)
        expect(wellFormed(result.problems)).toBe(true)
        return
      }
      // One proposal per Design, whatever the shape it turned out to have.
      expect(result.conversion.projects).toHaveLength(store.state.projects.length)
      for (const proposal of result.conversion.projects) {
        if (proposal.status === 'rejected') {
          expect(proposal.problems.length).toBeGreaterThan(0)
          expect(wellFormed(proposal.problems)).toBe(true)
          continue
        }
        const checked = validateProject(proposal.project)
        expect(checked.ok, `${proposal.designId}: ${JSON.stringify(checked.ok ? [] : checked.problems)}`).toBe(true)
        // Every cabinet that came in survives as exactly one Item Design.
        const incoming = store.state.projects.find((design) => design.id === proposal.designId)
        expect(proposal.project.itemDesigns.filter((item) => item.kind === 'cabinet'))
          .toHaveLength(incoming?.units.length ?? 0)
      }
    }), params)
  })

  it('is deterministic: the same bytes convert to the same result twice', async () => {
    await fc.assert(fc.asyncProperty(arbStore, async (store) => {
      const raw = JSON.stringify(store)
      const first = await convertLegacy(raw, { newId: allocator() })
      const second = await convertLegacy(raw, { newId: allocator() })
      expect(second.ok).toBe(first.ok)
      if (!first.ok || !second.ok) {
        expect(second.ok ? [] : second.problems).toEqual(first.ok ? [] : first.problems)
        return
      }
      expect(fingerprint(second.conversion)).toBe(fingerprint(first.conversion))
    }), params)
  })
})
