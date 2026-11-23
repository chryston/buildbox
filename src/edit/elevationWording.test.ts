/**
 * The words #75 puts on screen (#66 criterion 8, one feature wider).
 *
 * The shipped-copy scan in `app/shippedStrings.test.ts` reads the copy table and the components; the
 * sentences this feature writes live further in — an Intent label and the one-line reason a
 * transaction refused. They reach the user exactly the same way, so they are scanned the same way:
 * every label the three Elevation View Intents carry, and every message a rejection actually
 * produced when each of its cases was driven through `applyIntent`.
 *
 * Two lists are read. `BANNED_WORDS` is the one every other check uses (#19 §12, #27 §12) — imported,
 * never copied. The second is the #75 vocabulary: the words the issue closes off for an Elevation
 * View, because BuildBox draws a *view of a wall*, not a construction drawing. `section`, `cut` and
 * `camera` belong to that other product, `3D` names a mode there is no plan to build, and the compass
 * words and `looking` promise an orientation the view line does not carry — an Elevation View says
 * `left` or `right` of its own line and nothing about where north is.
 */
import { describe, expect, it } from 'vitest'
import { verticalSnapCandidates } from '../derive'
import { elevationScene } from '../derive/testing'
import type { Project } from '../domain'
import { elevationViewsOf } from '../domain'
import { BANNED_WORDS, bannedWordsIn, mentionsWord } from '../lib'
import { applyIntent, intentLabel } from './index'
import { intent, newProject } from './testing'

const LINE = { start: { x: 0, y: 1400 }, end: { x: 4000, y: 1400 } }

/** The words #75 keeps out of its own copy, on top of the list every feature reads. */
const ELEVATION_WORDS: readonly string[] = ['section', 'cut', 'camera', '3D', 'North', 'South', 'East', 'West', 'looking']

/** A Project with one Floor and one Elevation View, made through the Intent like any other. */
function oneView(): { project: Project; floorId: string; viewId: string } {
  const project = newProject('Kitchen')
  const floorId = project.floors[0]!.id
  const applied = applyIntent(project, intent('elevationView.create', { floorId, line: LINE, side: 'left', depth: 2000 }, ['elevation-1']))
  if (!applied.ok) throw new Error('the scene for the wording scan must build')
  return { project: applied.project, floorId, viewId: 'elevation-1' }
}

const scene = oneView()

/** Every way the three transactions refuse, each one the case that raises it. */
const REFUSALS: readonly { readonly at: string; readonly run: () => unknown }[] = [
  {
    at: 'a name this Floor’s Elevation Views already use',
    run: () => applyIntent(scene.project, intent('elevationView.create', { floorId: scene.floorId, line: LINE, side: 'left', depth: 500, name: ' ELEVATION 1 ' }, ['elevation-2'])),
  },
  {
    at: 'a view line with no length',
    run: () => applyIntent(scene.project, intent('elevationView.create', { floorId: scene.floorId, line: { start: { x: 10, y: 10 }, end: { x: 10, y: 10 } }, side: 'left', depth: 500 }, ['elevation-2'])),
  },
  {
    at: 'a depth of zero',
    run: () => applyIntent(scene.project, intent('elevationView.create', { floorId: scene.floorId, line: LINE, side: 'left', depth: 0 }, ['elevation-2'])),
  },
  {
    at: 'a side that is neither side',
    run: () => applyIntent(scene.project, intent('elevationView.create', { floorId: scene.floorId, line: LINE, side: 'north' as never, depth: 500 }, ['elevation-2'])),
  },
  {
    at: 'a Floor that is not in this Project',
    run: () => applyIntent(scene.project, intent('elevationView.create', { floorId: 'floor-nowhere', line: LINE, side: 'left', depth: 500 }, ['elevation-2'])),
  },
  {
    at: 'an Elevation View that is not there',
    run: () => applyIntent(scene.project, intent('elevationView.edit', { viewId: 'elevation-nowhere', depth: 20 })),
  },
  {
    at: 'an edit that changes nothing',
    run: () => applyIntent(scene.project, intent('elevationView.edit', { viewId: scene.viewId, side: 'left' })),
  },
  {
    at: 'a name another Elevation View has taken',
    run: () => applyIntent(scene.project, intent('elevationView.edit', { viewId: scene.viewId, name: ` ${elevationViewsOf(scene.project)[0]!.name} ` })),
  },
  {
    at: 'a view line collapsed to a point',
    run: () => applyIntent(scene.project, intent('elevationView.edit', { viewId: scene.viewId, line: { start: { x: 5, y: 5 }, end: { x: 5, y: 5 } } })),
  },
  {
    at: 'a negative depth',
    run: () => applyIntent(scene.project, intent('elevationView.edit', { viewId: scene.viewId, depth: -20 })),
  },
  {
    at: 'a delete of an Elevation View that is not there',
    run: () => applyIntent(scene.project, intent('elevationView.delete', { viewId: 'elevation-nowhere' })),
  },
  {
    at: 'a Floor whose Elevation Views are still there',
    run: () => applyIntent(scene.project, intent('floor.delete', { floorId: scene.floorId })),
  },
  {
    at: 'a Plan View setting asked of an Elevation View',
    run: () => applyIntent(scene.project, intent('view.setPlanViewRange', { viewId: scene.viewId, lowerMm: 0, upperMm: 1200 })),
  },
  {
    at: 'a rename asked of an Elevation View through the Plan View Intent',
    run: () => applyIntent(scene.project, intent('view.rename', { viewId: scene.viewId, name: 'Renamed' })),
  },
]

