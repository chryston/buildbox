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

## `v8/` — domain schema v8 (#69, #70, #71)

`v8/renovation.json` is the Project `scripts/make-renovation-36-seed.ts` draws — the same Project
`fixtures/e2e/preview-seed/renovation-36.json` carries, byte for byte — wrapped in the envelope the
other files use. The step adds one Project field, `designOptions`, and this is the file that
carries a non-empty pair of them: `Option A` and `Option B`, each proposing nothing, beside six
Walls, three Openings, two Rooms and one Placed Item.

v8 was the current schema from #69 to #73. `src/domain/fixtures.test.ts` still reads this folder to
the end, so every file in it is proof that the chain reads a Project saved before this build existed.

`v8/renovation-views.json` is the same Project with the renovation work in it, drawn by
`scripts/make-renovation-views-seed.ts` through the Intents the app dispatches, and carried by
`fixtures/e2e/preview-seed/renovation-views.json`. `Option A · Open kitchen` demolishes W-2, replaces
`Base 600 #1` with `Base 600 #1′` and adds a new Island; `Option B · Widened opening` replaces W-2
with `W-2′` on W-2's own footprint; and the Floor carries the four saved views the Renovation
Displays are named by. The Island is the one record in the file no Intent drew — no shipped Intent
places new work into an Option — so the script writes it as a domain record and the validator is what
proves it is a legal one. It is the scene `#70`'s Displays, cycle and screenshots stand on, and the
one the empty pair of Options above is the *before* state of.

## `v9/` and `v10/` — the carried-forward goldens (#74, #75)

Neither folder holds a new scene. `scripts/make-v9-fixtures.ts` and `scripts/make-v10-fixtures.ts`
read each file of the schema below it through `migrateProject` and write it out at the new schema, so
the only difference a carry-forward makes is the field the step adds: the Plan View Range on every
Plan View for v9, and the empty `elevationViews` list for v10 — an Elevation View is always a view a
person made, so no carry-forward invents one. `v10/` is what `DOMAIN_SCHEMA_VERSION` is 10 names as
current, and `v9/plan-range-scene.json`, `v9/renovation.json` and their neighbours stay committed as
the evidence that a Project saved at the ninth schema still opens.

## `v11/` and `v12/` — the carried-forward goldens, and the first Beam (#76, #77)

`v11/` holds no new scene: `scripts/make-v11-fixtures.ts` reads each file of `v10/` through
`migrateProject` and writes it at the eleventh schema, so the only difference is the
`clearanceEnvelope: null` the step writes on every Item Design — a Clearance Envelope is always one
a person drew or measured, so no carry-forward invents a shape.

`v12/` carries the same scenes forward again, and adds one file the earlier folders have no
counterpart to: `v12/beams.json`, written by `scripts/make-v12-fixtures.ts`. It is the renovation
scene with a Beam the Existing Model holds — 3 000 mm along the Kitchen, 200 mm wide on its centre
line, 300 mm deep with its Underside at 2300 mm — and a second Beam `Option A` proposes in its place,
carrying `predecessorIds` and the demolition that makes that predecessor honest. It is the first
golden whose Project holds a Beam, and the one `#77`'s warnings, tables and screenshots are judged
against. `v11/` stays committed as the evidence that a Project saved at the eleventh schema still
opens, and `v12/` is what `DOMAIN_SCHEMA_VERSION` is 12 names as current.

