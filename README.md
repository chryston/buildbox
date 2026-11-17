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
