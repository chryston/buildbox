# BuildBox

BuildBox is an interactive 2D cabinet design configurator for laying out cabinets, adjusting panel sizes, and exporting production-ready output.

## Tech stack

- React 19
- Vite
- TypeScript
- Tailwind CSS
- Zustand with immer and zundo

## Features

- Partition a cabinet into sections
- Add shelves and vertical dividers
- Drag to resize openings
- Apply materials from a palette
- Export a cut list
- Export SVG drawings
- Undo and redo edits

## Development

Node 24 or newer is required (`engines.node` is `>=24`).

```bash
npm install
npm run dev
```

## Checks

```bash
npm run typecheck
npm run lint
npm test              # single run; use npm run test:watch while working
npm run build         # also checks the app-shell size budget
```

CI runs all of these on every pull request and on `main`; GitHub Pages deploys only
after a green CI run on `main`.

## Build

```bash
npm run build
```

The build ends with two checks. `scripts/check-bundle-strings.mjs` fails if `dist/` still
contains a string the removed workspace exports or the `projects_v2` flag would have written.
`scripts/check-size-budget.mjs` gates the **app shell**: the JS and CSS `dist/index.html` loads
eagerly. Since #53 the editor is a dynamic import, so the shell is React plus the Project
Library and the session core, and the editor arrives in its own chunk when a Project opens. The
script prints the gzip total of every app chunk beside the gated number, so the whole-app cost
stays visible without becoming a second budget; raising `size-budget.json` remains a decision,
never a side effect of a build.
