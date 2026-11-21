# `v7/` — the Backup this build writes (#67)

`PACKAGE_FORMAT_VERSION` is still `1`: the archive is the same three-entry ZIP with the same
manifest. What changed is the **domain schema** the `project.json` entry carries — v7, where a
Project holds `existingModel.rooms` (#67). As with `v5/` and `v6/`, a new folder rather than a new
package version: `manifest.json` already names a `domainSchemaVersion`, and a v6 reader can be
told to go away by the number inside.

## Contents

`rooms.buildbox` — 199,304 bytes, three entries, no archive comment, every entry
stamped with the fixed 1980-01-01 DOS date:

| Entry | Method | What it is |
| --- | --- | --- |
| `manifest.json` | deflate | `format: "buildbox-project"`, `packageVersion: 1`, **`domainSchemaVersion: 7`**, `projectId: "project-0"`, `exportedAt: "2026-01-01T00:00:00.000Z"`, `buildboxVersion: "0.0.0"`, and the two entries below in archive order with their byte lengths and SHA-256s. No `preview` key: a released build wrote it. |
| `project.json` | deflate | The Project below, as canonical JSON with one trailing newline — byte-identical to `project.json` beside it. |
| `assets/e4a90d35…ae66.png` | stored | The Plan Image — the same bytes `v1/` through `v6/` carry. The name is its own SHA-256. |

The Project is `src/package/testing.ts`'s `roomsFixtureProject()`: `acknowledgementsFixtureProject()`
again — the same two Floors, five Item Designs and four Placed Items as `../v6`, the same two Walls
and the same door and acknowledgement — with two Rooms on `floor-0`:

```json
"existingModel": {
  "rooms": [
    { "id": "room-1", "floorId": "floor-0", "name": "Living",
      "outline": { "kind": "preset", "preset": { "kind": "rectangle", "width": 4000, "depth": 2000 },
                   "centre": { "x": 2000, "y": -1050 }, "orientationDeg": 0,
                   "segmentIds": ["edge-living-1", "edge-living-2", "edge-living-3", "edge-living-4"] },
      "wallFaceRefs": [{ "segmentId": "edge-living-3", "wallId": "wall-1", "side": "left" }] },
    { "id": "room-2", "floorId": "floor-0", "name": "Study",
      "outline": { "kind": "path", "path": { "start": { "x": 100, "y": 50 }, "segments": [ … four lines … ] },
                   "segmentIds": ["edge-study-1", "edge-study-2", "edge-study-3", "edge-study-4"] },
      "wallFaceRefs": [{ "segmentId": "edge-study-1", "wallId": "wall-1", "side": "right" }] }
  ]
}
```

A Room Outline carries **one stable Edge ID per Edge**, in Edge order — that list, not a position,
is what a wall-face reference names, so inserting an Edge or filleting a corner cannot quietly move
a reference onto a different side of the Room. `W-1` runs from `(0, 0)` to `(4000, 0)` 100 mm thick
and justified to its centre, so its left face is `y = −50` and its right face `y = +50`: `Living`
stands on the left face with its Edge 3, `Study` on the right face with its Edge 1, and the two
outlines share no area. One Room is a Rectangle and one a Custom Path, which is the pair the step
has to keep reading. `../v6` holds `"rooms"` nowhere at all, which is the whole step in one
comparison.

## How it was produced

`encodeProject(roomsFixtureProject(), assetSource, { exportedAt: "2026-01-01T00:00:00.000Z",
buildboxVersion: "0.0.0", preview: false })`, with `project.json` written beside it from
`lib.canonicalJson` plus one trailing newline, and the PNG copied from `../v6/assets/`.

`src/package/fixtures.test.ts` proves five things about this folder on every run: staging it
needs no migration, this build re-encodes it byte for byte, `project.json` is the canonical
record and nothing else, the asset survives, and both references still name the face they were
written against. `../v1` through `../v6` stay exactly as they are — they are what a v1 through v6
BuildBox wrote, and staging them now runs the migration that follows their version.
