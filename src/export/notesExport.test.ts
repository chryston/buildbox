/**
 * The Notes a sheet carries, and the three switches that decide it (#83 §2, §3; acceptance 2, 4, 5, 6, 8, 17).
 *
 * The fixture is the Notes review scene — eight Comments, four Annotations, a second Floor, `Base 600`
 * placed twice — because that is the scene the issue's criteria are written against, and a switch tested
 * against a synthetic two-line Project proves nothing about a Wall face, a Resolved note or an Option.
 * The scene is migrated and validated before anything is composed from it: an invalid Project makes every
 * Intent refuse invisibly, and a sheet composed from one would be a drawing of a file the app refuses to
 * open.
 *
 * Two places the shipped scene and the issue's criterion 4 disagree are pinned as the scene is, with the
 * reason beside them. `C-002` is anchored to the Floor, and §2.3 gives a pin only to a note whose Anchor
 * has a position, so it is the Register that carries it and not the sheet; and no Comment of the shipped
 * scene is anchored to an Item Design, so no view of it produces a `✎n` badge. The badge rule of §2.4 is
 * therefore exercised against the scene with one Item Design Comment added, the way #82's own Options
 * flow adds Design Options to this same scene rather than inventing a second fixture.
 *
 * The assertions are on the display list the Worker serialises — the same `note-pin` and `note-badge`
 * roles `DisplayListSvg` turns into `data-testid` on screen — and never on pixel geometry: a pin that
 * moved two millimetres because a label found a seat is not a different sheet, while a pin that drew a
 * body is.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { migrateProject, validateProject } from '../domain'
import type { Comment, Project } from '../domain'
import type { DisplayItem, DisplayList } from '../drawing'
import { composeSheet, exportFiles } from './index'
import type {
  ExportClock,
  ExportDeps,
  NotesSwitches,
  Recipe,
  RecipeViewRef,
} from './types'

/** Write the golden instead of comparing, for the run that means to change the drawing. */
const UPDATE = process.env['UPDATE_GOLDEN'] === '1'

const CLOCK: ExportClock = { now: () => '2026-11-25T09:00:00.000Z', localDate: () => '2026-11-25' }

/** A real one-pixel PNG: `Floor 1` carries a Plan Image, stored by hash and not in the repository. */
const PLAN_IMAGE = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4AWMAAQAABQABNtCI3QAAAABJRU5ErkJggg==', 'base64'),
)

const DEPS: ExportDeps = {
  clock: CLOCK,
  buildboxVersion: '0.0.0-test',
  font: { bytes: new Uint8Array(readFileSync(new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url))) },
  assets: async () => ({ bytes: PLAN_IMAGE, mediaType: 'image/png' }),
}

/** The scene's own records, named once: the ids are the seed script's `comment-C-004` convention. */
const PLAN_VIEW_ID = 'seed-view-001'
const BASE_600_ID = 'seed-item-027'
const BASE_PLACEMENT_IDS = ['seed-item-028', 'seed-item-029']
const pinId = (reference: string): string => `comment-${reference}`
const markId = (reference: string): string => `annotation-${reference}`

/** §2.1's three switches as acceptance 4 describes the sheet: Annotations and Pins on, Resolved off. */
const PINS_ON: NotesSwitches = { viewAnnotations: true, commentPins: true, includeResolvedPins: false }

type Envelope = { projects: { schemaVersion: number; data: unknown }[] }

/** The scene as the app holds it today: through the migration chain the app runs, then validated. */
function scene(): Project {
  const envelope = JSON.parse(
    readFileSync(new URL('../../fixtures/e2e/preview-seed/notes-review-scene.json', import.meta.url), 'utf8'),
  ) as Envelope
  const record = envelope.projects[0]!
  const migrated = migrateProject(record.data, record.schemaVersion, () => [])
  if (!migrated.ok) expect.fail(`the Notes scene did not migrate: ${migrated.error.message}`)
  return holds(migrated.project as Project)
}

/** Every variant this file builds is held to the same promise the committed scene is. */
function holds(project: Project): Project {
  const checked = validateProject(project)
  if (!checked.ok) {
    expect.fail(`the scene variant does not validate: ${checked.problems.map((one) => `${one.path}: ${one.message}`).join('; ')}`)
  }
  return project
}

/**
 * A recipe with its three switches named.
 *
 * `notes` is optional on the recipe — a remembered one from before #83 has no opinion — so a test that
 * left it out would be testing the fallback rather than the switch.
 */
function recipe(view: RecipeViewRef, notes: NotesSwitches, over: Partial<Recipe> = {}): Recipe {
  return {
    views: [view],
    format: 'svg',
    pageSize: 'A4',
    orientation: 'auto',
    scale: 'fit',
    pngLongEdge: 2048,
    titleBlock: true,
    grid: false,
    unit: 'mm',
    precision: 0,
    notes,
    ...over,
  }
}

const PLAN: RecipeViewRef = { kind: 'plan', viewId: PLAN_VIEW_ID }

