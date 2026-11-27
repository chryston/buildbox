/**
 * The Comment Register: which Comments the file lists, what each row says, and the bytes it holds
 * (#83 §4, criteria 9 to 15).
 *
 * `./comments` is deliberately absent from `src/export/index.ts` — the Register reaches a reader
 * through `exportLists` and `listsSummary`, and a second public name for the same predicate would
 * be a second answer to "is this Comment in the file?". So this file imports it directly.
 *
 * The Project is the committed Notes scene, `fixtures/e2e/preview-seed/notes-review-scene.json`,
 * grown by `scripts/make-notes-review-seed.ts`, because the criteria name its Comments: C-001 on
 * the Project, C-002 on a Floor, C-003 a Floor Point, C-004 on the second `Base 600`, C-005 the
 * Resolved one on a Wall, C-006 on a Wall face, C-007 on the Island, C-008 on the second Floor.
 * Two things the issue says about that scene are true of the scene the seed script grows rather
 * than of the issue's own sketch, and the tests follow the file: the Floor is named `Floor 1`, not
 * `Ground Floor`, and the Floor Point Comment whose label criterion 13 quotes is C-003, not C-006,
 * which is the Wall-face Comment. The scene also carries no Design Options at all — on purpose,
 * because deleting Existing work while Options exist is refused before the notes question is
 * reached — so the Option half of criterion 10 runs against the same scene with Option A and
 * Option B added and the Island moved into Option B, which is the variant
 * `src/integration/notesReviewOptionsFlow.test.tsx` already uses for the same reason. A Comment
 * inherits its scope from its subject, so that is what makes C-007 an Option B Comment.
 *
 * The golden is the whole file the Lists tab writes for the scene at the issue's default scope,
 * BOM included, so it is the bytes a reader gets. It moves only when the Register's content moves,
 * and it moves on purpose:
 *
 *   UPDATE_GOLDEN=1 npx vitest run --project pure src/export/comments.test.ts
 *
 * then read the diff.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { anchorChoosesScope, cabinetFeatureIds, COMMENT_SCOPE_ALL, migrateProject, validateProject } from '../domain'
import type { Comment, CommentAnchor, ItemDesign, Project } from '../domain'
import type { QuantityScope } from '../derive'
import { commentIsInRegister, commentRegisterRows, commentScopeStatement } from './comments'
import { COMMENTS_TABLE, headerLine } from './csv/tables'
import { exportLists, listsSummary } from './lists'
import { parseCsv } from './testing'

const UPDATE = process.env['UPDATE_GOLDEN'] === '1'
const FIXTURES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const GOLDEN_DIR = join(FIXTURES_ROOT, 'export', 'golden')
const SCENE_FIXTURE = join(FIXTURES_ROOT, 'e2e', 'preview-seed', 'notes-review-scene.json')

/** The thirteen columns export contract §7.4 publishes, spelled from the contract. */
const HEADER = 'reference,title,body,status,priority,created_at,updated_at,resolved_at,scope,floor,design_option,target_type,target_label'

/** Every Comment in the scene carries the seed script's one timestamp. */
const STAMP = '2026-11-25T09:00:00.000Z'

/** A clock and a version, so the file name is the only place a date could come from. */
const DEPS = { clock: { now: (): string => '2026-11-28T09:00:00.000Z', localDate: (): string => '2026-11-28' }, buildboxVersion: '0.0.0-test' }

/** The scene as the app holds it: migrated by the chain the app runs, then validated. */
function loadScene(): Project {
  const envelope = JSON.parse(readFileSync(SCENE_FIXTURE, 'utf8')) as { projects: { schemaVersion: number; data: unknown }[] }
  const record = envelope.projects[0]!
  const migrated = migrateProject(record.data, record.schemaVersion, () => [])
  if (!migrated.ok) throw new Error(`the Notes scene no longer migrates: ${migrated.error.message}`)
  const project = migrated.project as Project
  // An invalid Project is worse than a red test here: every predicate below would answer
  // "nothing" and the Register would look empty rather than broken.
  const checked = validateProject(project)
  if (!checked.ok) throw new Error(`the Notes scene no longer validates: ${JSON.stringify(checked.problems)}`)
  // Every test names the scene's Comments and Floors by the names the seed script gives them.
  const floors = project.floors.map((floor) => floor.name).join(' / ')
  const references = project.comments.map((comment) => comment.reference).join(' ')
  if (floors !== 'Floor 1 / Level 2' || references !== 'C-001 C-002 C-003 C-004 C-005 C-006 C-007 C-008') {
    throw new Error(`the Notes scene is not the one these tests name: ${floors} — ${references}`)
  }
  return project
}

