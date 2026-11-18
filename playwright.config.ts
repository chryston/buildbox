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

// The flag-on artifact is a second build on a second port (#49): `npm run build:preview`
// writes `dist-preview/`, and only the `projects-v2` project is pointed at it.
const previewBaseURL = 'http://localhost:4174/buildbox/'

// The flag-on specs assert against that artifact; the flag-off engines have nothing to
// assert there, and vice versa. #50's four are named by file rather than by prefix, because
// the issue names them `backup-restore.spec.ts` and not `projects-v2-backup.spec.ts`.
const PREVIEW_ONLY = /(?:projects-v2-.*|backup-restore|restore-rejections|collision|gc)\.spec\.ts$/

const desktopProjects = Object.entries(engines).map(([name, device]) => ({
  name,
  use: { ...device, viewport: { width: 1440, height: 1000 } },
  testIgnore: PREVIEW_ONLY,
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

  projects: [
    ...desktopProjects,
    {
      name: 'projects-v2',
      // Chromium only, like the screenshot project: this is one artifact on one engine, and
      // nightly owns the other engines (#38).
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 }, baseURL: previewBaseURL },
      testMatch: PREVIEW_ONLY,
    },
  ],

  // Against a deployed URL there is nothing to serve; locally `vite preview` needs a
  // prior `npm run build`, which the test:e2e script does not run — run it first, and
  // `npm run build:preview` for the flag-on server.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: 'npx vite preview --port 4173 --strictPort',
          url: 'http://localhost:4173/buildbox/',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
        {
          command: 'npx vite preview --outDir dist-preview --port 4174 --strictPort',
          url: previewBaseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      ],
})
