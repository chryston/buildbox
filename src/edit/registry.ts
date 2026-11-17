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
import { PLAN_HANDLERS } from './handlers/planHandlers'
import { PROJECT_HANDLERS } from './handlers/projectHandlers'

export const INTENT_HANDLERS: { [T in IntentType]: IntentHandler<T> } = {
  ...PROJECT_HANDLERS,
  ...CABINET_HANDLERS,
  ...PLAN_HANDLERS,
}

/** Every Intent type the catalogue answers — the list #48's undo menu and #66 read. */
export const INTENT_TYPES = Object.keys(INTENT_HANDLERS) as IntentType[]
