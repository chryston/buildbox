/**
 * The browser clock behind `session`'s `ClockPort` (#49, #20 §2).
 *
 * `session` is pure and never reads a clock (#42 §3); everything time-shaped arrives as
 * data, and this is where the data comes from in a browser. `dayKey` is the calendar day
 * in the *user's* zone, because `recovery.prune` groups Recovery Points by the day the user
 * experienced (#45) — a UTC day would split one of theirs in half.
 */
import type { ClockPort } from '../session'

/** `en-CA` gives `YYYY-MM-DD`; the zone is the host's, which is the point (#45). */
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** `Date`, `setTimeout` and the local calendar: the ports #48 leaves unbound. */
export function createPlatformClock(): ClockPort {
  return {
    now: () => new Date().toISOString(),
    dayKey(iso) {
      const parts = DAY_FORMAT.formatToParts(new Date(iso))
      const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
      return `${read('year')}-${read('month')}-${read('day')}`
    },
    setTimer(ms, fn) {
      const handle = setTimeout(fn, ms)
      // `clearTimeout` on an already-fired id is a no-op, so cancelling twice is safe.
      return () => clearTimeout(handle)
    },
  }
}