/** Every sentence this feature can put on screen: the three labels, every refusal, and every guide line. */
function shipped(): string[] {
  const labels = (['elevationView.create', 'elevationView.edit', 'elevationView.delete'] as const).map((type) => intentLabel(type))
  const refusals = REFUSALS.map(({ at, run }) => {
    const result = run() as { ok: boolean; problems?: { message: string }[] }
    if (result.ok || result.problems === undefined) throw new Error(`no refusal for ${at}`)
    return result.problems.map((problem) => problem.message)
  }).flat()
  // A snap guide says a height's name next to the cursor, which is as much on screen as a toast.
  const guides = (elevationScene().elevationViews ?? []).flatMap((view) => verticalSnapCandidates({ project: elevationScene(), view }).map((candidate) => candidate.label))
  return [...labels, ...refusals, ...guides]
}

describe('the words #75 ships saying', () => {
  it('has something to scan', () => {
    const copy = shipped()
    expect(copy.length).toBeGreaterThan(15)
    expect(copy.filter((text) => text.includes('Elevation View')).length).toBeGreaterThan(5)
  })

  it('says no word #19 §12 bans', () => {
    expect(shipped().flatMap((text) => bannedWordsIn(text).map((word) => `${word} in ${text}`))).toEqual([])
  })

  it('says no word the Elevation View vocabulary closes off', () => {
    for (const word of ELEVATION_WORDS) {
      for (const text of shipped()) {
        expect(mentionsWord(text, word), `${word} in ${text}`).toBe(false)
      }
    }
  })

  it('closes off the words it says it closes off', () => {
    // The list is the point of the file: a scan whose list quietly shrinks says nothing.
    expect(ELEVATION_WORDS).toEqual(['section', 'cut', 'camera', '3D', 'North', 'South', 'East', 'West', 'looking'])
    expect(BANNED_WORDS).toHaveLength(28)
  })

  it('catches a word written into a sentence', () => {
    // The scan fails when it should: both lists are read, and neither is case-sensitive.
    expect(mentionsWord('Cross-section through the kitchen', 'section')).toBe(true)
    expect(mentionsWord('Looking north along the wall', 'looking')).toBe(true)
    expect(mentionsWord('A 3D view of the room', '3D')).toBe(true)
    expect(bannedWordsIn('Compliant with the code').length).toBeGreaterThan(0)
  })

  it('leaves a word alone when it is only part of another word', () => {
    expect(mentionsWord('The selected Elevation View', 'section')).toBe(false)
    expect(mentionsWord('A shorter depth', 'cut')).toBe(false)
  })
})
