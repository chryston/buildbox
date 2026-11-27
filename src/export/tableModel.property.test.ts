/**
 * Criterion 1, as a property (#84): the printed rows *are* the CSV's rows.
 *
 * The example tests in `tableModel.test.ts` say what a printed cell looks like. This says the thing
 * no example can: for any valid Project and any recipe, every printed cell is the CSV cell in the
 * same place, put through the printing rule and nothing else — same columns, same rows, same order,
 * one cell per column.
 *
 * The left-hand side is the model. The right-hand side is re-derived here from the CSV bytes
 * `exportLists` writes, by a function that knows only the column's kind and the Project's display
 * preference. It is deliberately a second implementation: sharing a helper with `tableModel` would
 * make the property true by construction and the criterion untested.
 *
 * Every generated Project is validated before anything reads it. An invalid one makes the derivations
 * answer "nothing", and a property over empty tables passes — which is how a broken generator looks
 * green. The last test is the guard against exactly that.
 */
import { describe, expect, test } from 'vitest'
import * as fc from 'fast-check'
import { COMMENT_SCOPE_ALL, validateProject } from '../domain'
import type { Comment, CommentAnchor, CommentPriority, CommentStatus, DesignOption, DisplayUnit, Project } from '../domain'
import type { QuantityScope, RenovationState } from '../derive'
import { arbProject, withComments } from '../domain/testing'
import { compareCodePoints } from '../lib'
import { TABLES } from './csv/tables'
import type { Column, ListTableId } from './csv/tables'
import { exportLists } from './lists'
import { parseCsv } from './testing'
import { CODE_LABELS } from './strings'
import { lengthWords, tableModel, timestampWords } from './tableModel'
import type { ExportSnapshot, ListsRecipe } from './types'

const DEPS = {
  clock: { now: () => '2026-11-28T09:00:00.000Z', localDate: () => '2026-11-28' },
  buildboxVersion: '0.0.0-test',
}

/** The one Design Option this file ever adds, so a generated Anchor has something real to name. */
const OPTION_ID = 'opt-generated'
const OPTION_NAME = 'Option One'

/**
 * The alphabet the generated text is drawn from.
 *
 * A fixed alphabet rather than `fc.fullUnicodeString`, for two reasons: a Comment title may hold no
 * control character and a body only tab, LF and CR, and this set is what the validator allows; and it
 * carries the characters the printing rules are about — a leading `=` the CSV neutralises, a `·` in a
 * target label, CJK and a `✓` the embedded face cannot draw.
 */
const LETTERS = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ']
const WORD_CHARS = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,-;:!?/()=+@·—']
const BODY_EXTRA = ['\n', '\t', '\r', '\n', '书', '櫃', '✓', '½', 'é']

/** A title the validator will accept: `checkFilledText` wants something that is not only spacing. */
const arbTitle = fc
  .tuple(fc.constantFrom(...LETTERS), fc.string({ unit: fc.constantFrom(...WORD_CHARS), maxLength: 38 }))
  .map(([first, rest]) => `${first}${rest}`)
const arbBody = fc.string({ unit: fc.constantFrom(...WORD_CHARS, ...BODY_EXTRA), maxLength: 120 })

/** The instants a Comment may carry: whole minutes, a millisecond, and one that is not a whole hour. */
const STAMPS = ['2026-01-02T03:04:05.000Z', '2026-11-25T09:00:00.000Z', '2026-07-31T23:59:59.999Z', '2025-03-09T00:30:00.000Z'] as const

const arbSeed: fc.Arbitrary<CommentSeed> = fc.record({
  kind: fc.constantFrom<CommentAnchor['kind']>('project', 'floor', 'item_design', 'floor_point', 'entity', 'design_option'),
  pick: fc.nat({ max: 4096 }),
  scopeAll: fc.boolean(),
  status: fc.constantFrom<CommentStatus>('open', 'resolved'),
  priority: fc.constantFrom<CommentPriority>('low', 'normal', 'high'),
  title: arbTitle,
  body: arbBody,
  created: fc.constantFrom(...STAMPS),
  updated: fc.constantFrom(...STAMPS),
  resolved: fc.constantFrom(...STAMPS),
})

