# Package fixtures

Golden `.buildbox` fixtures (#44). **Never deleted, never edited.** Each
`PACKAGE_FORMAT_VERSION` adds files under `v<N>/`; older ones stay exactly as they are, so
they remain permanent compatibility evidence — `src/package/fixtures.test.ts` stages every
file in this folder on every run, and a future package version has to keep that passing.
Only the folder holding the version this build writes is re-encoded byte for byte; the older
ones are read and migrated, which is the half that matters to a user with an old Backup.
See `v4/README.md` for the current one (#64).

## Contents

`v1/reference.buildbox` is a real Backup — 198,705 bytes, three entries, no archive
comment, every entry stamped with the fixed 1980-01-01 DOS date:

| Entry | Method | What it is |
| --- | --- | --- |
| `manifest.json` | deflate | `format: "buildbox-project"`, `packageVersion: 1`, `domainSchemaVersion: 1`, `projectId: "project-0"`, `exportedAt: "2026-01-01T00:00:00.000Z"`, `buildboxVersion: "0.0.0"`, and the two entries below in archive order with their byte lengths and SHA-256s. No `preview` key: a released build wrote it. |
| `project.json` | deflate | The Project below, as canonical JSON with one trailing newline — byte-identical to `project.json` beside it. |
| `assets/e4a90d35…ae66.png` | stored | The Plan Image, 196,992 bytes. The name is its own SHA-256. |

The Project is the same shape the domain fixture of #42 exercises:

- **Project** — "Maple Street Kitchen", address present, preferences `mm` at precision `0`.
- **Two Floors** — "Floor 1" with a calibrated Plan Image (`image/png`, 256 × 256,
  `pixelsPerMm: 0.5`), and "Mezzanine" with none.
- **Two cabinet Item Designs** — a 600 × 850 mm base cabinet with an undermount drawer and a
  locked hanging bay, and a tall larder split vertically with a side-mount drawer, a divider
  and a locked hanging bay.
- **Three generic Item Designs** — the catalog `bed-king` at 1820 × 1980 with
  `heightIsTypical: true`; a custom `isCustom: true` pendant with no `catalogKey`; and one
  design nothing places, the way a legacy custom template arrives.
- **Four Placed Items** — across both Floors, rotations 0, 90, 180 and 270, one at
  `baseElevation: 2800`.

## How it was produced

`project.json` was hand-authored as a plain object and written with `lib.canonicalJson` —
keys sorted, no whitespace — followed by one trailing newline. The PNG was generated
procedurally as 256 × 256 pixels of incompressible noise, so the fixture needs no binary
input to reproduce. `encodeProject` then wrote the archive with
`{ exportedAt: "2026-01-01T00:00:00.000Z", buildboxVersion: "0.0.0", preview: false }`.

Nothing regenerates a fixture once it is committed: a package-format change bumps
`PACKAGE_FORMAT_VERSION`, adds a `v<N>` folder, and gets a release note (#20 §12).
