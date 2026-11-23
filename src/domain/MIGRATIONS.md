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

## What v8 holds (#69, #70, #71, dark)

Three things, all additions:

* `Project.designOptions`, the empty collection of Design Options — each one a name, the
  proposed work it adds, and the IDs of the Existing entities it removes. Every entity type also
  gained the optional `predecessorIds`, the provenance chain that tells a proposed entity which
  Existing one it replaces.
* `designOptionId` and `renovationDisplay` on every saved Plan View (#70 §1) — the Design Option
  the view looks through and the Renovation Display it draws.
* `Project.drawingLayers`, the ordered list of Drawing Layers (#71 §1), plus the optional
  `drawingLayerId` on Walls, Openings, Rooms and Placed Items, and four more settings on every
  saved view (#71 §3): `layerSettings`, `layerOrder`, `activeLayerId` and `snapToHiddenContent`.

`migrateV7toV8` adds `designOptions: []` and writes `designOptionId: null` /
`renovationDisplay: "existing"` on every view, and spends no IDs, so a Project with no Walls and no
Options derives, draws and exports exactly as it did at v7: no Options means the Existing Model is
the whole model, and `null` / `existing` is the way every view already looked at it.

The layer half of the step is the one part that spends IDs — three, for `Structure`, `Services` and
`Furniture`, from the allocator the chain was handed (#42 §3) — and the one part that touches
existing records: every Wall, Opening and Room in the Existing Model and in every Design Option's
proposed work is filed on `Structure`, every Placed Item on `Furniture`, by layer **name**, so a
Project whose user renamed `Structure` keeps its Walls on the layer they were drawn on instead of
gaining a second one. Each view is written with no overrides, no order of its own, `Structure`
Active and no snapping to hidden content — every one of which is how the view already behaved. A
Project that already carries a `drawingLayers` array keeps it exactly as it is, **empty included**:
an empty array is a Project whose content is all Unlayered, and refilling it would invent layers
somebody deleted.

`drawingLayers` is required in a flagged build and absent from the type's reach in a flag-off one;
`drawingLayerId` and the four view settings are optional in TypeScript and validated when present,
never defaulted, so a file written before the capability stays readable with the flag off and the
bytes a flag-off build writes are unchanged. The strict validator refuses a `drawingLayerId` that
names no layer, a `layerSettings` key that names neither a layer nor `unlayered`, a
`layerOrder` that repeats a layer, omits one, or leaves out `unlayered`, and an `activeLayerId`
that names nothing — and a layer whose own ID is the reserved `unlayered`, which would otherwise
let a layer shadow the Unlayered row's settings.

**Layers ride this version rather than taking a ninth one.** #71 ships behind the same flag as #69
and #70, and a preview version is allowed to carry three model changes; #73 turns the flag on,
splits the golden evidence per issue, and writes the release note. The consequence, stated plainly:
a Project written by a preview build before #71 and after #69 still validates and still opens,
because everything #71 adds is either defaulted by the step or optional.

**This version was once decided by a flag; it is not any more.** Since #73 `DOMAIN_SCHEMA_VERSION`
is `8` in every build and `migrateV7toV8` is registered unconditionally, so a v1–v7 Backup stages
into a Project that carries its Design Options, Renovation Displays and Drawing Layers. The
consequence for a reader is the ordinary one for a schema step: a Backup written by this version
opens in no older build, which answers "saved by a newer BuildBox" — the failure mode #20 §5 exists
to name. Nothing about the step itself changed when the flag went away.
