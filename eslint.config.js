import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import boundaries from 'eslint-plugin-boundaries'
import importX from 'eslint-plugin-import-x'

// #20 §2 target modules, the allow-list verbatim (#41 §1). A module is the folder
// `src/<name>` with the public entry `src/<name>/index.ts`; everything below is derived
// from this table, so the issue that gives a folder its first code adds a row — or
// nothing at all, when the row is already here — and never re-copies a rule.
//
// `impure` modules may touch the DOM and import React; `immerAllowed` is #20 §4's Edit
// Transaction exception; `typeOnly` entries are reachable only through `import type`.
const TARGET_MODULES = [
  { name: 'lib', allow: [] },
  { name: 'geometry', allow: ['lib'] },
  { name: 'domain', allow: ['geometry', 'lib'] },
  { name: 'cabinet', allow: ['domain'] },
  { name: 'derive', allow: ['domain', 'geometry', 'cabinet', 'lib'] },
  { name: 'edit', allow: ['domain', 'geometry', 'cabinet', 'derive', 'lib'], immerAllowed: true },
  { name: 'drawing', allow: ['derive', 'domain', 'geometry', 'cabinet', 'lib'] },
  { name: 'package', allow: ['domain', 'lib'] },
  { name: 'export', allow: ['drawing', 'derive', 'domain', 'lib'] },
  { name: 'persistence', allow: ['domain', 'lib'] },
  { name: 'session', allow: ['edit', 'derive', 'package', 'domain', 'persistence', 'lib'] },
  {
    name: 'platform',
    allow: ['lib'],
    typeOnly: ['persistence', 'session'],
    impure: true,
  },
  {
    name: 'ui',
    allow: ['session', 'drawing', 'derive', 'domain', 'export'],
    typeOnly: ['edit'],
    impure: true,
  },
  // Everything, and the only importer of the adapters: `indexeddb` and `platform`.
  { name: 'app', allow: ['*'], impure: true },
]

// Legacy elements shrink to nothing at the S4 cutover. They keep their S0 allow-lists —
// with `engine` replaced by the target modules that received it — and may also import the
// target modules below, through their entry points only. No target module may import any
// of them.
const LEGACY_TARGET_MODULES = ['lib', 'domain', 'cabinet', 'package']

const LEGACY_ELEMENTS = [
  {
    name: 'legacy-utils-dom',
    // The two download helpers use document/URL, so they must be claimed before
    // `legacy-utils`, and so must the test that drives one through a real jsdom document.
    pattern: ['src/utils/exportSVG.ts', 'src/utils/exportSVG.test.ts', 'src/utils/floorPlanExport.ts'],
    mode: 'file',
    allow: ['legacy-types', 'legacy-utils-dom'],
  },
  { name: 'legacy-types', pattern: ['src/types'], mode: 'folder', allow: ['legacy-types'], pure: true },
  {
    name: 'legacy-utils',
    pattern: ['src/utils'],
    mode: 'folder',
    allow: ['legacy-types', 'legacy-data', 'legacy-utils'],
    pure: true,
  },
  {
    name: 'legacy-data',
    pattern: ['src/data'],
    mode: 'folder',
    allow: ['legacy-types', 'legacy-data'],
    pure: true,
  },
  {
    name: 'legacy-store',
    pattern: ['src/store'],
    mode: 'folder',
    allow: ['legacy-types', 'legacy-utils', 'legacy-data', 'legacy-store'],
  },
  {
    name: 'legacy-components',
    pattern: ['src/components'],
    mode: 'folder',
    allow: [
      'legacy-components',
      'legacy-store',
      'legacy-utils',
      'legacy-utils-dom',
      'legacy-data',
      'legacy-types',
    ],
  },
  // Renamed from S0's `app` so it does not collide with the target `app` module.
  { name: 'legacy-root', pattern: ['src/App.tsx', 'src/main.tsx'], mode: 'file', allow: ['*'] },
  { name: 'test-support', pattern: ['src/test', 'src/integration'], mode: 'folder', allow: ['*'] },
  {
    // The one file in `package` allowed to reach `cabinet` and `derive`: #43's parity test
    // has to hold the converter, the layout and cut-list engine it is compared against,
    // and the `derive` projection back into cabinet vocabulary in a single scope. It is a
    // test file, so it ships nothing — every real source file under `src/package` still
    // imports nothing but `domain` and `lib`.
    name: 'legacy-parity-test',
    pattern: ['src/package/legacy/parity.test.ts'],
    mode: 'file',
    allow: ['*'],
    pure: true,
  },
]

