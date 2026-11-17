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

## How it was produced

Hand-authored as a plain object, then written with `lib.canonicalJson` — keys sorted, no
whitespace — followed by one trailing newline. Nothing regenerates a fixture once it is
committed: a schema change adds a `v<N>` file instead.