/**
 * One Comment before its Anchor is pointed at anything real.
 *
 * The Anchor is an index rather than an ID because the Project has not been generated yet: `anchorOf`
 * resolves `pick` against whatever the Project turned out to hold, and falls back to a Project Anchor
 * when there is nothing of that kind to name.
 */
interface CommentSeed {
  readonly kind: CommentAnchor['kind']
  readonly pick: number
  readonly scopeAll: boolean
  readonly status: CommentStatus
  readonly priority: CommentPriority
  readonly title: string
  readonly body: string
  readonly created: string
  readonly updated: string
  readonly resolved: string
}

/** The generated case: a Project, the Comments to hang on it, and the recipe the person chose. */
interface Generated {
  readonly project: Project
  readonly seeds: readonly CommentSeed[]
  readonly addOption: boolean
  readonly existingOnly: boolean
  readonly floorEvery: number
  readonly states: readonly RenovationState[]
  readonly allLayers: boolean
  readonly includeResolvedComments: boolean
}

const arbGenerated: fc.Arbitrary<Generated> = fc.record({
  project: arbProject().map((project) => withComments(project)),
  seeds: fc.array(arbSeed, { maxLength: 7 }),
  addOption: fc.boolean(),
  existingOnly: fc.boolean(),
  floorEvery: fc.integer({ min: 1, max: 3 }),
  states: fc.subarray(['existing', 'demolition', 'proposed'] as const, { minLength: 1 }),
  allLayers: fc.boolean(),
  includeResolvedComments: fc.boolean(),
})

/** The Register's three timestamps, by `table:header` — the same rule `tableModel` applies. */
const TIMESTAMP_HEADERS: Readonly<Record<string, true>> = {
  'comments:created_at': true,
  'comments:updated_at': true,
  'comments:resolved_at': true,
}

/**
 * The printing rule, applied to one CSV field.
 *
 * Reads the CSV's own text and nothing else — no row object, no `derive` call — so the equality below
 * compares two independent paths to the same page.
 */
function printedCell(table: ListTableId, column: Column, field: string, unit: DisplayUnit, precision: number): string {
  // Only a `text` column is neutralised, and only when the text really began with a formula lead; an
  // `id`, `enum` or `multi` field is written verbatim, so an apostrophe in one is content.
  const value = column.kind === 'text' && field.startsWith("'") && /^[=+\-@\t\r]/.test(field.slice(1)) ? field.slice(1) : field
  if (TIMESTAMP_HEADERS[`${table}:${column.header}`] === true) return timestampWords(value)
  switch (column.kind) {
    case 'length_mm':
      return lengthWords(Number(value), unit, precision)
    case 'area_m2':
      return (Number(value) / 1_000_000).toFixed(2)
    case 'angle_deg':
      return Number(value).toFixed(1)
    case 'integer':
      return value
    case 'enum':
      return CODE_LABELS[`${table}:${column.header}`]?.[value] ?? value
    case 'multi':
      return value === '' ? '' : value.split(';').sort(compareCodePoints).join(';')
    case 'id':
    case 'text':
      return value
  }
}

/** The recipe of one generated case, for one table. */
function recipeOf(built: Built, table: ListTableId): ListsRecipe {
  return { tables: [table], scope: built.scope, includeResolvedComments: built.includeResolvedComments }
}

interface Built {
  readonly project: Project
  readonly scope: QuantityScope
  readonly includeResolvedComments: boolean
}