`v12/beams-scene.json`, written by `scripts/make-beams-seed.ts`, is the same Floor with a second
Beam across it and the `Kitchen section` Elevation View stood on a line looking at the first — the
scene `e2e/screenshots/beams.spec.ts` photographs and `e2e/smoke/beams.spec.ts` drives. The script
writes two browser seeds from it: `e2e/preview-seed/beams.json` as it stands, and
`e2e/preview-seed/beams-plain.json` with the Design Options taken out, which is the one the smoke
spec uses so each of the Beam's own gestures commits as it always did rather than stopping at the
locked-baseline review (#70 §7c) that `existingDisplay` tests for every kind.

## `v13/` — the carried-forward goldens, and the first Skirting (#78)

`v13/` holds no new scene: `scripts/make-v13-fixtures.ts` reads each file of `v12/` through
`migrateProject` and writes it at the thirteenth schema, so the only difference a carry-forward makes
is the empty `skirting` collection the step writes on both containers — a Skirting is always one a
person drew against a Wall, so no carry-forward invents one.

It adds one file the earlier folders have no counterpart to: `v13/skirting.json`. It is the
renovation scene with a Skirting the Existing Model holds — drawn against the scene's first Wall, on
its left face, over the whole of that Wall, 100 mm tall and 15 mm thick off the Floor Datum — and a
second Skirting `Option A` proposes against the same Wall on its right face, carrying
`predecessorIds` and the demolition that makes that predecessor honest. It stores no outline: the
body, the gaps and the lengths are derived from the Wall's tidied face. It is the first golden whose
Project holds a Skirting, and the one `#78`'s derive, warnings, tables and screenshots are judged
against. `v12/` stays committed as the evidence that a Project saved at the twelfth schema still
opens, and `v13/` is what `DOMAIN_SCHEMA_VERSION` is 13 names as current.

`v13/skirting-scene.json`, written by `scripts/make-skirting-seed.ts`, is the same Floor with a second
strip on the far Wall and the `Kitchen section` Elevation View stood on a line looking at the first —
the scene `e2e/screenshots/skirting.spec.ts` photographs and `e2e/smoke/skirting.spec.ts` drives. The
script writes two browser seeds from it: `e2e/preview-seed/skirting.json` as it stands, and
`e2e/preview-seed/skirting-plain.json` with the Design Options taken out, which is the one the smoke
spec uses so each of the Skirting's own gestures commits as it always did rather than stopping at the
locked-baseline review (#70 §7c) that `existingDisplay` tests for every kind.

## `v14/` — the carried-forward goldens, and the first Service (#79)

`v14/` holds no new scene: `scripts/make-v14-fixtures.ts` reads each file of `v13/` through
`migrateProject` and writes it at the fourteenth schema, so the only difference a carry-forward makes
is the empty `services` collection the step writes on both containers — a Service is always one a
person documented, and no legacy service data exists, so no carry-forward invents one.

It adds one file the earlier folders have no counterpart to: `v14/services.json`. It is the renovation
scene with four Services the Existing Model holds — a round Water Run at Ø50 on a 2 200 mm centreline,
a rectangular Air-con Run at 80 × 60 on a 2 500 mm centreline, a Drain Riser at Ø100 from 0 to 2 600,
and an Electrical Run at a −100 mm centreline, so −150 to −50, below the Floor Datum — and a fifth Run
Design Option `Option A` invents for itself, carrying the empty `predecessorIds` that says it came out
of nothing. None of them stores a Bottom, a Centre or a Top: those are arithmetic on the centreline and
the section, and these bytes are what proves a record that remembered one cannot round-trip. It is the
first golden whose Project holds a Service, and the one `#79`'s derive, warnings, tables and
screenshots are judged against. `v13/` stays committed as the evidence that a Project saved at the
thirteenth schema still opens, and `v14/` is what `DOMAIN_SCHEMA_VERSION` is 14 names as current.

## `v15/` — the carried-forward goldens, and the first Comment (#80)

`v15/` holds no new scene: `scripts/make-v15-fixtures.ts` reads each file of `v14/` through
`migrateProject` and writes it at the fifteenth schema, so the only difference a carry-forward makes is
the empty `comments` list and the zero `commentReferenceCounter` the step writes on the Project — a
Comment is always one a person typed, and no legacy notes exist, so no carry-forward invents one.

It adds one file the earlier folders have no counterpart to: `v15/comments.json`. It is the renovation
scene with one Comment of every Anchor kind — a Project note at `high`, a Floor note, a note about
Design Option `Option A`, a note about a cabinet's Design rather than one placement of it, a note on
one Wall, a note on that Wall's `leftFace` at `t` 0.5, a note on one space inside a cabinet's own tree,
and a Floor Point note scoped to `Option A` — plus a ninth that has been Resolved and keeps the key and
the message of the Warning it was written from. Every target those Anchors name is read out of the
scene rather than written down, so the golden cannot point at a Wall or a space the record does not
hold, which is the one thing a Comment golden has to keep true: an unresolved Anchor is refused on
import and the whole file would stop loading. Its counter is 9, equal to the highest reference in use,
because the counter is the highest number handed out and the next Comment takes one more. It is the
first golden whose Project holds a Comment, and the one `#80`'s derive, panel, package and screenshots
are judged against. `v14/` stays committed as the evidence that a Project saved at the fourteenth
schema still opens, and `v15/` is what `DOMAIN_SCHEMA_VERSION` is 15 names as current.

## How it was produced

Hand-authored as a plain object, then written with `lib.canonicalJson` — keys sorted, no
whitespace — followed by one trailing newline. `v1/reference-project.json` is the exception:
it is written by `scripts/make-reference-project.ts`, in the same canonical form, and is
regenerated only by deleting it and running that script — never edited in place. Nothing
regenerates a fixture once it is committed: a schema change adds a `v<N>` file instead.
