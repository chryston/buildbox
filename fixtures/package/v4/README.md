# `v4/` — the Backup this build writes (#64)

`PACKAGE_FORMAT_VERSION` is still `1`: the archive is the same three-entry ZIP with the same
manifest. What changed is the **domain schema** the `project.json` entry carries — v4, where a
Project holds `walls` and `wallJunctions` and `preferences` carries a `defaultWallHeight`
(#64). As with `v3/`, a new folder rather than a new package version: `manifest.json` already
names a `domainSchemaVersion`, and a v3 reader can be told to go away by the number inside.

## Contents

`reference.buildbox` — 198,818 bytes, three entries, no archive comment, every entry stamped
with the fixed 1980-01-01 DOS date:

| Entry | Method | What it is |
| --- | --- | --- |
| `manifest.json` | deflate | `format: "buildbox-project"`, `packageVersion: 1`, **`domainSchemaVersion: 4`**, `projectId: "project-0"`, `exportedAt: "2026-01-01T00:00:00.000Z"`, `buildboxVersion: "0.0.0"`, and the two entries below in archive order with their byte lengths and SHA-256s. No `preview` key: a released build wrote it. |
| `project.json` | deflate | The Project below, as canonical JSON with one trailing newline — byte-identical to `project.json` beside it. |
| `assets/e4a90d35…ae66.png` | stored | The Plan Image, 196,992 bytes — the same bytes `v1/`, `v2/` and `v3/` carry. The name is its own SHA-256. |

The Project is `src/package/testing.ts`'s `fixtureProject()` again — the same two Floors, two
cabinet Item Designs, three generic Item Designs and four Placed Items as `../v3` — with the
v4 fields added and nothing else moved:

```json
"preferences": { …, "defaultWallHeight": 2600 },
"existingModel": { "placedItems": [ … ], "wallJunctions": [], "walls": [] }
```

A Project with no Walls yet is a complete v4 Project: the two collections exist and are empty,
and the default height is stored rather than implied, so the strict validator can refuse a
file that lost it. `2600` is the preset pack's `height.ceiling` entry.

## How it was produced

`encodeProject(fixtureProject(), assetSource, { exportedAt: "2026-01-01T00:00:00.000Z",
buildboxVersion: "0.0.0", preview: false })`, with `project.json` written beside it from
`lib.canonicalJson` plus one trailing newline, and the PNG copied from `../v2/assets/`.

`src/package/fixtures.test.ts` proves three things about this folder on every run: staging it
needs no migration, this build re-encodes it byte for byte, and `project.json` is the canonical
record and nothing else. `../v1`, `../v2` and `../v3` stay exactly as they are — they are what
a v1, v2 and v3 BuildBox wrote, and staging them now runs the migration #58 or #64 added.