describe('the printed rows are the CSV rows (#84 criterion 1)', () => {
  for (const table of ['items', 'cut-list', 'comments'] as const) {
    test(`every ${table} cell is the CSV cell in its place, printed`, async () => {
      await fc.assert(
        fc.asyncProperty(arbGenerated, async (generated) => {
          const built = build(generated)
          const snapshot: ExportSnapshot = { project: built.project, revision: 1 }
          const recipe = recipeOf(built, table)
          const model = tableModel(snapshot, recipe, table)
          const result = await exportLists(snapshot, recipe, DEPS)
          if (!result.ok) throw new Error(`the lists export refused a valid Project: ${JSON.stringify(result.failures)}`)
          if (result.kind !== 'single') throw new Error(`one table wrote more than one file`)
          const [header, ...rows] = parseCsv(result.file.bytes).rows
          if (header === undefined) throw new Error('the CSV has no header line')

          // The same columns, in the same order: the printed heading line and the CSV heading line are
          // one list of contract headers.
          expect(model.columns.map((column) => column.header)).toEqual([...header])
          // The same number of rows, and the same row in the same place.
          expect(model.rows.length).toBe(rows.length)
          for (const [index, row] of rows.entries()) {
            const printed = model.rows[index]
            if (printed === undefined || row === undefined) throw new Error(`row ${index} went missing`)
            expect(printed.length).toBe(row.length)
            for (const [at, field] of row.entries()) {
              const column = TABLES[table].columns[at]
              if (column === undefined) throw new Error('the CSV wrote a column the spec does not have')
              expect(printed[at]).toBe(printedCell(table, column, field, model.unit, model.precision))
            }
          }
        }),
        { numRuns: 150, seed: 20261128 },
      )
    })
  }

  test('the generator is not printing nothing', () => {
    // A property over empty tables is also true of a broken generator, so the generator's own output is
    // held to: across the run the tables are populated and the code columns really take every value.
    const seen = new Set<string>()
    let itemRows = 0
    let commentRows = 0
    let cutRows = 0
    fc.assert(
      fc.property(arbGenerated, (generated) => {
        const built = build(generated)
        const snapshot: ExportSnapshot = { project: built.project, revision: 1 }
        const items = tableModel(snapshot, recipeOf(built, 'items'), 'items')
        const cuts = tableModel(snapshot, recipeOf(built, 'cut-list'), 'cut-list')
        const register = tableModel(snapshot, recipeOf(built, 'comments'), 'comments')
        itemRows += items.rows.length
        cutRows += cuts.rows.length
        commentRows += register.rows.length
        for (const row of items.rows) seen.add(row[4]!)
        for (const row of register.rows) {
          seen.add(row[3]!)
          seen.add(row[4]!)
        }
      }),
      { numRuns: 150, seed: 20261128 },
    )
    expect(itemRows).toBeGreaterThan(20)
    expect(cutRows).toBeGreaterThan(20)
    expect(commentRows).toBeGreaterThan(20)
    // The words the generator is guaranteed to reach. Which renovation states appear is the
    // generator's geometry, not its choice, so the guard asks only for the one every Project has
    // alongside the four Comment words that no scope can hide once a Comment is resolved.
    for (const word of ['Existing', 'Open', 'Resolved', 'Low', 'High']) expect(seen.has(word)).toBe(true)
  })
})

// --------------------------------------------------------------- building one case from a seed

/**
 * The Project and the scope one generated case stands for.
 *
 * The Project is validated before anything reads it, and a failure here is a bug in this file's
 * generator rather than in the code under test — which is the only reason throwing is the right
 * answer: a silently invalid Project would make every assertion above vacuous.
 */
function build(generated: Generated): Built {
  const withNotes = withOptionComments(generated.project, generated.addOption, generated.seeds)
  const floors = withNotes.floors
  const options = withNotes.designOptions ?? []
  const layers = withNotes.drawingLayers ?? []
  const scope: QuantityScope = {
    floorIds: floors.filter((_, index) => index % generated.floorEvery === 0).map((floor) => floor.id),
    designOptionIds: generated.existingOnly || options.length === 0
      ? 'existing-only'
      : options.map((option) => option.id),
    renovationStates: generated.states,
    drawingLayers: generated.allLayers
      ? 'all'
      : { layerIds: layers.map((layer) => layer.id), includeUnlayered: false },
  }
  return { project: withNotes, scope, includeResolvedComments: generated.includeResolvedComments }
}