/** A variant this file builds, held to the same bar as the fixture. */
function validated(project: Project): Project {
  const checked = validateProject(project)
  if (!checked.ok) throw new Error(`a test Project stopped validating: ${JSON.stringify(checked.problems)}`)
  return project
}

const scene = loadScene()
const GROUND_ID = scene.floors[0]!.id
const UPPER_ID = scene.floors[1]!.id
const OPTION_A = 'option-a'
const OPTION_B = 'option-b'

const cabinetDesign = scene.itemDesigns.find((design) => design.kind === 'cabinet') as ItemDesign | undefined
if (cabinetDesign === undefined || cabinetDesign.kind !== 'cabinet') throw new Error('the Notes scene lost the cabinet Item Design its Comments hang off')
/** The shelf of `Base Unit`, the one Item Design the scene shares between two placements. */
const SHELF_FEATURE = cabinetFeatureIds(cabinetDesign.construction.root).find((id) => id.endsWith('shelf'))!

/**
 * The scene with the two Design Options the shipped file carries none of, and the Island moved
 * into Option B's proposed model: C-007 is the Island's Comment, and a Comment inherits its scope
 * from its subject, so this is what makes the issue's "choosing Option B adds C-007" testable.
 */
function sceneWithIslandInOptionB(): Project {
  const project = structuredClone(scene)
  const island = project.existingModel.placedItems.find((item) => item.id === 'fp-island')
  if (island === undefined) throw new Error('the Notes scene lost the Island its Comment hangs off')
  const empty = { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [], services: [], skirting: [], beams: [] }
  return validated({
    ...project,
    designOptions: [
      { id: OPTION_A, name: 'Option A', demolishedIds: [], proposed: empty },
      { id: OPTION_B, name: 'Option B', demolishedIds: [], proposed: { ...empty, placedItems: [{ ...island, predecessorIds: [] }] } },
    ],
    existingModel: { ...project.existingModel, placedItems: project.existingModel.placedItems.filter((item) => item.id !== 'fp-island') },
  })
}

/** A Comment written the way the domain stores it: a scope only where an Anchor cannot inherit one. */
function aComment(reference: string, over: Partial<Comment>): Comment {
  const anchor: CommentAnchor = over.anchor ?? { kind: 'project' }
  return {
    id: `comment-${reference}`,
    reference,
    title: `Note ${reference}`,
    body: 'A body the Register writes verbatim.',
    anchor,
    status: 'open',
    priority: 'normal',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...(anchorChoosesScope(anchor.kind) ? { scope: COMMENT_SCOPE_ALL } : {}),
    ...over,
  }
}

/** The three Anchor kinds the shipped scene holds no Comment on: a design, a design's feature, an Option. */
const DESIGN_NOTES: Comment[] = [
  aComment('C-901', { title: 'Handle direction on the design', anchor: { kind: 'item_design', itemDesignId: cabinetDesign.id } }),
  aComment('C-902', { title: 'The shelf is too shallow', anchor: { kind: 'feature', ownerId: cabinetDesign.id, featureId: SHELF_FEATURE } }),
  aComment('C-903', { title: 'Option B needs a taller hood', anchor: { kind: 'design_option', designOptionId: OPTION_B } }),
  aComment('C-904', { title: 'Only wanted under Option B', anchor: { kind: 'floor_point', floorId: GROUND_ID, point: { x: 1000, y: 1000 } }, scope: OPTION_B }),
]

function sceneWithDesignNotes(): Project {
  const base = sceneWithIslandInOptionB()
  return validated({ ...base, comments: [...base.comments, ...DESIGN_NOTES], commentReferenceCounter: 905 })
}