/** The composed sheet, or the reason the sheet does not exist. */
function compose(project: Project, view: RecipeViewRef, notes: NotesSwitches, over: Partial<Recipe> = {}) {
  const composed = composeSheet({ project, revision: 1 }, view, recipe(view, notes, over), CLOCK, '0.0.0-test')
  if (!composed.ok) throw new Error(`composing the sheet failed: ${composed.reason}`)
  return composed
}

async function bytesOf(project: Project, view: RecipeViewRef, notes: NotesSwitches, over: Partial<Recipe> = {}): Promise<Uint8Array> {
  const result = await exportFiles({ project, revision: 1 }, recipe(view, notes, over), DEPS)
  if (!result.ok) throw new Error(`export failed: ${JSON.stringify(result.failures)}`)
  if (result.kind !== 'single') throw new Error('expected one file')
  return result.file.bytes
}

/** Every string a display list carries, groups walked. */
function texts(items: readonly DisplayItem[]): string[] {
  return items.flatMap((item) =>
    item.kind === 'group' ? texts(item.items) : item.kind === 'text' ? [item.text] : [],
  )
}

/** The ids of every group drawn under one role, in the order the sheet paints them. */
function refIds(list: DisplayList, role: string): string[] {
  const out: string[] = []
  const walk = (items: readonly DisplayItem[]): void => {
    for (const item of items) {
      if (item.kind !== 'group') continue
      if (item.ref?.role === role) out.push(item.ref.id)
      walk(item.items)
    }
  }
  walk(list.layers.flatMap((layer) => layer.items))
  return out
}

/** One mark's own primitives: the words it wears and the styles it is painted in. */
function markOf(list: DisplayList, role: string, id: string): { text: string; styles: string[] } | null {
  let found: { text: string; styles: string[] } | null = null
  const walk = (items: readonly DisplayItem[]): void => {
    for (const item of items) {
      if (item.kind !== 'group') continue
      if (item.ref?.role === role && item.ref.id === id) {
        found = {
          text: texts(item.items).join(' '),
          styles: item.items.flatMap((one) => (one.kind === 'path' ? [one.style] : [])),
        }
        return
      }
      walk(item.items)
    }
  }
  walk(list.layers.flatMap((layer) => layer.items))
  return found
}

/** One Comment about the shared `Base 600` Design rather than about one placement of it. */
function designComment(reference: string, over: Partial<Comment>): Comment {
  return {
    id: `comment-${reference}`,
    reference,
    title: 'Handle alignment across the run',
    body: 'A note about the Design every placement shares.',
    anchor: { kind: 'item_design', itemDesignId: BASE_600_ID },
    scope: 'all',
    status: 'open',
    priority: 'normal',
    createdAt: '2026-11-25T09:00:00.000Z',
    updatedAt: '2026-11-25T09:00:00.000Z',
    ...over,
  }
}

/**
 * The scene with two Item Design Comments on `Base 600`, one Open and one Resolved.
 *
 * The shipped scene carries neither, which is why §2.4's badge rule needs this variant: a Comment about a
 * Design is about every placement of it, so the sheet owes one `✎n` per placement rather than a pin at
 * one arbitrary copy.
 */
function withDesignComments(project: Project): Project {
  return holds({
    ...project,
    comments: [
      ...project.comments,
      designComment('C-009', {}),
      designComment('C-010', { status: 'resolved', resolvedAt: '2026-11-25T09:00:00.000Z' }),
    ],
    commentReferenceCounter: 11,
  })
}

function golden(name: string, bytes: Uint8Array): string {
  const file = fileURLToPath(new URL(`../../fixtures/export/golden/${name}.svg`, import.meta.url))
  const text = new TextDecoder().decode(bytes)
  if (UPDATE) {
    mkdirSync(fileURLToPath(new URL('../../fixtures/export/golden/', import.meta.url)), { recursive: true })
    writeFileSync(file, text)
  }
  expect(readFileSync(file, 'utf8'), name).toBe(text)
  return text
}

