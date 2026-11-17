import { defineConfig, devices } from '@playwright/test'

// Real-browser smoke tiers (#38, #20 §9.4):
//   chromium  — every PR, against `vite preview` of the local build;
//   firefox / webkit — nightly.yml;
//   live Pages URL — static.yml `smoke-live`, which sets PLAYWRIGHT_BASE_URL.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173/buildbox/'

// The same scenarios on every engine, so a nightly failure means an engine-specific
// bug rather than a different test.
const engines = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
}

const desktopProjects = Object.entries(engines).map(([name, device]) => ({
  name,
  use: { ...device, viewport: { width: 1440, height: 1000 } },
}))

export default defineConfig({
  testDir: 'e2e/smoke',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: desktopProjects,

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