/** The issue's default scope: one Floor, Existing Model only, Open Comments only. */
function scopeWith(over: Partial<QuantityScope> = {}): QuantityScope {
  return {
    floorIds: [GROUND_ID],
    designOptionIds: 'existing-only',
    renovationStates: ['existing', 'demolition', 'proposed'],
    drawingLayers: 'all',
    ...over,
  }
}

const ALL_OPTIONS = { designOptionIds: [OPTION_A, OPTION_B] }

function note(project: Project, reference: string): Comment {
  const found = project.comments.find((comment) => comment.reference === reference)
  if (found === undefined) throw new Error(`this Project holds no ${reference}`)
  return found
}

const references = (project: Project, scope: QuantityScope, includeResolvedComments: boolean = false): string[] =>
  commentRegisterRows(project, scope, includeResolvedComments).map((row) => row.reference)

/** The Register as a reader gets it: the real Writer behind the Lists tab's one-table download. */
async function registerCsv(project: Project, scope: QuantityScope, includeResolvedComments: boolean = false): Promise<{ bytes: Uint8Array; text: string; records: Record<string, string>[] }> {
  const result = await exportLists({ project, revision: 7 }, { tables: ['comments'], scope, includeResolvedComments }, DEPS)
  if (!result.ok || result.kind !== 'single') throw new Error(`the Register refused to write: ${JSON.stringify(result)}`)
  const { rows } = parseCsv(result.file.bytes)
  const [header, ...lines] = rows
  return {
    bytes: result.file.bytes,
    text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(result.file.bytes),
    records: lines.map((line) => Object.fromEntries((header ?? []).map((key, column) => [key, line[column] ?? '']))),
  }
}

const recordFor = (records: Record<string, string>[], reference: string): Record<string, string> => {
  const found = records.find((record) => record['reference'] === reference)
  if (found === undefined) throw new Error(`the file holds no row for ${reference}`)
  return found
}
describe('the Register header (#83 §4.4, criterion 9)', () => {
  it('is the thirteen contract columns, in the contract order, and no author column', () => {
    expect(headerLine(COMMENTS_TABLE)).toBe(HEADER)
    // The Notes panel shows who wrote a Comment; the file has no such column, because the domain
    // stores no author and §4.4 names none.
    expect(COMMENTS_TABLE.columns.map((column) => column.header)).not.toContain('author')
  })
})

