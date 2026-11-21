/**
 * The catalogue as one map (#47).
 *
 * The mapped type is the completeness check: add an `IntentType` without a handler here and
 * the build stops. Dispatch through `INTENT_HANDLERS[intent.type]` hands back a union of
 * handlers, each of which only accepts its own Intent, so `applyIntent` erases the type
 * once — the registry's key is the proof that the pair belongs together.
 */
import type { IntentType } from './intents'
import type { IntentHandler } from './handlers/context'
import { CABINET_HANDLERS } from './handlers/cabinetHandlers'
import { DESIGN_HANDLERS } from './handlers/designHandlers'
import { FLOOR_HANDLERS, PLAN_FLOOR_HANDLERS, VIEW_HANDLERS } from './handlers/floorHandlers'
import { OPENING_HANDLERS } from './handlers/openingHandlers'
import { PLAN_HANDLERS } from './handlers/planHandlers'
import { PROJECT_HANDLERS } from './handlers/projectHandlers'
import { ROOM_HANDLERS } from './handlers/roomHandlers'
import { WALL_HANDLERS } from './handlers/wallHandlers'
import { WARNING_HANDLERS } from './handlers/warningHandlers'

export const INTENT_HANDLERS: { [T in IntentType]: IntentHandler<T> } = {
  ...PROJECT_HANDLERS,
  ...CABINET_HANDLERS,
  ...PLAN_HANDLERS,
  ...WALL_HANDLERS,
  ...ROOM_HANDLERS,
  ...OPENING_HANDLERS,
  ...DESIGN_HANDLERS,
  ...PLAN_FLOOR_HANDLERS,
  ...FLOOR_HANDLERS,
  ...VIEW_HANDLERS,
  ...WARNING_HANDLERS,
}

/** Every Intent type the catalogue answers — the list #48's undo menu and #66 read. */
export const INTENT_TYPES = Object.keys(INTENT_HANDLERS) as IntentType[]