describe('the Notes on a sheet (#83 §2, §3)', () => {
  it('opens the scene the criteria are written against', () => {
    const project = scene()
    // The rest of the file names marks by the seed script's `comment-C-004` and `annotation-A-001`
    // ids, and a fixture that quietly changed its own convention would turn every assertion below
    // into a passing one about nothing.
    expect(project.comments.map((one) => `${one.id}:${one.status}`)).toEqual([
      'comment-C-001:open',
      'comment-C-002:open',
      'comment-C-003:open',
      'comment-C-004:open',
      'comment-C-005:resolved',
      'comment-C-006:open',
      'comment-C-007:open',
      'comment-C-008:open',
    ])
    expect(project.annotations.map((one) => `${one.reference} in ${one.viewId}`)).toEqual([
      'A-001 in seed-view-001',
      'A-002 in seed-view-001',
      'A-003 in seed-view-001',
      'A-004 in sv-001',
    ])
    expect(project.views.find((one) => one.id === PLAN_VIEW_ID)?.name).toBe('Floor 1')
    expect(BASE_PLACEMENT_IDS.every((id) => project.existingModel.placedItems.some((one) => one.id === id))).toBe(true)
  })

  it('draws the same pinned sheet twice, and the one this repository committed', async () => {
    const project = scene()
    const one = await bytesOf(project, PLAN, PINS_ON)
    const two = await bytesOf(project, PLAN, PINS_ON)
    expect(new TextDecoder().decode(two)).toBe(new TextDecoder().decode(one))
    const text = golden('notes-plan-pins', one)
    // A reader checking the file by hand should see the three switches and the notes they drew.
    expect(text).toContain('C-004 Shift 50 mm for dishwasher · Open')
    expect(text).toContain('"comment_pins":true')
    expect(text).not.toContain('Conduit to be chased in this wall')
  })

  it('pins the notes that have a place in the view and leaves the rest to the Register (#83 §2.3, acceptance 4)', () => {
    const composed = compose(scene(), PLAN, PINS_ON)
    // Reference order, because that is the order a person reads a drawing's notes in.
    expect(refIds(composed.drawing, 'note-pin')).toEqual([
      pinId('C-003'),
      pinId('C-004'),
      pinId('C-006'),
      pinId('C-007'),
    ])
    // `C-004` is the second `Base 600` and `C-006` the left face of W-3: acceptance 4's two notes, each
    // pinned at the place its Anchor names rather than at the middle of the sheet.
    expect(refIds(composed.drawing, 'note-pin')).toEqual(expect.arrayContaining([pinId('C-004'), pinId('C-006')]))
    // Acceptance 4 also names `C-002`, and asks for `✎1` badges on both `Base 600` placements. The
    // shipped scene gives `C-002` a Floor Anchor and gives no Comment an Item Design Anchor, and §2.3
    // draws a pin only where an Anchor has a position — so the Floor note and the shared-Design badges
    // belong to the Register, and this sheet carries neither. The badge rule itself is pinned below.
    const absent = refIds(composed.drawing, 'note-pin')
    expect(absent).not.toContain(pinId('C-001'))
    expect(absent).not.toContain(pinId('C-002'))
    expect(absent).not.toContain(pinId('C-008'))
    expect(refIds(composed.drawing, 'note-badge')).toEqual([])
    // The Annotations of this view are on the sheet beside the pins, and the Elevation View's mark is
    // not: an Annotation belongs to exactly one view.
    expect(refIds(composed.drawing, 'mark')).toEqual([markId('A-001'), markId('A-002'), markId('A-003')])
  })

  it('gives the Resolved note a muted pin only when the switch asks for it (#83 §2.3, acceptance 4)', () => {
    const project = scene()
    expect(refIds(compose(project, PLAN, PINS_ON).drawing, 'note-pin')).not.toContain(pinId('C-005'))
    const withResolved = compose(project, PLAN, { ...PINS_ON, includeResolvedPins: true }).drawing
    expect(refIds(withResolved, 'note-pin')).toContain(pinId('C-005'))
    const pin = markOf(withResolved, 'note-pin', pinId('C-005'))
    if (pin === null) throw new Error('C-005 has no pin')
    expect(pin.text).toBe('C-005 Conduit to be chased in this wall · Resolved')
    // The muted style is the one the overlay uses for a closed note, so a printed sheet reads the same.
    expect(pin.styles).toContain('plan-note-pin-resolved')
    // An Open note is still painted in its priority band, and `C-004` is the High one.
    const open = markOf(withResolved, 'note-pin', pinId('C-004'))
    if (open === null) throw new Error('C-004 has no pin')
    expect(open.styles).toContain('plan-note-pin-high')
  })

  it('counts an Item Design Comment once per placement, never as a pin (#83 §2.4, acceptance 4)', () => {
    const project = withDesignComments(scene())
    const badges = (notes: NotesSwitches): string[] =>
      refIds(compose(project, PLAN, notes).drawing, 'note-badge')
    // Both placements of `Base 600`, and nothing else: the Design's own Comment is not a place.
    expect(badges(PINS_ON)).toEqual(BASE_PLACEMENT_IDS)
    expect(refIds(compose(project, PLAN, PINS_ON).drawing, 'note-pin')).not.toContain(pinId('C-009'))
    const count = (id: string): string => {
      const badge = markOf(compose(project, PLAN, PINS_ON).drawing, 'note-badge', id)
      if (badge === null) throw new Error(`no badge on ${id}`)
      return badge.text
    }
    expect(count(BASE_PLACEMENT_IDS[0]!)).toBe('✎1')
    expect(count(BASE_PLACEMENT_IDS[1]!)).toBe('✎1')
    // The count is the same set the pins come from, so `include Resolved pins` moves both together.
    const resolved = compose(project, PLAN, { ...PINS_ON, includeResolvedPins: true }).drawing
    const resolvedCount = (id: string): string => {
      const badge = markOf(resolved, 'note-badge', id)
      if (badge === null) throw new Error(`no badge on ${id}`)
      return badge.text
    }
    expect(resolvedCount(BASE_PLACEMENT_IDS[0]!)).toBe('✎2')
    expect(resolvedCount(BASE_PLACEMENT_IDS[1]!)).toBe('✎2')
  })
})
