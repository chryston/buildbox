/**
 * What a handler is given, and what one handler is (#47).
 *
 * A handler reads `project` — the Project as it stands, plain objects it can hand to
 * `cabinet`'s pure functions — and writes `draft`, immer's copy-on-write copy of the same
 * tree that becomes the next Project. Reading only the base and writing only the draft is
 * what keeps `cabinet`'s structural sharing intact: a draft proxy never reaches a
 * function that spreads nodes.
 */
import type { Project } from '../../domain'
import type { Intent, IntentType, Locator } from '../intents'

export interface HandlerContext<T extends IntentType> {
  readonly project: Project
  /**
   * The draft of `project`. `produceWithPatches` hands it over as immer's `Draft<Project>`,
   * which for a plain-JSON Project is the same shape — so handlers write it as a Project
   * and never see immer's machinery.
   */
  readonly draft: Project
  readonly intent: Intent<T>
}

export type Handler<T extends IntentType> = (ctx: HandlerContext<T>) => void

/** One entry of the catalogue: the edit itself, and where it lands. */
export interface IntentHandler<T extends IntentType> {
  readonly run: Handler<T>
  /**
   * Where this Intent's effect is seen, computed from the Project as it stands. It never
   * throws: a rejected Intent still gets a best-effort Locator, because #48 wants to
   * highlight what the user clicked even when the edit was refused.
   */
  readonly locate: (project: Project, intent: Intent<T>) => Locator
}
