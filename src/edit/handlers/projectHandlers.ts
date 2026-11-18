/**
 * The Project half of the catalogue (#47): the rename, and the display preferences (#55)
 * the legacy store kept outside the Design.
 */
import type { Project } from '../../domain'
import type { Locator } from '../intents'
import type { Handler, IntentHandler } from './context'

const renameProject: Handler<'project.rename'> = (ctx) => {
  ctx.draft.meta.name = ctx.intent.payload.name
}

/**
 * Display preferences are Project content (#13): one Intent, one Edit Transaction, undoable.
 * Only `preferences` is touched — presentation never rewrites geometry.
 */
const setProjectPreferences: Handler<'project.setPreferences'> = (ctx) => {
  ctx.draft.preferences.displayUnit = ctx.intent.payload.displayUnit
  ctx.draft.preferences.displayPrecision = ctx.intent.payload.displayPrecision
}

/** A Project rename is seen everywhere and nowhere: no Floor, no Item Design. */
function projectLocator(): Locator {
  return { floorId: null, viewId: null, view: 'cabinet', itemDesignIds: [], placedItemIds: [] }
}

/**
 * Preferences are set from the Floor workspace, so undo lands there: the first Floor's Plan
 * View, nothing selected. There is no global active Floor (#25) — the locator names the Floor.
 */
function preferencesLocator(project: Project): Locator {
  return { floorId: project.floors[0]?.id ?? null, viewId: null, view: 'plan', itemDesignIds: [], placedItemIds: [] }
}

export const PROJECT_HANDLERS = {
  'project.rename': { run: renameProject, locate: projectLocator },
  'project.setPreferences': { run: setProjectPreferences, locate: preferencesLocator },
} satisfies {
  'project.rename': IntentHandler<'project.rename'>
  'project.setPreferences': IntentHandler<'project.setPreferences'>
}