// The IndexedDB adapter is the one part of `persistence` allowed a DOM: the only element
// outside `ui`/`app` that may talk to the browser.
const ADAPTER_ELEMENT = { type: 'indexeddb', pattern: ['src/persistence/indexeddb'], mode: 'folder' }

const TARGET_MODULE_NAMES = TARGET_MODULES.map((module) => module.name)

// Elements whose files are importable individually: legacy code has no entry point until
// it is merged into a target module, and `app` reaches adapters file-by-file.
const OPEN_ENTRY_ELEMENT_NAMES = [ADAPTER_ELEMENT.type, ...LEGACY_ELEMENTS.map((element) => element.name)]

const legacyElement = (element) => ({ type: element.name, pattern: element.pattern, mode: element.mode })

// Most specific first: the plugin assigns the first element whose pattern matches.
const ELEMENTS = [
  ADAPTER_ELEMENT,
  ...LEGACY_ELEMENTS.filter((element) => element.mode === 'file').map(legacyElement),
  ...TARGET_MODULES.map((module) => ({ type: module.name, pattern: [`src/${module.name}`], mode: 'folder' })),
  ...LEGACY_ELEMENTS.filter((element) => element.mode === 'folder').map(legacyElement),
]

// Pure set (#20 §2): every target module except `platform`, `ui`, `app` and the IndexedDB
// adapter, plus the legacy folders that were already pure in S0.
const PURE_TARGET_MODULES = TARGET_MODULES.filter((module) => !module.impure)
const PURE_LEGACY_ELEMENTS = LEGACY_ELEMENTS.filter((element) => element.pure)

const DOM_GLOBALS = ['window', 'document', 'localStorage', 'indexedDB', 'navigator']

const NON_PURE_IMPORTS = ['react', 'react-dom', 'react/*', 'zustand', 'zundo', 'idb']

const folderPatterns = (patterns) => patterns.flatMap((pattern) => `${pattern}/**/*`)

// Files claimed out of a pure folder by a non-pure element (the utils-dom helpers).
const NON_PURE_FILE_PATTERNS = LEGACY_ELEMENTS.filter(
  (element) => !element.pure && element.mode === 'file',
).flatMap((element) => element.pattern)

const pureFiles = (moduleNames) => [
  ...moduleNames.flatMap((name) => folderPatterns([`src/${name}`])),
  ...PURE_LEGACY_ELEMENTS.flatMap((element) => folderPatterns(element.pattern)),
]

// The adapter's own files, claimed out of the pure set below: it is the one part of
// `persistence` allowed `idb`, the DOM globals and a real browser (#46).
const ADAPTER_FILES = folderPatterns(['src/persistence/indexeddb'])

// #42 §3: a pure module never creates an ID and never reads the clock. IDs and time
// arrive as data — pre-allocated in an Intent (#20 §4), or through an injected `newId`
// or `now` parameter, the way `package/legacy` already does.
const NON_DETERMINISTIC_PROPERTIES = [
  {
    object: 'crypto',
    property: 'randomUUID',
    message: 'Pure module: IDs arrive as data, never generated here (#42 §3).',
  },
  {
    object: 'Math',
    property: 'random',
    message: 'Pure module: IDs arrive as data, never generated here (#42 §3).',
  },
  {
    object: 'Date',
    property: 'now',
    message: 'Pure module: time arrives as data, never read from the clock (#42 §3).',
  },
]

