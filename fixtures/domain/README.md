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
(`npx vite-node scripts/make-reference-project.ts` regenerates all three together).

## `v3/` — domain schema v3 (#58)

`v3/project-basic.json` and `v3/reference-project.json` are the two v2 files run through
`migrateV2toV3`: the same Project, with every generic Item Design's footprint restated as an
Item Footprint — `{ kind: "preset", preset: { kind: "rectangle", width, depth },
centre: { x: width / 2, y: depth / 2 }, orientationDeg: 0 }`. The step spends no IDs and
moves no geometry, which is what `src/domain/remapIds.property.test.ts` leans on: it walks
the v3 reference and asserts the same pinned entity-ID count, 16,597, that v2 had.

`src/domain/remapIds.property.test.ts` reads the v3 file, because it is the current schema
and a copy is taken of the current schema. The benchmarks read the v1 file and migrate up on
load, so they measure the migrator as part of the path a real open takes. The v1 and v2 files
stay untouched as the compatibility evidence they were.

## `v4/` — domain schema v4 (#64)

`v4/project-basic.json` and `v4/reference-project.json` are the two v3 files run through
`migrateV3toV4`: the same Project, plus `preferences.defaultWallHeight: 2600` and the two
empty Wall collections. The step spends no IDs and moves no geometry, so the pinned
entity-ID count is still 16,597 and `src/domain/remapIds.property.test.ts` now reads the v4
file as the current schema.

`v4/walls.json` is the new golden for the Wall shape itself: three Walls on one Floor — two
straight ones meeting in an L and one arc — joined by two Junctions, one per meeting point.
It is the file that proves a Project carrying Walls round-trips through the strict validator
and the canonical writer.

## `v6/` — domain schema v6 (#66)

`v6/acknowledgements.json` is `fixtures/package/v6/project.json` wrapped in the same envelope
the other files use. The step adds one Project field, `warningAcknowledgements`, and this is
the file that carries a non-empty one: a crossing of two Walls on `floor-0` with the decision
the user made about it, its note, and the signature the decision was made against.

The signature is written down rather than recomputed. `src/domain/fixtures.test.ts` reads every
file on disk, so this one is what proves a stored acknowledgement survives the strict validator,
the canonical writer and a round trip through `migrateProject` at the current schema — and that
the day the signature algorithm moves, an old decision is read unchanged instead of dropped.

## `v8/` — domain schema v8 (#69, dark)

`v8/renovation.json` is the Project `scripts/make-renovation-36-seed.ts` draws — the same Project
`fixtures/e2e/preview-seed/renovation-36.json` carries, byte for byte — wrapped in the envelope the
other files use. The step adds one Project field, `designOptions`, and this is the file that
carries a non-empty pair of them: `Option A` and `Option B`, each proposing nothing, beside six
Walls, three Openings, two Rooms and one Placed Item.

v8 is the current schema. `DOMAIN_SCHEMA_VERSION` is 8 in every build since #73 turned the
renovation model on, so `src/domain/fixtures.test.ts` reads this folder to the end and holds this
file as the version's golden.

`v8/renovation-views.json` is the same Project with the renovation work in it, drawn by
`scripts/make-renovation-views-seed.ts` through the Intents the app dispatches, and carried by
`fixtures/e2e/preview-seed/renovation-views.json`. `Option A · Open kitchen` demolishes W-2, replaces
`Base 600 #1` with `Base 600 #1′` and adds a new Island; `Option B · Widened opening` replaces W-2
with `W-2′` on W-2's own footprint; and the Floor carries the four saved views the Renovation
Displays are named by. The Island is the one record in the file no Intent drew — no shipped Intent
places new work into an Option — so the script writes it as a domain record and the validator is what
proves it is a legal one. It is the scene `#70`'s Displays, cycle and screenshots stand on, and the
one the empty pair of Options above is the *before* state of.

## How it was produced

Hand-authored as a plain object, then written with `lib.canonicalJson` — keys sorted, no
whitespace — followed by one trailing newline. `v1/reference-project.json` is the exception:
it is written by `scripts/make-reference-project.ts`, in the same canonical form, and is
regenerated only by deleting it and running that script — never edited in place. Nothing
regenerates a fixture once it is committed: a schema change adds a `v<N>` file instead.
