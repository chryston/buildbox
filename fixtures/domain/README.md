# Domain fixtures

Golden domain-schema fixtures (#42 §6). **Never deleted, never edited.** Each
`DOMAIN_SCHEMA_VERSION` adds files under `v<N>/`; older ones stay exactly as they are, so
they remain permanent compatibility evidence — `src/domain/fixtures.test.ts` migrates
every file in this folder on every run, and a future schema version has to keep that
passing.

## Contents

`v1/project-basic.json` is an envelope, `{ "domainSchemaVersion": 1, "project": { … } }`,
whose Project hits every field v1 has:

- **Project** — `meta.address` present, preferences `cm` at precision `1`.
- **Two Floors** — "Floor 1" with a calibrated Plan Image (`image/png`,
  `pixelsPerMm: 0.5`), and "Mezzanine" with an uncalibrated `image/jpeg`
  (`pixelsPerMm: null`).
- **One cabinet Item Design** — editor unit `in`, a tree three splits deep using both
  other axes, a drawer stack with `drawerConfig`, a door accessory, a divider, and a
  pinned node (`locked: true` with `fixedSize`).
- **Three generic Item Designs** — the catalog `bed-king` at 1820 × 1980 with
  `heightIsTypical: true`; a custom chest with `isCustom: true`, `heightIsTypical: true`
  and no `catalogKey`; and one design nothing places, the way a legacy custom template
  arrives.
- **Four Placed Items** — across both Floors, with `rotationDeg` 0, 90 and 270, and one
  `baseElevation: -150` hanging below the Floor Datum.

`v1/reference-project.json` is the same envelope, but generated rather than hand-authored:
`scripts/make-reference-project.ts` builds a Project big enough to time against — 3 Floors,
30 cabinet Item Designs with trees eight splits deep placed along "Floor 1", and 200 generic
Item Designs plus Placed Items on every Floor. `src/edit/apply.bench.ts` measures
`applyIntent` on it, which is why it exists; `src/domain/fixtures.test.ts` migrates it like
any other file here.

## `v2/` — domain schema v2 (#56)

`v2/project-basic.json` and `v2/reference-project.json` are the two v1 files run through
`migrateV1toV2`: the same Project, plus the one default Plan View each Floor comes with —
`{ id, kind: "plan", floorId, name: <the Floor's name>, isDefault: true, showPlanImage: true }`,
with view IDs allocated as `view-0`, `view-1`, … in Floor order. Neither carries `limits`:
migration invents no measurement nobody took.

`v2/reference-project.json` is written by the same script as its v1 twin
(`npx vite-node scripts/make-reference-project.ts` regenerates both together).
`src/domain/remapIds.property.test.ts` and the benchmarks read the v2 file, because it is
the current schema; the v1 files stay untouched as the compatibility evidence they were.

## How it was produced

Hand-authored as a plain object, then written with `lib.canonicalJson` — keys sorted, no
whitespace — followed by one trailing newline. `v1/reference-project.json` is the exception:
it is written by `scripts/make-reference-project.ts`, in the same canonical form, and is
regenerated only by deleting it and running that script — never edited in place. Nothing
regenerates a fixture once it is committed: a schema change adds a `v<N>` file instead.