describe('which Comments the Register lists (#83 §4.2, criterion 10, contract §3)', () => {
  it('lists a Project, Design Option or Item Design Comment whatever Floors are selected, with no Floor of its own', () => {
    const project = sceneWithDesignNotes()
    // C-001 is anchored to the Project, C-901 to a shared Item Design, C-902 to a feature of that
    // same design, C-903 to one Design Option: none of them stands on a Floor, so no Floor
    // selection can lose them and no Floor name can be written for them.
    for (const floorIds of [[GROUND_ID], [UPPER_ID], [GROUND_ID, UPPER_ID], []]) {
      for (const reference of ['C-001', 'C-901', 'C-902', 'C-903']) {
        expect(commentIsInRegister(project, note(project, reference), scopeWith({ floorIds }), false), `${reference} with ${floorIds.length} Floors selected`).toBe(true)
      }
    }
    expect(references(project, scopeWith({ floorIds: [] }), false)).toEqual(['C-001', 'C-901', 'C-902', 'C-903'])
    expect(commentRegisterRows(project, scopeWith({ floorIds: [] }), false).map((row) => row.floor)).toEqual(['', '', '', ''])
  })

  it('lists a Floor and a Floor Point Comment only while their own Floor is selected', () => {
    const project = sceneWithIslandInOptionB()
    expect(commentIsInRegister(project, note(project, 'C-002'), scopeWith(), false)).toBe(true)
    expect(commentIsInRegister(project, note(project, 'C-003'), scopeWith(), false)).toBe(true)
    // C-008 is anchored to the second Floor, so it is out of a one-Floor Register and in once
    // that Floor is selected — an Anchor on an unselected Floor never appears.
    expect(commentIsInRegister(project, note(project, 'C-008'), scopeWith(), false)).toBe(false)
    expect(commentIsInRegister(project, note(project, 'C-008'), scopeWith({ floorIds: [UPPER_ID] }), false)).toBe(true)
    expect(commentIsInRegister(project, note(project, 'C-002'), scopeWith({ floorIds: [UPPER_ID] }), false)).toBe(false)
    expect(commentIsInRegister(project, note(project, 'C-003'), scopeWith({ floorIds: [] }), false)).toBe(false)
  })

  it('lists an entity or feature Comment by the Floor its subject stands on', () => {
    const project = sceneWithIslandInOptionB()
    // C-004 is on the second `Base 600` and C-006 on a Wall face, both of them Existing work on
    // Floor 1: the Anchor carries no Floor, so the subject's Floor decides.
    for (const reference of ['C-004', 'C-006']) {
      expect(commentIsInRegister(project, note(project, reference), scopeWith(), false), reference).toBe(true)
      expect(commentIsInRegister(project, note(project, reference), scopeWith({ floorIds: [UPPER_ID] }), false), reference).toBe(false)
    }
  })

  it('keeps Existing Model content under "Existing Model only" and drops what belongs to an Option', () => {
    const project = sceneWithIslandInOptionB()
    // C-004 and C-006 inherit `existing_model` from their Existing subjects, so the narrowest
    // Option choice still lists them; C-007 inherits Option B from the Island that option proposes.
    expect(commentIsInRegister(project, note(project, 'C-004'), scopeWith(), false)).toBe(true)
    expect(commentIsInRegister(project, note(project, 'C-006'), scopeWith(), false)).toBe(true)
    expect(commentIsInRegister(project, note(project, 'C-007'), scopeWith(), false)).toBe(false)
    expect(commentIsInRegister(project, note(project, 'C-007'), scopeWith({ designOptionIds: [OPTION_A] }), false)).toBe(false)
    expect(commentIsInRegister(project, note(project, 'C-007'), scopeWith({ designOptionIds: [OPTION_B] }), false)).toBe(true)
    // A Comment whose scope is All Options is in whatever is compared, including one Option alone.
    for (const designOptionIds of ['existing-only', [OPTION_A], [OPTION_B], [OPTION_A, OPTION_B]] as const) {
      for (const reference of ['C-001', 'C-002', 'C-003']) {
        expect(commentIsInRegister(project, note(project, reference), scopeWith({ designOptionIds }), false), `${reference} against ${String(designOptionIds)}`).toBe(true)
      }
    }
  })

  it('drops a Comment that chose an Option until that Option is in the scope', () => {
    const project = sceneWithDesignNotes()
    // C-904 sits on Floor 1 but chose Option B, so the Floor is not enough on its own.
    expect(commentIsInRegister(project, note(project, 'C-904'), scopeWith(), false)).toBe(false)
    expect(commentIsInRegister(project, note(project, 'C-904'), scopeWith({ designOptionIds: [OPTION_A] }), false)).toBe(false)
    expect(commentIsInRegister(project, note(project, 'C-904'), scopeWith({ designOptionIds: [OPTION_B] }), false)).toBe(true)
    expect(commentIsInRegister(project, note(project, 'C-904'), scopeWith(ALL_OPTIONS), false)).toBe(true)
    // …and it is still a Floor 1 Comment, so a Floor selection that omits Floor 1 loses it.
    expect(commentIsInRegister(project, note(project, 'C-904'), scopeWith({ floorIds: [UPPER_ID], designOptionIds: [OPTION_B] }), false)).toBe(false)
  })

  it('lists Open Comments alone until Resolved ones are asked for', () => {
    const project = sceneWithIslandInOptionB()
    const resolved = note(project, 'C-005')
    expect(resolved.status).toBe('resolved')
    expect(commentIsInRegister(project, resolved, scopeWith(), false)).toBe(false)
    expect(commentIsInRegister(project, resolved, scopeWith(), true)).toBe(true)
    for (const reference of ['C-001', 'C-002', 'C-003', 'C-004', 'C-006']) {
      expect(commentIsInRegister(project, note(project, reference), scopeWith(), true), reference).toBe(true)
    }
  })
})

