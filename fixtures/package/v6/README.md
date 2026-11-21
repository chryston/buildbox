# `v6/` — the Backup this build writes (#66)

`PACKAGE_FORMAT_VERSION` is still `1`: the archive is the same three-entry ZIP with the same
manifest. What changed is the **domain schema** the `project.json` entry carries — v6, where a
Project holds `warningAcknowledgements` (#66). As with `v5/`, a new folder rather than a new
package version: `manifest.json` already names a `domainSchemaVersion`, and a v5 reader can be
told to go away by the number inside.

## Contents

`acknowledgements.buildbox` — 199,133 bytes, three entries, no archive comment, every entry
stamped with the fixed 1980-01-01 DOS date:

| Entry | Method | What it is |
| --- | --- | --- |
| `manifest.json` | deflate | `format: "buildbox-project"`, `packageVersion: 1`, **`domainSchemaVersion: 6`**, `projectId: "project-0"`, `exportedAt: "2026-01-01T00:00:00.000Z"`, `buildboxVersion: "0.0.0"`, and the two entries below in archive order with their byte lengths and SHA-256s. No `preview` key: a released build wrote it. |
| `project.json` | deflate | The Project below, as canonical JSON with one trailing newline — byte-identical to `project.json` beside it. |
| `assets/e4a90d35…ae66.png` | stored | The Plan Image — the same bytes `v1/` through `v5/` carry. The name is its own SHA-256. |

The Project is `src/package/testing.ts`'s `acknowledgementsFixtureProject()`: `openingsFixtureProject()`
again — the same two Floors, five Item Designs and four Placed Items as `../v5`, the same Wall and
the same door — with a second Wall crossing the first and one acknowledgement of the warning they
make together:

```json
"existingModel": {
  "walls": [ { "id": "wall-1", … }, { "id": "wall-2", "ref": "W-2",
               "line": { "start": { "x": 2000, "y": -500 }, "end": { "x": 2000, "y": 500 } } } ],
  "openings": [ … ]
},
"warningAcknowledgements": [
  { "id": "acknowledgement-1", "warningType": "wall_crossing",
    "subjectIds": ["wall-1", "wall-2"], "designOptionId": null,
    "signature": "8db57272e5b2adb2",
    "note": "A flue passes through here; the crossing is intended.",
    "acknowledgedAt": "2026-01-01T00:00:00.000Z" }
]
```

An acknowledgement is addressed by `(warningType, subjectIds, designOptionId)`, never by a key
parsed back into its parts — an Entity ID may contain a comma (#42 §3). The `signature` is the
one this BuildBox computes for that crossing, **written down rather than recomputed**: a golden
file derived from the live engine on every run would certify anything the engine started to
produce, whereas a literal is what makes the day the signature algorithm changes show up as a
reopened warning rather than as silence. `../v5` holds `"warningAcknowledgements"` nowhere at
all, which is the whole step in one comparison.

## How it was produced

`encodeProject(acknowledgementsFixtureProject(), assetSource, { exportedAt: "2026-01-01T00:00:00.000Z",
buildboxVersion: "0.0.0", preview: false })`, with `project.json` written beside it from
`lib.canonicalJson` plus one trailing newline, and the PNG copied from `../v5/assets/`.

`src/package/fixtures.test.ts` proves four things about this folder on every run: staging it
needs no migration, this build re-encodes it byte for byte, `project.json` is the canonical
record and nothing else, and the acknowledgement survives intact. `../v1` through `../v5` stay
exactly as they are — they are what a v1 through v5 BuildBox wrote, and staging them now runs
the migration that follows their version.
