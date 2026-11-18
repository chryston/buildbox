import { defineConfig, devices } from '@playwright/test'

// Screenshot baselines (#39, #20 §9.5). The only supported runner is the pinned Playwright
// container — `npm run test:screenshots` (scripts/run-screenshots.mjs) — because a baseline
// is only comparable if every machine produces the same font rendering. Chromium only:
// #20 §9.5 baselines one engine, and Firefox/WebKit stay nightly-only (#38).
//
// `vite preview` of the local build, same server as the smoke config. One artifact since
// #53: Local Projects is the app, so there is no second build to photograph.
const baseURL = 'http://localhost:4173/buildbox/'
const viewport = { width: 1440, height: 1000 }

export default defineConfig({
  testDir: 'e2e/screenshots',
  // Baselines sit next to the spec that produced them, named after the capture, so a
  // diff in a PR review reads as `cabinet-scene.png`, not a hashed path.
  snapshotPathTemplate: 'e2e/screenshots/__snapshots__/{testFilePath}/{arg}{ext}',

  // One capture at a time: the point of this suite is that two runs on the same commit
  // produce identical pixels, and a shared CPU is the one thing that could perturb that.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // A retry would hide the flake a baseline is supposed to surface.
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    viewport,
    deviceScaleFactor: 1,
    // The app has no dark scheme today, so the scheme is part of the baseline contract:
    // a host OS theme must never change a pixel (#20 §9.5).
    colorScheme: 'light',
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  expect: {
    toHaveScreenshot: {
      // Any real pixel change fails; `threshold` only absorbs antialiasing noise.
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

  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
