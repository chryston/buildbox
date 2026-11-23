/**
 * The catalogue as one map (#47).
 *
 * The mapped type is the completeness check: add an `IntentType` without a handler here and
 * the build stops. Dispatch through `INTENT_HANDLERS[intent.type]` hands back a union of
 * handlers, each of which only accepts its own Intent, so `applyIntent` erases the type
 * once — the registry's key is the proof that the pair belongs together.
 */
import type { IntentType, RenovationIntentType, S7IntentType } from './intents'

import type { IntentHandler } from './handlers/context'
import { CABINET_HANDLERS } from './handlers/cabinetHandlers'
import { CORRECTION_HANDLERS } from './handlers/correctionHandlers'
import { DESIGN_HANDLERS } from './handlers/designHandlers'
import { FLOOR_HANDLERS, PLAN_FLOOR_HANDLERS, VIEW_HANDLERS } from './handlers/floorHandlers'
import { LAYER_HANDLERS } from './handlers/layerHandlers'
import { OPENING_HANDLERS } from './handlers/openingHandlers'
import { PASTE_HANDLERS } from './handlers/pasteHandlers'
import { PLAN_HANDLERS } from './handlers/planHandlers'
import { PROJECT_HANDLERS } from './handlers/projectHandlers'
import { RENOVATION_EDIT_HANDLERS } from './handlers/renovationEdits'
import { RENOVATION_HANDLERS } from './handlers/renovationHandlers'
import { ROOM_HANDLERS } from './handlers/roomHandlers'
import { WALL_HANDLERS } from './handlers/wallHandlers'
import { WARNING_HANDLERS } from './handlers/warningHandlers'
import { installCatalogue } from './handlers/support'

/**
 * The catalogue. The S7 half is complete — add an `IntentType` without a handler here and the
 * build stops — and the renovation half is optional, because it is registered only while
 * `VITE_FF_RENOVATION` is on (#69 criterion 13). `applyIntent` treats a missing handler as the
 * rejection an unknown type always gets, so a flagged Intent that reaches an unflagged build is
 * refused, never a crash.
 */
export const INTENT_HANDLERS: { [T in S7IntentType]: IntentHandler<T> } & {
  [T in RenovationIntentType]?: IntentHandler<T>
} = {
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
  // The one way into `./handlers/renovationHandlers`, `./handlers/renovationEdits` and
  // `./handlers/correctionHandlers`: with the flag off these fold to nothing, the imports go
  // unused, and all three modules — marker string and all — are gone from the bundle.
  ...RENOVATION_HANDLERS,
  ...RENOVATION_EDIT_HANDLERS,
  ...CORRECTION_HANDLERS,
  ...LAYER_HANDLERS,
  ...PASTE_HANDLERS,
}

/** Every Intent type the catalogue answers — the list #48's undo menu and #66 read. */
export const INTENT_TYPES = Object.keys(INTENT_HANDLERS) as IntentType[]

// The one handler that runs another Intent whole — a correction replaying the edit it wraps
// (#69 §12) — reads the catalogue through `./handlers/support`, which keeps the module graph
// one-way.
installCatalogue(INTENT_HANDLERS as Partial<Record<IntentType, IntentHandler<IntentType>>>)
