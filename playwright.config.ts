import { defineConfig, devices } from '@playwright/test'

// Real-browser smoke tiers (#38, #20 §9.4):
//   chromium  — every PR, against `vite preview` of the local build;
//   firefox / webkit — nightly.yml;
//   live Pages URL — static.yml `smoke-live`, which sets PLAYWRIGHT_BASE_URL.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173/buildbox/'

// The same scenarios on every engine, so a nightly failure means an engine-specific
// bug rather than a different test. Since #53 there is one artifact: Local Projects is
// the app, so the smoke set that used to need a flag-on build runs here like the rest.
// The one exception is the quota scenario, which needs CDP and skips itself on the
// engines that have no equivalent (#20 §9.4).
const engines = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
}

export default defineConfig({
  testDir: 'e2e/smoke',
  // `design-options.spec.ts` asks for a `VITE_FF_RENOVATION` build, which none of these engines is
  // served: `npm run test:e2e:renovation` runs it against its own preview server, from
  // `playwright.renovation.config.ts`.
  testIgnore: ['**/design-options.spec.ts', '**/renovation-displays.spec.ts', '**/renovation-layers.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: Object.entries(engines).map(([name, device]) => ({
    name,
    use: { ...device, viewport: { width: 1440, height: 1000 } },
  })),

  // Against a deployed URL there is nothing to serve; locally `vite preview` needs a
  // prior `npm run build`, which the test:e2e script does not run — run it first.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npx vite preview --port 4173 --strictPort',
        url: 'http://localhost:4173/buildbox/',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
})
