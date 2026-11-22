# Domain schema migrations

`DOMAIN_SCHEMA_VERSION` (`migrate.ts`) says what shape a `Project` has. It is one of three
independent version constants (#20 §12) — the workspace file version and the IndexedDB
`schemaVersion` are unrelated to it.

`MIGRATORS[i]` migrates v(i+1) → v(i+2). `migrateProject` runs the steps in order on a
copy of the data and then validates the result; a version newer than this build is
refused with "saved by a newer BuildBox" before anything is mutated (#14, #20 §5).

## The rule for the issue that adds a version

1. **Adding any field, collection or union variant bumps `DOMAIN_SCHEMA_VERSION` by 1**
   in the release that turns the capability on (#20 §11). A capability that ships dark
   still bumps it, because the data it writes is the thing being added.
2. **Each bump appends exactly one pure migrator** to `MIGRATORS`. Never rewrite an
   existing one, never collapse two into one: the chain is the only path old data has.
3. **Every older fixture stays.** `fixtures/domain/v<N>/…` is permanent compatibility
   evidence; `src/domain/fixtures.test.ts` migrates all of them on every run. Add a new
   golden fixture `fixtures/domain/v<N>/…` for the new shape.
4. **Migrators never read the clock or generate IDs** except through parameters the
   caller passes in (#42 §3). Lint enforces this in the pure modules: no
   `crypto.randomUUID`, `Math.random`, `Date.now` or zero-argument `new Date()`. A
   migrator that needs a new ID takes a `newId` parameter, and the caller that supplies
   it lives outside `domain`.
5. **Unknown fields are refused, not dropped** (#14). A field this build does not know
   is an `unknown-field` problem, which is what forces a newer schema to arrive as a
   version bump rather than as data that gets quietly discarded on the next save.

## What v1 holds

Project metadata and preferences; Floors with an optional Plan Image; cabinet and generic
Item Designs; and the Existing Model's Placed Items — the S4 Local Projects release and
nothing else (#42). Design Options, Building Elements, Rooms, Views, Vertical Extents,
Drawing Layers, comments, non-rectangle footprints and an editable cabinet Item Origin
each arrive with their own capability and their own migrator.

## What v2 holds (#56)

One thing: every Floor gains a `views` collection with exactly one default Plan View.
`migrateV1toV2` invents it — `{ kind: "plan", name: <the Floor's name>, isDefault: true,
showPlanImage: true }` — and takes a `newId` parameter for the view IDs, because of rule 4.
Nothing else moves.

## What v3 holds (#58)

One thing: a generic Item Design's footprint became an **Item Footprint** — either a
`Preset` shape with a position and an orientation, or a `ClosedPath` of lines, arcs and
elliptical arcs. v1 and v2 stored a bare `{ kind: "rectangle", width, depth }` pair, which
could describe nothing else, and the shape was drawn from the Placed Item's translation
rather than from the design.

`migrateV2toV3` restates each rectangle as
`{ kind: "preset", preset: { kind: "rectangle", width, depth }, centre: { x: width / 2,
y: depth / 2 }, orientationDeg: 0 }`. It spends no IDs, reads no clock, and leaves the
geometry it draws exactly where it was: the centre is the old rectangle's own centre in the
design's local frame, so every Placed Item keeps covering the same patch of Floor. A
footprint that is already a v3 shape is carried over untouched, which is what lets a v3 file
pass through the migrator unchanged.

The consequence for validation is the point of the release: a footprint is now validated by
the geometry kernel on import, so an impossible shape — corner radii that overlap, a path
that does not close, a size that is not positive — arrives as the kernel's own sentence
("Corner radii on the top side overlap (1,000 + 1,001 > 2,000 mm)") rather than as a
field-range complaint.

## What v4 holds (#64)

Two things, both additions:

* `preferences.defaultWallHeight` — the height a new Wall gets when the Floor it is drawn on
  says nothing. `2600`, the preset pack's `height.ceiling` entry, which is the number the
  legacy "Typical — measure yours" heights already used.
* `existingModel.walls` and `existingModel.wallJunctions` — the two new collections, empty.

`migrateV3toV4` spends no IDs, reads no clock, and touches nothing else: a Project with no
Walls draws exactly what it drew at v3. The height is written rather than left absent so
that the field is required everywhere after the step, including in the strict validator,
which is the only way a hand-edited or newer-schema file can be caught. A migrator is a
historical record, so the number is a frozen constant in `migrate.ts` rather than a live read
of the pack; `src/domain/migrate.test.ts` pins it to the pack entry it came from.

## What v8 holds (#69, dark)

One thing: `Project.designOptions`, the empty collection of Design Options — each one a name, the
proposed work it adds, and the IDs of the Existing entities it removes. Every entity type also
gained the optional `predecessorIds`, the provenance chain that tells a proposed entity which
Existing one it replaces.

`migrateV7toV8` adds `designOptions: []` and spends no IDs, so a Project with no Options derives,
draws and exports exactly as it did at v7.

**This is the one version the flag decides.** `DOMAIN_SCHEMA_VERSION` is `8` only in a build with
`VITE_FF_RENOVATION=true`, and `migrateV7toV8` is registered only there. Production stays at v7,
which means a preview-written Project arrives in a production build as "saved by a newer BuildBox"
rather than opening with its Design Options silently dropped — the failure mode #20 §5 exists to
prevent. The trade is that a preview database cannot be opened by a flag-off build at all, which is
why the flag is set at build time for the whole preview deployment and never per Project.
