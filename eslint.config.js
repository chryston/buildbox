import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import boundaries from 'eslint-plugin-boundaries'

// S0 boundaries (#35). These descriptors mirror today's folders. Issue #41 swaps
// them for the #20 §2 target allow-list: only ELEMENTS, PURE_ELEMENTS and
// ELEMENT_TYPE_RULES change, everything below them is derived.
const ELEMENTS = [
  // Most specific first: the plugin assigns the first element whose pattern matches.
  // The two download helpers use document/URL, so they must be claimed before `utils`,
  // and so must the test that drives them through a real jsdom document.
  {
    type: 'utils-dom',
    pattern: ['src/utils/exportSVG.ts', 'src/utils/exportSVG.test.ts', 'src/utils/floorPlanExport.ts'],
    mode: 'file',
  },
  { type: 'types', pattern: ['src/types'], mode: 'folder' },
  { type: 'engine', pattern: ['src/engine'], mode: 'folder' },
  { type: 'data', pattern: ['src/data'], mode: 'folder' },
  { type: 'utils', pattern: ['src/utils'], mode: 'folder' },
  { type: 'store', pattern: ['src/store'], mode: 'folder' },
  { type: 'components', pattern: ['src/components'], mode: 'folder' },
  { type: 'app', pattern: ['src/App.tsx', 'src/main.tsx'], mode: 'file' },
  { type: 'test-support', pattern: ['src/test', 'src/integration'], mode: 'folder' },
]

// Element types that must stay free of DOM globals and UI/state imports (#20 §2).
const PURE_ELEMENTS = ['types', 'engine', 'data', 'utils']

const DOM_GLOBALS = ['window', 'document', 'localStorage', 'indexedDB', 'navigator']

const NON_PURE_IMPORTS = ['react', 'react-dom', 'react/*', 'zustand', 'zundo', 'idb']

// Inward-only allow-list. An empty `allow` is already the default disallow.
const ELEMENT_TYPE_RULES = [
  { from: ['types'], allow: [] },
  { from: ['engine'], allow: ['types', 'engine'] },
  { from: ['data'], allow: ['types'] },
  { from: ['utils'], allow: ['types', 'data', 'engine'] },
  // utils-dom is a file element, so each helper (and the test that drives one through
  // jsdom) is its own element: the type has to be allowed to reference itself.
  { from: ['utils-dom'], allow: ['types', 'utils-dom'] },
  { from: ['store'], allow: ['types', 'engine', 'utils', 'data'] },
  { from: ['components'], allow: ['components', 'store', 'engine', 'utils', 'utils-dom', 'data', 'types'] },
  { from: ['app', 'test-support'], allow: ['*'] },
]

const pureElementFiles = ELEMENTS
  .filter((element) => PURE_ELEMENTS.includes(element.type) && element.mode === 'folder')
  .flatMap((element) => element.pattern.map((pattern) => `${pattern}/**/*`))

// Files claimed out of a pure folder by a non-pure file element (the utils-dom helpers).
const pureElementExempts = ELEMENTS.filter(
  (element) => !PURE_ELEMENTS.includes(element.type) && element.mode === 'file',
).flatMap((element) => element.pattern)

export default tseslint.config(
  // .prototype-cache holds the published prototype bytes scripts/run-screenshots.mjs stages
  // (#39): compared against, never linted or fixed.
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.prototype-cache/**'] },

  // Plain JS: root config files and scripts, JS recommended rules only.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },

  {
    // e2e/ and playwright.config.ts are Playwright's (#38): browser + node globals,
    // no boundaries plugin — that descriptor models src/ layers only.
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts', 'playwright.config.ts', 'playwright.screenshots.config.ts', 'vite.config.ts', 'tailwind.config.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': ELEMENTS,
      // The plugin resolves imports with the node resolver it ships (eslint-module-utils),
      // which needs the TS extensions to classify local files at all.
      'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'] } },
    },
    rules: {
      'boundaries/element-types': [
        'error',
        { default: 'disallow', rules: ELEMENT_TYPE_RULES.filter((rule) => rule.allow.length > 0) },
      ],
    },
  },

  {
    files: pureElementFiles,
    ignores: pureElementExempts,
    rules: {
      'no-restricted-globals': [
        'error',
        ...DOM_GLOBALS.map((name) => ({
          name,
          message: 'Pure module: no DOM globals (#20 §2).',
        })),
      ],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: NON_PURE_IMPORTS, message: 'Pure module: no React or state-library imports (#20 §2).' }] },
      ],
    },
  },
)
