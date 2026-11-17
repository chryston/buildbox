import type { Page } from '@playwright/test'

// The untouched legacy persist key (#20 §14). S1, S4 and the screenshot issue all seed
// or assert against this exact key, so it lives here rather than in a spec.
export const LEGACY_STORE_KEY = 'buildbox-store'

/**
 * Write a raw `localStorage['buildbox-store']` value before any app script runs, on this
 * page and on every later navigation. `rawValue` is stored verbatim — never re-serialize
 * a fixture on the way in, or the byte-for-byte guarantee in fixtures/legacy is lost.
 */
export async function seedLegacyStore(page: Page, rawValue: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value)
    },
    [LEGACY_STORE_KEY, rawValue],
  )
}

/** The current raw value, or null when the key is absent. */
export async function readLegacyStore(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), LEGACY_STORE_KEY)
}
