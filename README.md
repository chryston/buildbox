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
- Keep Design Options — named alternatives over one Existing Model — and switch a Plan View between
  the Existing, Proposed, Combined and Demolition Renovation Displays
- Organise a Floor into Drawing Layers, starting with Structure, Services and Furniture, and hide
  what the drawing does not need without losing what it measures
- Choose in the Export dialog which layers a drawing draws and which Design Option a List is counted
  over, and see how many rows that scope hides

Backups made by this version are domain schema v8: an older BuildBox refuses them as "saved by a
newer BuildBox" rather than guessing. Older Backups still open — see `src/domain/MIGRATIONS.md`.

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
