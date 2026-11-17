/**
 * The two constructors of the ports' `Result`, so a session reads as a sequence of
 * decisions rather than a sequence of object literals (#45, #48).
 *
 * Internal to `session`: the public face is `persistence`'s `Result` itself, re-exported
 * from the module index.
 */
import type { Result } from '../persistence'

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })
