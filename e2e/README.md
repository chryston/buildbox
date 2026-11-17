# e2e

Two Playwright suites, two configs, because they answer different questions.

| Suite | Config | Runs on | Asks |
| --- | --- | --- | --- |
| `e2e/smoke/` | `playwright.config.ts` | host browser, `npm run test:e2e` | does the app still work? |
| `e2e/screenshots/` | `playwright.screenshots.config.ts` | pinned container, `npm run test:screenshots` | does the app still look identical, and how does it compare to the prototypes? |

`e2e/support/` holds what both share: the console-error-guarded `test`/`expect`
(`fixtures.ts`), the legacy persist seeder (`legacyStore.ts`), the paint-stability waits
(`stability.ts`) and the prototype comparison helper (`prototypeCompare.ts`). Nothing in
`e2e/` may import `src/` internals beyond what a user could reach through the DOM — these
are black-box tests.

## Screenshot baselines

`e2e/screenshots/legacy-scenes.spec.ts` holds the three baselines the migration must not
break (#39, #20 §13.15): the cabinet scene, the cabinet scene with a void selected, and the
floor-plan scene with its calibrated image, placed objects in all four rotations, the custom
shape and both annotation shapes. They come from the untouched v3 fixture
(`fixtures/legacy/v3/buildbox-store.json`), so a baseline is a promise about real persisted
data. They are element-level captures of the canvas hosts, not full-page shots, so toolbar
and panel changes in the migration don't invalidate them.

Baselines live in `e2e/screenshots/__snapshots__/`, committed like any other test asset.

### When a baseline may change

Only when a visual change was **intended**. Then the PR says so in its description: which
baseline moved and why the new pixels are the correct ones. A baseline that moves because a
capture raced a paint, or because someone regenerated it on a host browser, is a bug in the
change, not an accepted diff — see the two rules under [regenerating](#regenerating).

Nothing else may move one. In particular, the migration issues (#20) must keep these three
PNGs byte-identical; if one has to change, that is a decision to make visible in review, not
to slip through a re-record.

### Regenerating

```sh
npm run test:screenshots -- --update
```

`npm run test:screenshots` is the only supported way to run this suite: it runs Playwright
inside `mcr.microsoft.com/playwright:v1.62.1-noble` — the image tag is read from the exact
`@playwright/test` pin in `package.json`, so the container's browser and the library can't
drift apart — and it stages the prototype archives the comparison specs request into
`.prototype-cache/` (gitignored) first. Any other arguments pass straight through to
`playwright test`, so `npm run test:screenshots -- --grep "floor plan"` works as expected.

Do not run `playwright test -c playwright.screenshots.config.ts` on your own browser and
commit the result. Baselines are rasterised with the container's font stack and antialiasing;
a host-generated PNG differs by subpixel noise and will fail in CI with a diff nobody can
read. If you only want to look at a capture while iterating, run it with `--update` inside the
container, or run the comparison specs — they write no baselines.

### The `update-snapshots` label

CI runs `CI / screenshots` on every PR and `CI / screenshot-guard` fails any PR that changes
`e2e/screenshots/__snapshots__/**` without the `update-snapshots` label. So:

1. regenerate inside the container,
2. commit the new PNGs with the reason in the PR description,
3. add the `update-snapshots` label — the guard re-runs on label changes and passes.

Removing the label fails the check again, which is what keeps the label on the PR that
actually carries the diff.

### Reading the `screenshots` artifact

`CI / screenshots` uploads `test-results/` as the **screenshots** artifact with
`if: always()`, so it exists for green runs too:

- `test-results/<spec>-<test name>/<name>-diff.png`, `<name>-actual.png`,
  `<name>-expected.png`: the pixel diff, what the container rendered, and the committed
  baseline. A failure with no diff images and a "snapshot does not exist" message means the
  baseline was never committed, not that pixels moved.
- `test-results/prototype-compare/<name>/`: the comparison renders below — `prototype.png`,
  `production.png` when there is a production side, and `side-by-side.png`, the annotated
  composite a reviewer signs off on.

## Prototype comparison

`compareWithPrototype(page, testInfo, …)` renders a prototype at 1440×1000, optionally
renders a production route next to it, and writes a composite with a caption bar naming the
commit and the route. It never calls `toHaveScreenshot`: **prototypes are compared, never
baselined** (#39 §3). They are throwaway artifacts, and pinning their pixels would freeze
designs that are still being argued about.

Prototypes are read from the published commits — never rebuilt — through
`page.route('https://prototype.invalid/**')`, which answers from
`.prototype-cache/<commit>/<path>` with the exact bytes `git archive`/`git show` produced.
`npm run test:screenshots` discovers the requests by scanning `e2e/**/*.ts` for
`{ commit, dir }` / `{ commit, path }` literals and stages them, so a spec can never render a
prototype the runner doesn't know about.

Two modes:

```ts
// static-archive: render the published HTML, drive it into a state, put today's app beside it
await compareWithPrototype(page, testInfo, {
  name: 'library-28-library',
  prototype: { kind: 'static-archive', ...LIBRARY_28, prepare: library },
  production: { route: './' },
})
```

```ts
// reference-png: the prototype published a PNG instead of HTML — use it as-is
await compareWithPrototype(page, testInfo, {
  name: 'odd-shape-30-a-preset',
  prototype: { kind: 'reference-png', commit: 'cadf2d5', path: 'prototype-screenshots/A-preset.png' },
})
```

`e2e/screenshots/prototype-compare.spec.ts` covers every state #28 requires plus one
reference PNG, so both modes are exercised; #30, #31 and #33 add their own states to it.
`e2e/support/prototypes/` holds one module per prototype archive: the source descriptor and
the `prepare` functions that drive the published UI into each state.
