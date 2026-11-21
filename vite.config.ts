import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// The version a Project Backup's manifest carries (#50). It comes from `package.json` rather
// than from a runtime read of it, because there is no `package.json` at runtime: `buildboxVersion`
// is written into every archive, and `package` compares it against this same constant when a
// Backup is staged, so the two must be the one value the build was made from.
// `package.json` is our own file, not outside input, so naming the shape it is read as is
// enough; a validator would only restate it.
const pkg: { version: string } = JSON.parse(readFileSync('./package.json', 'utf8'))
const BUILDBOX_VERSION = pkg.version

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
const NODE_ONLY_INCLUDE = [
  'src/test/legacyFixtures.test.ts',
  'src/test/legacyMigration.test.ts',
  // Criterion 5 of #60 holds the derived cabinet Item Detail against `computeSceneLayout` over
  // every legacy fixture, which needs `package`'s converter, so it is a Node test in the
  // `test-support` element — and `import.meta.url` is only a file URL outside jsdom.
  'src/test/deriveCabinetItemDetail.test.ts',
  // The Rooms scene fixture (#67 criterion 11) is checked as the browser loads it, from disk,
  // so it is a Node test of the same kind.
  'src/test/roomsScene.test.ts',
  // The five element goldens (#68 criterion 1) are compared against the files on disk, so they are
  // Node tests of the same kind — and `ui/strings` is injected into `tables` from here.
  'src/test/tablesGolden.test.ts',
  // Criterion 6 of #68 exports a PDF, which needs the bundled font read from disk — and
  // `import.meta.url` is only a file URL outside jsdom.
  'src/test/warningsOnDrawings.test.ts',
  // The invalid-proposal controller (#58 §6) lives in `ui` because it is UI state, but it is
  // a pure state machine — no React, no DOM — and the issue verifies it under Node.
  'src/ui/workspace/shape/**/*.test.ts',
  // The Wall draft machine (#64 §12) is the same kind of thing: UI state, no React, no DOM.
  'src/ui/workspace/wall/**/*.test.ts',
  // So is the Door / window tool's aim (#65 §10): a function of the pointer, no React, no DOM.
  'src/ui/workspace/opening/**/*.test.ts',
  // #58 criterion 10's property test drives the controller against `edit`, which only the
  // `src/integration` element may import. It is a Node test all the same.
  'src/integration/**/*.property.test.ts',
  // The remembered recipe is read out of the preference store by `app`, and the test seeds it with
  // a Project from `derive/testing`, which reads `fixtures/` off disk — so `import.meta.url` has to
  // be a file URL. jsdom gives it as an http URL, which `fileURLToPath` refuses.
  'src/app/export.test.ts',
  // The shipped-wording scan reads the source of every module off disk, which needs
  // `import.meta.url` to be a file URL — jsdom hands it over as an http URL.
  'src/app/shippedStrings.test.ts',
]

// The adapter's own suites: `fake-indexeddb` under Node, and `*.browser.test.ts` against
// real IndexedDB in a real browser. Chromium is part of `npm test`; the nightly workflow
// names one of the other two engines in `BB_BROWSER` (#20 §9.4), which is what the
// `instances` list below is built from.
const BROWSER = (process.env['BB_BROWSER'] ?? 'chromium') as 'chromium' | 'firefox' | 'webkit'
const ADAPTER_INCLUDE = ['src/persistence/indexeddb/**/*.test.ts']
const BROWSER_INCLUDE = ['src/persistence/indexeddb/**/*.browser.test.ts']
// The quota case runs alone in its own browser; see the `persistence-quota` project below.
const QUOTA_INCLUDE = ['src/persistence/indexeddb/quota.browser.test.ts']
// The workspace layout tests (#55) measure real bounding boxes, which jsdom cannot give.
const LAYOUT_BROWSER_INCLUDE = ['src/ui/**/*.browser.test.{ts,tsx}']
// #69 ships dark: `VITE_FF_RENOVATION` decides at config-read time whether the renovation suites
// exist at all. Vitest fills `import.meta.env` once, when it reads this file, so one run has one
// flag value and a flagged suite cannot be a project of the flag-off run — `npm test` never looks
// for files it has no flag to read, and `npm run test:renovation` is the run that does.
const FF_RENOVATION = process.env['VITE_FF_RENOVATION'] === 'true'
const RENOVATION_INCLUDE = ['src/**/*.renovation.test.{ts,tsx}']

const SHARED_EXCLUDE = ['e2e/**', ...configDefaults.exclude]

export default defineConfig({
  base: '/buildbox/',
  define: { __BUILDBOX_VERSION__: JSON.stringify(BUILDBOX_VERSION) },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // The export is one chunk, named `export`, and it is lazy (#61 §11): `pdf-lib`,
        // `@pdf-lib/fontkit` and the 52 kB subset face are most of a megabyte of source, and a
        // reader who never presses Export must not download any of it. Naming the chunk is what
        // lets `scripts/check-size-budget.mjs` find it and hold it to a cap — a hashed name
        // nobody can point at is a budget nobody can enforce.
        //
        // Everything `export` imports from the app's own modules stays where it already was:
        // `drawing` and `derive` are used by the canvas too, and pulling them in here would
        // either duplicate them or move the whole editor off the first paint.
        manualChunks(id) {
          if (id.includes('/src/export/')) return 'export'
          if (id.includes('/node_modules/pdf-lib/') || id.includes('/node_modules/@pdf-lib/')) return 'export'
          return null
        },
      },
    },
  },
  test: {
    globals: true,
    // `src/session/history.bench.ts` measures retained bytes, which needs a collection the
    // bench can ask the engine for (#48). Inline projects may not set `execArgv` themselves,
    // so it comes from the root config that every project extends.
    poolOptions: { forks: { execArgv: ['--expose-gc'] } },
    projects: [
      {
        extends: true,
        test: {
          name: 'pure',
          environment: 'node',
          include: [...PURE_INCLUDE, ...NODE_ONLY_INCLUDE],
          exclude: [...PURE_EXCLUDE, ...RENOVATION_INCLUDE, ...SHARED_EXCLUDE],
          setupFiles: ['src/test/pure-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: [...PURE_INCLUDE, ...NODE_ONLY_INCLUDE, ...PURE_EXCLUDE, ...RENOVATION_INCLUDE, ...LAYOUT_BROWSER_INCLUDE, ...SHARED_EXCLUDE],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      // The renovation model's own suites (#69), under Node like `pure` and jsdom like `dom`.
      // Present only in a run made with the flag set, so a flag-off `npm test` neither runs nor
      // misses them.
      ...(FF_RENOVATION
        ? [
            {
              extends: true as const,
              test: {
                name: 'renovation',
                environment: 'node',
                include: RENOVATION_INCLUDE,
                exclude: [...SHARED_EXCLUDE],
                setupFiles: ['src/test/pure-setup.ts'],
              },
            },
            {
              extends: true as const,
              test: {
                name: 'renovation-dom',
                environment: 'jsdom',
                include: ['src/**/*.renovation.test.tsx'],
                exclude: [...SHARED_EXCLUDE],
                setupFiles: ['./src/test/setup.ts'],
              },
            },
          ]
        : []),
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
        // The workspace layout (#55 criteria 1, 2, 4, 7): real bounding boxes at the
        // widths the issue names, which only a real CSS engine can give.
        extends: true,
        test: {
          name: 'workspace-layout',
          include: [...LAYOUT_BROWSER_INCLUDE],
          exclude: [...SHARED_EXCLUDE],
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
