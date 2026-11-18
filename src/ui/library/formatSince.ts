/**
 * The one `{since}` formatter (#50 §2).
 *
 * Every relative time on the Library — a card's save line, its Backup line, and in #51 the
 * Recovery Point rows — goes through this function, because the archive showed the same instant
 * three ways in one screen and #28's whole argument is that the card tells the truth about
 * when.
 *
 * It takes "now" as an argument rather than reading a clock: `ui` may not mint time any more
 * than `domain` may (#42 §3), and the screenshot comparison pins the clock through
 * `page.clock.setFixedTime`, which only works if time is data all the way down.
 *
 * The day boundaries are calendar days in the browser's own timezone, and the clock time is
 * formatted for that timezone too. That is what makes `Yesterday, 8:42 PM` mean what the person
 * looking at the card expects, and it is why the parity fixture stores its instants in UTC and
 * pins the browser timezone: the prototype prints the string literally.
 */
import { STRINGS } from '../strings'

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

/** `8:42 PM`, `10:44 AM` — 12-hour, no leading zero on the hour, the archive's shape. */
const clockTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

/** Midnight, local, as an epoch value: two of these subtract to a whole number of calendar days. */
const startOfDay = (at: Date): number => Date.UTC(at.getFullYear(), at.getMonth(), at.getDate())

/** `3 Oct`, the archive's short date: day without a leading zero, three-letter month. */
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/** `3 Oct, 11:20 AM` — the shape every older instant takes once `Today` and `Yesterday` are spent. */
const datedTime = (then: Date): string => `${shortDate.format(then)}, ${clockTime.format(then)}`

/**
 * A Recovery Point's time: `Today, 9:15 AM`, `Yesterday, 6:30 PM`, otherwise `3 Oct, 11:20 AM`.
 *
 * A Point is chosen by *when* it was, so the row leads with the clock time and keeps the day
 * word for as long as it is true. `formatSince` counts the other way — it answers "how long
 * ago", which is what a card's save line says and not what a picker needs.
 */
export function formatPointTime(at: string, now: string): string {
  const then = new Date(at)
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(then)) / DAY_MS)
  if (days === 0) return STRINGS.sinceToday(clockTime.format(then))
  if (days === 1) return STRINGS.sinceYesterday(clockTime.format(then))
  return datedTime(then)
}

/**
 * The last successful save, as the Save failed dialog names it: `10:42 AM` today, otherwise
 * `3 Oct, 11:20 AM`.
 *
 * No `Today,` prefix: the dialog is read minutes after the failure, and the sentence
 * `BuildBox kept the last successful local version from Today, 10:42 AM` is not English.
 */
export function formatLastSave(at: string, now: string): string {
  const then = new Date(at)
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(then)) / DAY_MS)
  return days === 0 ? clockTime.format(then) : datedTime(then)
}

/**
 * How long ago `at` was, as one short phrase.
 *
 * Under a minute it is `just now` — the wording the toast leaves behind, so a card that was
 * just backed up reads the same way the toast said it. Under an hour it counts minutes; a
 * Backup taken forty minutes ago is not "Today, 3:12 PM", it is `40 min ago`. From there the
 * clock time is more useful than a count, until the day before yesterday, when counting again
 * beats reading a date nobody recognises.
 */
export function formatSince(at: string, now: string): string {
  const then = new Date(at)
  const current = new Date(now)
  const elapsed = current.getTime() - then.getTime()

  if (elapsed < MINUTE_MS) return STRINGS.sinceJustNow
  if (elapsed < 60 * MINUTE_MS) return STRINGS.sinceMinutes(Math.floor(elapsed / MINUTE_MS))

  const days = Math.round((startOfDay(current) - startOfDay(then)) / DAY_MS)
  if (days === 0) return STRINGS.sinceToday(clockTime.format(then))
  if (days === 1) return STRINGS.sinceYesterday(clockTime.format(then))
  return STRINGS.sinceDays(days)
}