// `new Date(2020, 0, 1)` is a value, `new Date()` is the clock.
const NO_CLOCK_READ = {
  selector: "NewExpression[callee.name='Date'][arguments.length=0]",
  message: 'Pure module: time arrives as data, never read from the clock (#42 §3).',
}

// #42 §7: `src/<module>/testing.ts` is a module's second entry point, and only a test
// file may reach it.
const TEST_FILE_PATTERNS = ['src/**/*.test.ts', 'src/**/*.test.tsx']
const TESTING_IMPORT_PATTERN = {
  group: ['**/testing', '**/testing/*'],
  message: 'src/<module>/testing.ts is importable only from a *.test.ts(x) file (#42 §7).',
}

// #45: the persistence contract suite is Vitest and behaviour only, so it is a module's
// third kind of file — an entry point a test file may import and nothing else may.
const CONTRACT_IMPORT_PATTERN = {
  group: ['**/persistence/contract', '**/persistence/contract/*'],
  message: 'src/persistence/contract is importable only from a *.test.ts(x) file (#45).',
}

// #46 criterion 9: `idb` belongs to the IndexedDB adapter alone. The pure set already bans
// it with React and the state libraries; this is the other half, so that a second module
// cannot open a database of its own.
const IDB_IMPORT_PATTERN = {
  group: ['idb'],
  message: 'Only src/persistence/indexeddb talks to idb (#46).',
}

// One descriptor per immer policy: `edit` builds Edit Transactions on immer patches
// (#20 §4), every other pure module bans it along with React, the state libraries and idb.
// Two descriptors per policy, because the testing ban has to skip test files and a rule
// cannot vary its config per file: the second restates the import bans plus the ban.
function pureDescriptor(moduleNames, { allowImmer }) {
  const bannedImports = allowImmer ? NON_PURE_IMPORTS : [...NON_PURE_IMPORTS, 'immer']
  const pureImportBan = {
    patterns: [{ group: bannedImports, message: 'Pure module: no React, state-library or idb imports (#20 §2).' }],
  }
  const files = pureFiles(moduleNames)
  return [
    {
      files,
      // The IndexedDB adapter lives inside `src/persistence` and is not pure: it imports
      // `idb`, reads `globalThis.indexedDB` and runs in a browser (#46).
      ignores: [...NON_PURE_FILE_PATTERNS, ...ADAPTER_FILES],
      rules: {
        'no-restricted-globals': [
          'error',
          ...DOM_GLOBALS.map((name) => ({
            name,
            message: 'Pure module: no DOM globals (#20 §2).',
          })),
        ],
        'no-restricted-imports': ['error', pureImportBan],
        'no-restricted-properties': ['error', ...NON_DETERMINISTIC_PROPERTIES],
        'no-restricted-syntax': ['error', NO_CLOCK_READ],
      },
    },
    {
      files,
      ignores: [...NON_PURE_FILE_PATTERNS, ...ADAPTER_FILES, ...TEST_FILE_PATTERNS],
      rules: {
        'no-restricted-imports': ['error', { patterns: [...pureImportBan.patterns, TESTING_IMPORT_PATTERN, CONTRACT_IMPORT_PATTERN] }],
      },
    },
  ]
}

// The same testing ban for the files outside the pure set: `ui`, `app`, `platform` and
// the impure legacy folders. The S0 `utils` download helpers are claimed out of the pure
// folder by `legacy-utils-dom` and stay outside both lists.
const testingBanForImpureFiles = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: [
    ...pureFiles(PURE_TARGET_MODULES.map((module) => module.name)),
    ...NON_PURE_FILE_PATTERNS,
    ...TEST_FILE_PATTERNS,
  ],
  rules: {
    'no-restricted-imports': ['error', { patterns: [TESTING_IMPORT_PATTERN, CONTRACT_IMPORT_PATTERN, IDB_IMPORT_PATTERN] }],
  },
}

