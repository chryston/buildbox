/**
 * Which selections are baseline records the person has not said they mean to change (#70 §7c).
 *
 * Once a Project carries a Design Option, the Existing Model is the record every Option is drawn
 * against, so the Existing display is the one place a survey edit is *meant* — and the edit layer
 * still refuses it until it is asked for as a correction. The canvas and the inspector answer that
 * gap by not offering the edit: handles, the rotate grip and the number fields stay shut until
 * `Correct Existing Model…` unlocks this one entity for one pending edit.
 *
 * Four things have to hold, and the caller passes them as plain values so this stays a question
 * about the model rather than a reader of the workspace: the Display is Existing, the Project
 * carries an Option, the entity is baseline work, and this entity is not the unlocked one.
 */
import type { RenovationState } from '../../../derive'
import type { RenovationDisplay } from '../../../domain'

export interface BaselineLockInput {
  readonly display: RenovationDisplay
  /** Whether the Project carries the Design Option this view draws. */
  readonly hasOptions: boolean
  /** The State the entity is drawn in. A view with no Option draws everything as `existing`. */
  readonly state: RenovationState
  readonly unlockedId: string | null
  readonly entityId: string
}

export const baselineEditLocked = (input: BaselineLockInput): boolean =>
  input.display === 'existing' &&
  input.hasOptions &&
  input.state === 'existing' &&
  input.unlockedId !== input.entityId
