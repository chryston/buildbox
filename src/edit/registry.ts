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
import { BEAM_HANDLERS } from './handlers/beamHandlers'
import { COMMENT_HANDLERS } from './handlers/commentHandlers'
import { ANNOTATION_HANDLERS } from './handlers/annotationHandlers'
import { CORRECTION_HANDLERS } from './handlers/correctionHandlers'
import { DESIGN_HANDLERS } from './handlers/designHandlers'
import { FLOOR_HANDLERS, PLAN_FLOOR_HANDLERS, VIEW_HANDLERS } from './handlers/floorHandlers'
import { LAYER_HANDLERS } from './handlers/layerHandlers'
import { OPENING_HANDLERS } from './handlers/openingHandlers'
import { PASTE_HANDLERS } from './handlers/pasteHandlers'
import { ELEVATION_HANDLERS } from './handlers/elevationHandlers'
import { PLAN_HANDLERS } from './handlers/planHandlers'
import { PROJECT_HANDLERS } from './handlers/projectHandlers'
import { RENOVATION_EDIT_HANDLERS } from './handlers/renovationEdits'
import { RENOVATION_HANDLERS } from './handlers/renovationHandlers'
import { ROOM_HANDLERS } from './handlers/roomHandlers'
import { SERVICE_HANDLERS } from './handlers/serviceHandlers'
import { SKIRTING_HANDLERS } from './handlers/skirtingHandlers'
import { WALL_HANDLERS } from './handlers/wallHandlers'
import { WARNING_HANDLERS } from './handlers/warningHandlers'
import { installCatalogue } from './handlers/support'

/**
 * The catalogue. The S7 half is complete — add an `IntentType` without a handler here and the
 * build stops — and the renovation half is typed optional, because the two sets are registered
 * apart from one another (#69 criterion 13). `applyIntent` treats a missing handler as the
 * rejection an unknown type always gets, so an Intent with no handler is refused, never a crash.
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
  ...BEAM_HANDLERS,
  ...SKIRTING_HANDLERS,
  ...SERVICE_HANDLERS,
  ...COMMENT_HANDLERS,
  ...ANNOTATION_HANDLERS,
  ...DESIGN_HANDLERS,
  ...PLAN_FLOOR_HANDLERS,
  ...FLOOR_HANDLERS,
  ...VIEW_HANDLERS,
  ...WARNING_HANDLERS,
  // The one way into `./handlers/renovationHandlers`, `./handlers/renovationEdits` and
  // `./handlers/correctionHandlers`: nothing else imports those three modules, so this catalogue is
  // the single place their handlers become reachable.
  ...RENOVATION_HANDLERS,
  ...RENOVATION_EDIT_HANDLERS,
  ...CORRECTION_HANDLERS,
  ...LAYER_HANDLERS,
  ...PASTE_HANDLERS,
  ...ELEVATION_HANDLERS,
}

/** Every Intent type the catalogue answers — the list #48's undo menu and #66 read. */
export const INTENT_TYPES = Object.keys(INTENT_HANDLERS) as IntentType[]

// The one handler that runs another Intent whole — a correction replaying the edit it wraps
// (#69 §12) — reads the catalogue through `./handlers/support`, which keeps the module graph
// one-way.
installCatalogue(INTENT_HANDLERS as Partial<Record<IntentType, IntentHandler<IntentType>>>)
