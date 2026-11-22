import { defineConfig, devices } from '@playwright/test'

/**
 * The dark feature's own smoke tier (#69): the Design Options surface exists only in a build made
 * with `VITE_FF_RENOVATION`, so it is built with `.env.renovation`, served from its own port, and
 * run by its own command — `npm run test:e2e:renovation`. The flag-off set in `playwright.config.ts`
 * ignores the same file, so no scenario runs twice and none runs against a build that cannot answer
 * it.
 *
 * Chromium and Firefox, the way the flag-off set is split between CI and nightly: the same scenario
 * on a second engine means an engine failure is an engine's own. Webkit stays nightly-only, and the
 * feature is dark there too.
 */
export default defineConfig({
  testDir: 'e2e/smoke',
  testMatch: 'design-options.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:4174/buildbox/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'renovation-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'renovation-firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 1000 } } },
  ],

  // `vite preview` serves whatever `dist` already holds, which is why the script that runs this
  // builds first: the flag is baked in at build time, and a preview of a flag-off `dist` shows an
  // empty settings section, a missing inspector action, and a Library that refuses the v8 seed.
  webServer: {
    command: 'npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174/buildbox/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
