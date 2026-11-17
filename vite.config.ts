import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vitest projects (#20 §9.1, #41 §4): pure modules run under Node with no DOM, UI runs
// under jsdom. The pure include list is the target module set minus `platform`, `ui` and
// `app`; folders without tests yet simply match nothing, so later issues extend nothing.
const PURE_MODULES = [
  'lib',
  'geometry',
  'domain',
  'cabinet',
  'derive',
  'edit',
  'drawing',
  'package',
  'export',
  'persistence',
  'session',
]

const PURE_INCLUDE = [`src/{${PURE_MODULES.join(',')}}/**/*.test.ts`]
// The adapter is the one part of `persistence` that needs a real IndexedDB host, so it is
// out of `pure` and `dom` and runs in the two projects below (#46, #20 §9.2).
const PURE_EXCLUDE = ['src/persistence/indexeddb/**']
// Not a module test, but a Node test all the same: it walks `fixtures/legacy` on disk and
// hashes the files, and `import.meta.url` is only a file URL outside jsdom.
const NODE_ONLY_INCLUDE = ['src/test/legacyFixtures.test.ts']

// The adapter's own suites: `fake-indexeddb` under Node, and `*.browser.test.ts` against
// real IndexedDB in a real browser. Chromium is part of `npm test`; the nightly workflow
// names one of the other two engines in `BB_BROWSER` (#20 §9.4), which is what the
// `instances` list below is built from.
const BROWSER = (process.env['BB_BROWSER'] ?? 'chromium') as 'chromium' | 'firefox' | 'webkit'
const ADAPTER_INCLUDE = ['src/persistence/indexeddb/**/*.test.ts']
const BROWSER_INCLUDE = ['src/persistence/indexeddb/**/*.browser.test.ts']
// The quota case runs alone in its own browser; see the `persistence-quota` project below.
const QUOTA_INCLUDE = ['src/persistence/indexeddb/quota.browser.test.ts']

const SHARED_EXCLUDE = ['e2e/**', ...configDefaults.exclude]

export default defineConfig({
  base: '/buildbox/',
  plugins: [react()],
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'pure',
          environment: 'node',
          include: [...PURE_INCLUDE, ...NODE_ONLY_INCLUDE],
          exclude: [...PURE_EXCLUDE, ...SHARED_EXCLUDE],
          setupFiles: ['src/test/pure-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: [...PURE_INCLUDE, ...NODE_ONLY_INCLUDE, ...PURE_EXCLUDE, ...SHARED_EXCLUDE],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      {
        // The adapter over `fake-indexeddb` (#46): a Node host, an injected `IDBFactory`
        // per test, no DOM globals — which is why it takes no setup file at all.
        extends: true,
        test: {
          name: 'persistence-fake',
          environment: 'node',
          include: [...ADAPTER_INCLUDE],
          exclude: [...BROWSER_INCLUDE, ...SHARED_EXCLUDE],
        },
      },
      {
        // The same suites over real IndexedDB (#46, #20 §9.2).
        extends: true,
        test: {
          name: 'persistence-browser',
          include: [...BROWSER_INCLUDE],
          exclude: [...QUOTA_INCLUDE, ...SHARED_EXCLUDE],
          browser: {
            enabled: true,
            headless: true,
            provider: 'playwright',
            instances: [{ browser: BROWSER }],
          },
        },
      },
      {
        // The quota case in a browser of its own (#46 criterion 5). Chromium reads an origin's
        // quota once, when IndexedDB first starts up for that origin, so the DevTools override
        // only bites if nothing in this browser has used IndexedDB yet — which a second test
        // file sharing the browser would quietly break. Firefox and WebKit have no such
        // command; the case skips itself there and the nightly workflow does not run this
        // project at all.
        extends: true,
        test: {
          name: 'persistence-quota',
          include: [...QUOTA_INCLUDE],
          exclude: [...SHARED_EXCLUDE],
          browser: {
            enabled: true,
            headless: true,
            provider: 'playwright',
            instances: [{ browser: BROWSER }],
          },
        },
      },
    ],
  },
})