/**
 * The Project with its Design Option and its Comments, validated on the way out.
 *
 * The Option holds a copy of one Existing Model Placement, so that an Option-scoped Anchor and an
 * Option-scoped scope both name something the Project really has — which is what makes the Register's
 * `design_option` and `existing_model` cells reachable.
 */
function withOptionComments(project: Project, addOption: boolean, seeds: readonly CommentSeed[]): Project {
  const empty = { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [], services: [], skirting: [], beams: [] }
  const source = project.existingModel.placedItems[0]
  const option: DesignOption = {
    id: OPTION_ID,
    name: OPTION_NAME,
    demolishedIds: [],
    proposed: source === undefined ? empty : { ...empty, placedItems: [{ ...source, id: `${source.id}-opt`, predecessorIds: [] }] },
  }
  const withOption = addOption ? { ...project, designOptions: [option] } : project
  const comments = seeds.map((seed, index) => commentOf(withOption, seed, index))
  const built = { ...withOption, comments, commentReferenceCounter: comments.length }
  const checked = validateProject(built)
  if (!checked.ok) throw new Error(`the generated Project stopped validating: ${JSON.stringify(checked.problems)}`)
  return built
}

/** One generated Comment, its Anchor pointed at something the Project really has. */
function commentOf(project: Project, seed: CommentSeed, index: number): Comment {
  const anchor = anchorOf(project, seed)
  const chooses = anchor.kind === 'project' || anchor.kind === 'floor' || anchor.kind === 'item_design' || anchor.kind === 'floor_point'
  return {
    id: `comment-${index}`,
    reference: `C-${String(index + 1).padStart(3, '0')}`,
    title: seed.title,
    body: seed.body,
    anchor,
    status: seed.status,
    priority: seed.priority,
    createdAt: seed.created,
    updatedAt: seed.updated,
    ...(seed.status === 'resolved' ? { resolvedAt: seed.resolved } : {}),
    ...(chooses ? { scope: seed.scopeAll || (project.designOptions ?? []).length === 0 ? COMMENT_SCOPE_ALL : OPTION_ID } : {}),
  }
}

/**
 * The Anchor a seed asks for, or a Project Anchor when the Project has nothing of that kind.
 *
 * `entity` names anything in the Existing Model — a Wall, a Room, a Placement — because that is the
 * widest set of IDs a generated Project is sure to hold, and it is the Anchor whose scope is inherited
 * rather than chosen. `feature` is never generated: a feature ID belongs to one Item Design's
 * construction, and inventing one would make the Anchor unresolvable, which the validator is right to
 * refuse.
 */
function anchorOf(project: Project, seed: CommentSeed): CommentAnchor {
  const at = (list: readonly { id: string }[]): string | undefined =>
    list.length === 0 ? undefined : list[seed.pick % list.length]!.id
  switch (seed.kind) {
    case 'floor': {
      const floorId = at(project.floors)
      return floorId === undefined ? { kind: 'project' } : { kind: 'floor', floorId }
    }
    case 'item_design': {
      const itemDesignId = at(project.itemDesigns)
      return itemDesignId === undefined ? { kind: 'project' } : { kind: 'item_design', itemDesignId }
    }
    case 'floor_point': {
      const floorId = at(project.floors)
      return floorId === undefined
        ? { kind: 'project' }
        : { kind: 'floor_point', floorId, point: { x: (seed.pick % 5000) - 2500, y: (seed.pick % 7000) / 4 } }
    }
    case 'entity': {
      const model = project.existingModel
      const entityId = at([
        ...model.walls,
        ...model.openings,
        ...model.rooms,
        ...model.placedItems,
        ...(model.services ?? []),
        ...(model.skirting ?? []),
        ...(model.beams ?? []),
      ])
      return entityId === undefined ? { kind: 'project' } : { kind: 'entity', entityId }
    }
    case 'design_option': {
      const option = (project.designOptions ?? [])[0]
      return option === undefined ? { kind: 'project' } : { kind: 'design_option', designOptionId: option.id }
    }
    case 'project':
    case 'feature':
      return { kind: 'project' }
  }
}
