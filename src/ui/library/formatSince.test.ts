/**
 * The `{since}` formatter (#50 §2, criteria 5 and 6).
 *
 * The five shapes are pinned against one fixed instant rather than against "now", because the
 * interesting part of this function is exactly where one shape stops and the next begins — and
 * the archive's parity fixture sits on two of those boundaries (`2 min ago` and
 * `Yesterday, 8:42 PM`).
 */
import { describe, expect, it } from 'vitest'
import { formatSince } from './formatSince'

/** The parity clock: 10:44 AM on 7 October 2026, in UTC so the container's zone cannot move it. */
const NOW = '2026-10-07T10:44:00.000Z'

const at = (iso: string): string => formatSince(iso, NOW)

describe('formatSince', () => {
  it('says just now inside a minute', () => {
    expect(at('2026-10-07T10:44:00.000Z')).toBe('just now')
    expect(at('2026-10-07T10:43:20.000Z')).toBe('just now')
  })

  it('counts minutes up to an hour, and stops at 59', () => {
    expect(at('2026-10-07T10:42:00.000Z')).toBe('2 min ago')
    expect(at('2026-10-07T09:45:00.000Z')).toBe('59 min ago')
    expect(at('2026-10-07T09:44:00.000Z')).toBe('Today, 9:44 AM')
  })

  it('names the clock time for the rest of today', () => {
    expect(at('2026-10-07T00:05:00.000Z')).toBe('Today, 12:05 AM')
    expect(at('2026-10-07T09:15:00.000Z')).toBe('Today, 9:15 AM')
  })

  it('names the clock time for yesterday, whatever hour it was', () => {
    expect(at('2026-10-06T20:42:00.000Z')).toBe('Yesterday, 8:42 PM')
    expect(at('2026-10-06T23:59:00.000Z')).toBe('Yesterday, 11:59 PM')
  })

  it('counts days from the day before yesterday, on calendar days', () => {
    // Twenty-five hours back is still two calendar days, which is what a person reading the
    // card means by "2 days ago" — not a floor of an elapsed-hour count.
    expect(at('2026-10-05T10:00:00.000Z')).toBe('2 days ago')
    expect(at('2026-10-03T10:44:00.000Z')).toBe('4 days ago')
    expect(at('2026-09-18T10:44:00.000Z')).toBe('19 days ago')
  })
})
