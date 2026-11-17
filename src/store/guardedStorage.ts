/**
 * The persist storage that refuses to overwrite unreadable data (#40 §3).
 *
 * `getItem` is the only place that looks at what is in `localStorage`, and it is the
 * first thing the persist middleware does. If the value fails `checkLegacyStore`, the
 * raw string and every problem are parked here, the store hydrates with defaults, and
 * every later write is dropped — so the user's bytes survive until they choose what
 * happens to them. `main.tsx` reads the failure slot and shows the recovery screen.
 */
import type { StateStorage } from 'zustand/middleware'
import { checkLegacyStore } from '../package'
import type { ValidationProblem } from '../lib'

/** The persist key, and the only key this guard is asked about. */
export const STORE_KEY = 'buildbox-store'

export interface StoredStateFailure {
  /** The stored string, byte for byte, exactly as it was read. */
  raw: string
  problems: ValidationProblem[]
}

let failure: StoredStateFailure | null = null
let blocked = false

export const guardedStorage: StateStorage = {
  getItem: (name) => {
    const raw = localStorage.getItem(name)
    if (raw === null) return null
    const check = checkLegacyStore(raw)
    if (check.ok) return raw
    failure = { raw, problems: check.problems }
    blocked = true
    return null
  },
  setItem: (name, value) => {
    if (blocked) return
    localStorage.setItem(name, value)
  },
  removeItem: (name) => {
    if (blocked) return
    localStorage.removeItem(name)
  },
}

/** Why rehydration was refused, or null when the stored data opened cleanly. */
export function getStoredStateFailure(): StoredStateFailure | null {
  return failure
}
