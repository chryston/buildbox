# `v5/` — the Backup this build writes (#65)

`PACKAGE_FORMAT_VERSION` is still `1`: the archive is the same three-entry ZIP with the same
manifest. What changed is the **domain schema** the `project.json` entry carries — v5, where an
Existing Model holds an `openings` collection beside its Walls (#65). As with `v4/`, a new
folder rather than a new package version: `manifest.json` already names a `domainSchemaVersion`,
and a v4 reader can be told to go away by the number inside.

## Contents

`openings.buildbox` — 198,955 bytes, three entries, no archive comment, every entry stamped
with the fixed 1980-01-01 DOS date:

| Entry | Method | What it is |
| --- | --- | --- |
| `manifest.json` | deflate | `format: "buildbox-project"`, `packageVersion: 1`, **`domainSchemaVersion: 5`**, `projectId: "project-0"`, `exportedAt: "2026-01-01T00:00:00.000Z"`, `buildboxVersion: "0.0.0"`, and the two entries below in archive order with their byte lengths and SHA-256s. No `preview` key: a released build wrote it. |
| `project.json` | deflate | The Project below, as canonical JSON with one trailing newline — byte-identical to `project.json` beside it. |
| `assets/e4a90d35…ae66.png` | stored | The Plan Image — the same bytes `v1/` through `v4/` carry. The name is its own SHA-256. |

The Project is `src/package/testing.ts`'s `openingsFixtureProject()`: `fixtureProject()` again —
the same two Floors, two cabinet Item Designs, three generic Item Designs and four Placed Items
as `../v4` — with one Wall and one door cut into it:

```json
"existingModel": {
  "placedItems": [ … ],
  "wallJunctions": [],
  "walls": [ { "id": "wall-1", "ref": "W-1", "floorId": "floor-0", … } ],
  "openings": [ { "id": "opening-1", "hostWallId": "wall-1", "kind": "door",
                  "label": "Door 1", "start": 1200, "width": 900,
                  "sill": 0, "head": 2100, "swing": "left", "hingeSide": "start" } ]
}
```

An Opening is an absence in exactly one Wall, so the fixture carries its host rather than a
position of its own: `start` is 1200 mm along `W-1`'s reference line and `width` is the chord
between the jambs. `../v4` holds `"openings"` nowhere at all, which is the whole step in one
comparison.

## How it was produced

`encodeProject(openingsFixtureProject(), assetSource, { exportedAt: "2026-01-01T00:00:00.000Z",
buildboxVersion: "0.0.0", preview: false })`, with `project.json` written beside it from
`lib.canonicalJson` plus one trailing newline, and the PNG copied from `../v4/assets/`.

`src/package/fixtures.test.ts` proves three things about this folder on every run: staging it
needs no migration, this build re-encodes it byte for byte, and `project.json` is the canonical
record and nothing else. `../v1` through `../v4` stay exactly as they are — they are what a v1
through v4 BuildBox wrote, and staging them now runs the migration that follows their version.