describe('the issue’s worked example (#83 criterion 10)', () => {
  it('lists C-001 to C-004 and C-006 for one Floor under "Existing Model only"', () => {
    const project = sceneWithIslandInOptionB()
    expect(references(project, scopeWith(), false)).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'C-006'])
    // Adding the second Floor adds only the Comment anchored to it.
    expect(references(project, scopeWith({ floorIds: [GROUND_ID, UPPER_ID] }), false)).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'C-006', 'C-008'])
    // Choosing Option B instead of the Existing Model adds only the Island's Comment.
    expect(references(project, scopeWith({ designOptionIds: [OPTION_B] }), false)).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'C-006', 'C-007'])
    // Including Resolved adds only the Wall Comment the scene resolves.
    expect(references(project, scopeWith(), true)).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'C-005', 'C-006'])
  })

  it('lists C-007 as well in the shipped scene, which holds the Island as Existing work', () => {
    // The committed scene carries no Design Options, so C-007 inherits `existing_model` there and
    // the narrowest Option choice keeps it. The issue's five-Comment answer is the same scene
    // with an Option B that proposes the Island, which is the case above.
    expect(references(scene, scopeWith(), false)).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'C-006', 'C-007'])
    expect(references(scene, scopeWith({ floorIds: [GROUND_ID, UPPER_ID] }), false)).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'C-006', 'C-007', 'C-008'])
    expect(references(scene, scopeWith(), true)).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'C-005', 'C-006', 'C-007'])
  })
})
describe('what each row says (#83 §4.4, criteria 9 and 13)', () => {
  /** Every Comment in the scene, listed by the widest scope at which it exists. */
  async function everyRow(): Promise<Record<string, string>[]> {
    const project = sceneWithDesignNotes()
    const csv = await registerCsv(project, scopeWith({ floorIds: [GROUND_ID, UPPER_ID], ...ALL_OPTIONS }), true)
    return csv.records
  }

  it('writes status, priority and the three timestamps the way the contract spells them', async () => {
    const rows = await everyRow()
    const open = recordFor(rows, 'C-004')
    expect(open['status']).toBe('open')
    expect(open['priority']).toBe('high')
    expect(open['created_at']).toBe(STAMP)
    expect(open['updated_at']).toBe(STAMP)
    // `resolved_at` is empty unless the Comment is Resolved, and the one Resolved Comment in the
    // scene carries the moment the seed script resolved it.
    expect(open['resolved_at']).toBe('')
    const resolved = recordFor(rows, 'C-005')
    expect(resolved['status']).toBe('resolved')
    expect(resolved['resolved_at']).toBe(STAMP)
    expect(rows.filter((row) => row['resolved_at'] !== '').map((row) => row['reference'])).toEqual(['C-005'])
    for (const row of rows) {
      // UTC ISO 8601 with the `Z`, never a local time and never a bare date.
      for (const column of ['created_at', 'updated_at']) {
        expect(row[column], `${row['reference']} ${column}`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      }
      expect(['open', 'resolved']).toContain(row['status'])
      expect(['low', 'normal', 'high']).toContain(row['priority'])
      expect(['all_options', 'existing_model', 'design_option']).toContain(row['scope'])
    }
  })

  it('names the scope, the Floor and the Design Option in the codes and names the contract gives', async () => {
    const rows = await everyRow()
    expect(recordFor(rows, 'C-001')).toMatchObject({ scope: 'all_options', floor: '', design_option: '' })
    expect(recordFor(rows, 'C-002')).toMatchObject({ scope: 'all_options', floor: 'Floor 1', design_option: '' })
    // Inherited from an Existing subject, so `existing_model` with the subject's Floor and no Option.
    expect(recordFor(rows, 'C-004')).toMatchObject({ scope: 'existing_model', floor: 'Floor 1', design_option: '' })
    // Inherited from the Island Option B proposes, and chosen outright by a Floor Point Comment.
    expect(recordFor(rows, 'C-007')).toMatchObject({ scope: 'design_option', floor: 'Floor 1', design_option: 'Option B' })
    expect(recordFor(rows, 'C-904')).toMatchObject({ scope: 'design_option', floor: 'Floor 1', design_option: 'Option B' })
    // A Comment about one Design Option names it, and has no Floor of its own.
    expect(recordFor(rows, 'C-903')).toMatchObject({ floor: '', design_option: 'Option B' })
    expect(recordFor(rows, 'C-008')).toMatchObject({ floor: 'Level 2' })
  })

  it('writes the Anchor kind code and the plain Notes-panel label for every kind', async () => {
    // The eight scene rows come from the shipped scene, where every subject resolves: the label is
    // `commentAnchorLabel`, the Notes panel's own string, and the panel is handed no Design Option
    // either — so a Comment anchored to what an Option proposes reads `unrecognised target` in
    // both places, which is a derive question and not a Register one.
    const shipped = (await registerCsv(scene, scopeWith({ floorIds: [GROUND_ID, UPPER_ID] }), true)).records
    const designed = (await registerCsv(sceneWithDesignNotes(), scopeWith({ floorIds: [GROUND_ID, UPPER_ID], ...ALL_OPTIONS }), true)).records
    const rows = [...shipped, ...designed.filter((row) => ['C-901', 'C-902', 'C-903', 'C-904'].includes(row['reference']!))]
    expect(rows.map((row) => [row['reference'], row['target_type'], row['target_label']])).toEqual([
      ['C-001', 'project', 'Project · Renovation edits'],
      ['C-002', 'floor', 'Floor · Floor 1'],
      ['C-003', 'floor_point', 'Floor Point · Floor 1'],
      ['C-004', 'entity', 'Placed Item · Base 600 #2'],
      ['C-005', 'entity', 'Placed Item · W-3'],
      ['C-006', 'feature', 'Feature · left face'],
      ['C-007', 'entity', 'Placed Item · Island (custom)'],
      ['C-008', 'floor', 'Floor · Level 2'],
      ['C-901', 'item_design', 'Item Design · Base Unit'],
      ['C-902', 'feature', 'Feature · Base Unit · Open shelf'],
      ['C-903', 'design_option', 'Design Option · Option B'],
      ['C-904', 'floor_point', 'Floor Point · Floor 1'],
    ])
  })

  it('gives a Floor Point Comment the Floor name in place of its coordinates (#83 criterion 13)', async () => {
    const rows = await everyRow()
    const row = recordFor(rows, 'C-003')
    // The Anchor is `{ x: 3400, y: 2200 }` on Floor 1; the panel's label is `Floor Point · Floor 1
    // point`, and the Register drops the word `point` for the Floor name. The issue writes that
    // label for a `Ground Floor`; this scene's Floor is named `Floor 1`.
    expect(row['target_label']).toBe('Floor Point · Floor 1')
    // No coordinate, in either order or any spelling, anywhere in the row.
    const line = Object.values(row).join('|')
    expect(line).not.toContain('3400')
    expect(line).not.toContain('2200')
    expect(line).not.toMatch(/\bx:|\by:/)
  })
})

describe('the order of the rows (#83 criterion 11)', () => {
  it('sorts by the reference number, so C-999 comes before C-1000', () => {
    // The two Comments are added in the wrong order on purpose: a Project's array order is not the
    // file's order, and a lexicographic sort would put the four-digit reference first.
    const project = validated({
      ...scene,
      comments: [aComment('C-1000', { title: 'One thousand' }), aComment('C-999', { title: 'Nine ninety-nine' })],
      commentReferenceCounter: 1001,
    })
    expect(references(project, scopeWith(), false)).toEqual(['C-999', 'C-1000'])
  })

  it('keeps the scene’s own rows in reference order', async () => {
    const rows = (await registerCsv(sceneWithDesignNotes(), scopeWith({ floorIds: [GROUND_ID, UPPER_ID], ...ALL_OPTIONS }), true)).records
    expect(rows.map((row) => row['reference'])).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'C-005', 'C-006', 'C-007', 'C-008', 'C-901', 'C-902', 'C-903', 'C-904'])
  })
})
describe('the bytes of the file (#83 §4.6, criterion 12)', () => {
  const onlyNotes = (...comments: Comment[]): Project => validated({ ...scene, comments, commentReferenceCounter: 1001 })

  it('neutralises a title that opens like a spreadsheet formula', async () => {
    const csv = await registerCsv(onlyNotes(aComment('C-905', { title: '=SUM(A1)', body: '+1-3' })), scopeWith(), false)
    // The apostrophe is what stops a spreadsheet running the note when the file is opened; the
    // cell still reads back as the apostrophe plus the text, which is what the Writer wrote.
    expect(csv.text).toContain("C-905,'=SUM(A1),'+1-3,")
    expect(recordFor(csv.records, 'C-905')['title']).toBe("'=SUM(A1)")
    expect(recordFor(csv.records, 'C-905')['body']).toBe("'+1-3")
  })

  it('keeps a body with a line break inside one quoted cell', async () => {
    const body = 'First line\r\nSecond line'
    const csv = await registerCsv(onlyNotes(aComment('C-906', { title: 'Two lines', body })), scopeWith(), false)
    expect(csv.text).toContain(`"${body}"`)
    expect(csv.records).toHaveLength(1)
    expect(recordFor(csv.records, 'C-906')['body']).toBe(body)
    expect(Object.keys(recordFor(csv.records, 'C-906'))).toHaveLength(13)
    // A body typed with a bare LF is one cell too: the Writer quotes what the domain stores and
    // never splits a row, so the break stays field content.
    const bare = await registerCsv(onlyNotes(aComment('C-906', { title: 'Two lines', body: 'First line\nSecond line' })), scopeWith(), false)
    expect(bare.records).toHaveLength(1)
    expect(recordFor(bare.records, 'C-906')['body']).toBe('First line\nSecond line')
  })

  it('writes UTF-8 with a BOM and CRLF endings, and one header row, whatever language the note is in', async () => {
    const csv = await registerCsv(onlyNotes(aComment('C-907', { title: '櫥櫃 600', body: '深度 550 毫米' }), aComment('C-908', { title: 'A plain note' })), scopeWith(), false)
    expect(Buffer.from(csv.bytes.subarray(0, 3))).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(csv.text.startsWith(`\uFEFF${HEADER}\r\n`)).toBe(true)
    // The BOM, then one header line and one line per Comment, each ended by CRLF: nothing else in
    // the file breaks a line, because no cell here holds a break of its own.
    expect(csv.text.slice(1).split('\r\n')).toHaveLength(4)
    expect(recordFor(csv.records, 'C-907')['title']).toBe('櫥櫃 600')
    expect(recordFor(csv.records, 'C-907')['body']).toBe('深度 550 毫米')
  })
})

