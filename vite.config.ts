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
// The adapter is the one part of `persistence` that needs a DOM-ish host.
const PURE_EXCLUDE = ['src/persistence/indexeddb/**']
// Not a module test, but a Node test all the same: it walks `fixtures/legacy` on disk and
// hashes the files, and `import.meta.url` is only a file URL outside jsdom.
const NODE_ONLY_INCLUDE = ['src/test/legacyFixtures.test.ts']

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
    ],
  },
})
