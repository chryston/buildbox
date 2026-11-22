/**
 * Whether the inspector's fields are shut, and what to say about it (#70 §7c).
 *
 * A baseline entity in Existing display with Design Options open is shared by every Option, so its
 * numbers are read there until `Correct Existing Model…` says the person means to change the survey
 * itself. The workspace wraps the inspector rail in the Provider; each field reads the one flag
 * rather than a prop threaded through four inspectors, and the answer is unlocked by default because
 * every other surface in the app is editable.
 *
 * The sentence travels with the flag rather than being read from the copy table by each field: that
 * table is reached only from a flagged branch, and a field drawn in a flag-off build must not be the
 * thing that pulls it into the bundle.
 */
import { createContext, useContext } from 'react'

export interface FieldsLock {
  readonly locked: boolean
  /** Why a field is shut, in the words of the one press that opens it; `''` when there is nothing to say. */
  readonly notice: string
}

const unlockedFields: FieldsLock = { locked: false, notice: '' }

export const FIELDS_UNLOCKED: FieldsLock = unlockedFields

export const FieldsLockedContext = createContext<FieldsLock>(unlockedFields)

export const useFieldsLocked = (): FieldsLock => useContext(FieldsLockedContext)