describe('an empty scope (#83 §4.7, criterion 15)', () => {
  it('writes a header-only file for a Floor with no Comments, and counts it as zero rows', async () => {
    // Both of the scene's Floors carry a Comment, so the Floor with none is the same scene with
    // everything but the Level 2 Comment removed and Floor 1 selected: then not even a Project
    // Comment is in scope, and the file is its header and nothing else.
    const quiet = validated({ ...scene, comments: scene.comments.filter((comment) => comment.reference === 'C-008') })
    const csv = await registerCsv(quiet, scopeWith(), false)
    expect(csv.text).toBe(`\uFEFF${HEADER}\r\n`)
    expect(csv.records).toEqual([])
    // The notice above the button counts the rows the file holds, so it says `0 rows` here.
    expect(listsSummary({ project: quiet, revision: 7 }, scopeWith(), null, false).rows['comments']).toBe(0)
    expect(commentScopeStatement(quiet, scopeWith(), false)).toBe('Floor 1 · Existing Model only · Open Comments')
  })
})

describe('the golden (#83 criterion 14)', () => {
  it('is the shipped scene at the issue’s default scope, byte for byte, and the same bytes twice', async () => {
    const csv = await registerCsv(scene, scopeWith(), false)
    const golden = join(GOLDEN_DIR, 'comments.csv')
    if (UPDATE) {
      mkdirSync(GOLDEN_DIR, { recursive: true })
      writeFileSync(golden, csv.bytes)
    }
    // Read as a Buffer, so a missing golden is a failure with a path in it rather than an
    // `undefined` comparison three frames away.
    expect(Buffer.from(csv.bytes), golden).toEqual(Buffer.from(readFileSync(golden)))
    // The golden holds the scene's own Comments, so a regenerated file that lost them fails here.
    const { rows } = parseCsv(readFileSync(golden))
    expect(rows.slice(1).map((row) => row[0])).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'C-006', 'C-007'])
    // Two generations of the same revision and the same recipe are the same bytes: a Register row
    // carries no clock and no random identifier, so nothing moves between them.
    expect(Buffer.from((await registerCsv(scene, scopeWith(), false)).bytes)).toEqual(Buffer.from(csv.bytes))
  })
})

