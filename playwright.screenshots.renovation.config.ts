import { defineConfig, devices } from '@playwright/test'

// The dark feature's own baselines (#70). The flag-off suite photographs a build that cannot show a
// Renovation Display at all, so the renovation scenes get their own artifact — `vite build --mode
// renovation`, served from its own port — and their own `__snapshots__` directory, so a renovation
// baseline can never be confused with a flag-off one, and neither can rewrite the other.
//
// Same pinned container, same zero-tolerance diff, same single worker: a baseline is only comparable
// if every machine renders the same fonts (`npm run test:screenshots:renovation`).
const baseURL = 'http://localhost:4175/buildbox/'
const viewport = { width: 1440, height: 1000 }

export default defineConfig({
  testDir: 'e2e/screenshots-renovation',
  snapshotPathTemplate: 'e2e/screenshots-renovation/__snapshots__/{testFilePath}/{arg}{ext}',

  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    viewport,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 0,
      threshold: 0.2,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport, deviceScaleFactor: 1 } },
  ],

  // The script that runs this builds with `.env.renovation` first: the flag is baked in at build
  // time, and a preview of a flag-off `dist` shows no mode bar, no Display cards and no overlays.
  webServer: {
    command: 'npx vite preview --port 4175 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