// The adapter left the pure set, so the test-only import bans are restated for it: the
// contract suite is reachable from its test files and from nothing else (#46).
const adapterDescriptor = {
  files: ADAPTER_FILES,
  ignores: TEST_FILE_PATTERNS,
  rules: {
    'no-restricted-imports': ['error', { patterns: [TESTING_IMPORT_PATTERN, CONTRACT_IMPORT_PATTERN] }],
  },
}

// Inward-only. An empty `allow` is already the default disallow, so those rows drop out.
const elementTypeRules = [
  // The IndexedDB adapter is a browser module that implements the ports of `persistence`:
  // the port declarations, `domain` and `lib` are what it is built from, and no other
  // module may be reached from it (#46).
  { from: [ADAPTER_ELEMENT.type], allow: ['persistence', 'domain', 'lib', ADAPTER_ELEMENT.type] },
  // Type-only exceptions first: a value import of the same target falls through to the
  // module's own row below and is rejected there.
  ...TARGET_MODULES.filter((module) => module.typeOnly).map((module) => ({
    from: [module.name],
    allow: module.typeOnly,
    importKind: 'type',
  })),
  ...TARGET_MODULES.map((module) => ({
    from: [module.name],
    allow: [...module.allow, module.name],
  })),
  ...LEGACY_ELEMENTS.map((element) => ({
    from: [element.name],
    allow: [...element.allow, ...LEGACY_TARGET_MODULES],
  })),
].filter((rule) => rule.allow.length > 0)

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
    plugins: { boundaries, 'import-x': importX },
    settings: {
      'boundaries/elements': ELEMENTS,
      // boundaries resolves imports with the node resolver it ships (eslint-module-utils),
      // which needs the TS extensions to classify local files at all.
      'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'] } },
      // The TypeScript resolver, so `import-x/no-cycle` follows .ts/.tsx imports (#41 §1).
      'import-x/resolver': { typescript: {} },
      // ...and the extension list, or its export graph stops at the default JS ones and
      // never walks a .ts edge.
      'import-x/extensions': ['.ts', '.tsx', '.js', '.jsx'],
    },
    rules: {
      'boundaries/element-types': ['error', { default: 'disallow', rules: elementTypeRules }],
      // Only a target module's index.ts may be imported from outside it; imports inside a
      // module are free (#20 §1). `default: disallow` is what makes it bite: a later
      // disallowing rule overrides an earlier allow, so the only shape that works is one
      // allow rule per group plus a default that rejects anything no rule matched.
      'boundaries/entry-point': [
        'error',
        {
          default: 'disallow',
          message: 'Target modules are imported through src/<module>/index.ts (#20 §2).',
          rules: [
            // `testing.ts` is a module's second entry point (#42 §7); the ban on importing
            // it from anywhere but a test file is a separate descriptor.
            // `contract/index.ts` is `persistence`'s test-only entry point (#45), banned
            // the same way as `testing.ts`.
            { target: TARGET_MODULE_NAMES, allow: ['index.ts', 'testing.ts', 'contract/index.ts'] },
            // Legacy elements and the adapters have no entry point yet (#20 §1): the
            // adapter is reached file-by-file by `app`, legacy code by everything legacy.
            { target: OPEN_ENTRY_ELEMENT_NAMES, allow: ['**'] },
          ],
        },
      ],
      'import-x/no-cycle': ['error', { maxDepth: '∞' }],
    },
  },

  ...pureDescriptor(
    PURE_TARGET_MODULES.filter((module) => !module.immerAllowed).map((module) => module.name),
    { allowImmer: false },
  ),
  ...pureDescriptor(
    PURE_TARGET_MODULES.filter((module) => module.immerAllowed).map((module) => module.name),
    { allowImmer: true },
  ),
  testingBanForImpureFiles,
  adapterDescriptor,
)
