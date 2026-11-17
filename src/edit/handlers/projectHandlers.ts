/**
 * The Project half of the catalogue (#47) — one Intent today, because the Project's other
 * settings are preferences the legacy store kept outside the Design.
 */
import type { Locator } from '../intents'
import type { Handler, IntentHandler } from './context'

const renameProject: Handler<'project.rename'> = (ctx) => {
  ctx.draft.meta.name = ctx.intent.payload.name
}

/** A Project rename is seen everywhere and nowhere: no Floor, no Item Design. */
function projectLocator(): Locator {
  return { floorId: null, view: 'cabinet', itemDesignIds: [], placedItemIds: [] }
}

export const PROJECT_HANDLERS = {
  'project.rename': { run: renameProject, locate: projectLocator },
} satisfies { 'project.rename': IntentHandler<'project.rename'> }
