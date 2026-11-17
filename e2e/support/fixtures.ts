import { test as base, expect } from '@playwright/test'

// Anything the page logs at error level, or throws, is an app bug: the smoke suite fails
// on it (#38 acceptance 7). Keep this list empty. Every entry needs a comment saying why
// the message is not a bug, or it does not belong here.
const ALLOWED_CONSOLE_ERRORS: readonly RegExp[] = []

export const test = base.extend<{ consoleGuard: void }>({
  // auto: the guard is on for every test in the suite, including ones that never ask
  // for it, so a scenario cannot accidentally run unguarded.
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = []

      page.on('pageerror', (error) => {
        problems.push(`uncaught error: ${error.stack ?? error.message}`)
      })
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        const text = message.text()
        if (ALLOWED_CONSOLE_ERRORS.some((pattern) => pattern.test(text))) return
        problems.push(`console.error: ${text}`)
      })

      await use()

      expect(problems, 'page threw or logged an error').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
