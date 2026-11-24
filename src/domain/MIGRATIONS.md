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

## What v8 holds (#69, #70, #71)

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

`drawingLayers` is required by the type; `drawingLayerId` and the four view settings are optional
and validated when present, never defaulted, so a file written before the capability stays readable
once the step has run. The strict validator refuses a `drawingLayerId` that
names no layer, a `layerSettings` key that names neither a layer nor `unlayered`, a
`layerOrder` that repeats a layer, omits one, or leaves out `unlayered`, and an `activeLayerId`
that names nothing — and a layer whose own ID is the reserved `unlayered`, which would otherwise
let a layer shadow the Unlayered row's settings.

**Layers rode this version rather than taking a ninth one.** #71 arrived while #69 and #70 were
still landing, and one version carrying three model changes is what a preview is for; #73 shipped
them, split the golden evidence per issue, and wrote the release note below. The consequence, stated
plainly: a Project written by a preview build before #71 and after #69 still validates and still
opens, because everything #71 adds is either defaulted by the step or optional.

## What v9 holds (#74)

One thing, an addition to every saved Plan View:

* `planViewRange`, the closed vertical interval `[lowerMm, upperMm]` in millimetres above the Floor
  Datum that the view draws between — its **Vertical Range** (#74 §1). Both ends are required and
  `lowerMm` is strictly below `upperMm`: a range is never missing and never unbounded, because a view
  whose cut nobody can predict is a view whose drawing nobody can predict either.

`migrateV8toV9` gives every existing view the range its own Floor already declares, and spends no
IDs, reads no clock and touches no entity: the lower end is the Floor's `limits.lowerMm` and the
upper end its `limits.upperMm`, and a Floor that declares only one of them, or neither, supplies 0
below and 2 600 mm above — the whole storey, which is what every view has always shown. So a
migrated Project draws the way it did: content standing between the Floor's own limits is In range
and is styled exactly as before, and what the new styling now marks — a wall cabinet over the ceiling
line, a sump under the Datum — is the content the feature exists to distinguish.

Three edge cases, all of them the same fallback:

* A view that already carries a `planViewRange` is carried over untouched, so the step is idempotent
  and a v9 file comes back as the same object it arrived as.
* A Floor whose limits do not rise — `lowerMm` at or above `upperMm`, which the validator allows as
  equal — cannot give a range, because a range must rise. Such a Floor gives 0–2 600 rather than a
  view the validator would reject.
* A view whose `floorId` names no Floor is the same case seen from the other side, and gets the same
  0–2 600. This is a broken Project either way; the step's job is to hand the validator something it
  can complain about usefully rather than to invent a storey.

The rule lives in `defaultPlanViewRange` (`domain/planViewRange.ts`) because the migrator and the
"new Plan View" handler need exactly it, and a second copy of a default is a second rule. The strict
validator refuses a view with no `planViewRange`, a limit that is not a finite number, and a range
whose lower end is not below its upper one. Nothing else in the model changed: a Placed Item still
stores no height of its own, because its Item Design has it, and the classification the range drives
is derived on the way to the canvas and never written down.

`scripts/make-v9-fixtures.ts` writes the v9 golden domain fixtures by reading each committed v8
fixture through this step — which is what a real upgrade does — and `scripts/make-v9-package-fixture.ts`
writes the committed v9 Backup `fixtures/package/v9/plan-range.buildbox` that
`src/package/fixtures.test.ts` reads, re-encodes byte for byte and refuses with a chain that stops at
v8.

**A Backup made by this version cannot be opened by an older one.** It is domain schema v9, and a
build that stops at v8 has no ninth step to read it with, so it answers **"saved by a newer
BuildBox"** and writes nothing (#20 §5). Old Backups are unaffected: v1 through v8 still open, and
the step that runs on the way in adds one pair of numbers per view and changes no measurement, no
entity and no existing value.

## What v10 holds (#75)

One thing, an addition to the Project itself:

* `elevationViews`, the saved **Elevation Views** of the Project (#75 §1) — each one a view line, the
  side of it it looks from and how far it looks, plus the same Design Option, Renovation Display and
  layer settings every saved view carries.

`migrateV9toV10` writes the empty list and nothing else. It reads no clock, mints no ID and touches no
entity, because an Elevation View is always one a person made: inventing a view of the longest Wall
would be a drawing of something nobody asked to look at. A record that already carries the list comes
back as the same object it arrived as, so the step is idempotent and a v10 file is untouched by it.

Existing Projects are unaffected in every other way. A Plan View is unchanged — the six settings it
shares with an Elevation View moved into one interface both kinds extend (`SavedViewSettings`), which
is a type-level fact and not a change to what is written down — and a Project with no Elevation Views
draws, measures and saves exactly as it did at v9.

The strict validator refuses an Elevation View with a view line of no length, a depth of zero or less,
a Floor that does not exist, a name its Floor's Elevation Views already use, and every saved-view
problem a Plan View is refused for. Nothing about what a view *shows* is stored: which entities are
inside the prism, where they land and in what order they are drawn are derived on the way to the
canvas and never written down.

**A Backup made by this version cannot be opened by an older one.** It is domain schema v10, and a
build that stops at v9 has no tenth step to read it with, so it answers **"saved by a newer
BuildBox"** and writes nothing (#20 §5). Old Backups are unaffected: v1 through v9 still open, and the
step that runs on the way in adds one empty list and changes no measurement, no entity and no existing
value.

## What v11 holds (#76)

One thing, an addition to every Item Design:

* `clearanceEnvelope`, the design's **Clearance Envelope** (#76 §4) — a closed path in the design's
  own local coordinates, a `bottomOffset` measured from each placement's Base and a `height` greater
  than 0 — or `null` for the designs that carry none. Absent and `null` mean the same thing: the
  design asks nothing of the space around it.

`migrateV10toV11` writes `clearanceEnvelope: null` on every design that arrives without the field
and nothing else. It reads no clock, mints no ID and touches no other record, because a Clearance
Envelope is always one a person drew or measured — there is no built-in depth to invent and no kind
of item that implies one. A design that already carries the field, `null` or an envelope, comes back
untouched, so the step is idempotent and a v11 file is the same object it arrived as. No placement
moves and no warning reopens on the way in, because no measurement changed.

The strict validator refuses an envelope whose path is not a closed loop the geometry kernel accepts
— a self-intersecting or open path is refused with the kernel's own sentence, at the path it sits at
— a `height` of zero or less, a `bottomOffset` that is not a finite number, and, written as a list,
a design carrying more than one envelope. Nothing about what an envelope *means* is stored: which
placements intrude into one, and by how much, are derived on the way to the warning list and never
written down.

**A Backup made by this version cannot be opened by an older one.** It is domain schema v11, and a
build that stops at v10 has no eleventh step to read it with, so it answers **"saved by a newer
BuildBox"** and writes nothing (#20 §5). Old Backups are unaffected: v1 through v10 still open, and
the step that runs on the way in adds one null field to each design and changes no measurement, no
entity and no existing value.

## What v12 holds (#77)

One thing, an addition to both containers:

* `beams`, the **Beams** of a Floor (#77 §1) — a straight reference line, a `justification` and a
  `width` that place the two faces, an `underside` and a `height` that place it in the storey, and
  the optional `label`, `predecessorIds` and `drawingLayerId` every Building Element carries — in the
  Existing Model and in every Design Option's proposed model. A Beam is an ordinary Building Element:
  it stands on a Floor, it is demolished by a Design Option like anything else, and it is never a
  Wall, never an Opening and never something a Wall or an Opening refers to.

`migrateV11toV12` writes `beams: []` on the Existing Model and on every Design Option's proposed
model that arrives without the collection, and nothing else. It reads no clock, mints no ID and
touches no other record, because a Beam is always one a person drew over something they measured —
there is no built-in width to invent and no Wall that implies one. A container that already carries
the collection comes back untouched, so the step is idempotent and a v12 file is the same object it
arrived as. No entity moves and no warning reopens on the way in, because no measurement changed.

The strict validator refuses a Beam whose reference line is not straight — an arc is refused by name,
at the line it sits at — a line whose ends coincide or are no further apart than the drawing
tolerance, a `width` or a `height` of zero or less, a `justification` outside `left`, `centre` and
`right`, a `floorId` that names no Floor, and any field a Beam does not have: a host, a junction or a
face reference is refused as an unknown field, because a Beam attaches to nothing. A negative
`underside` is a Beam below this Floor's lower limit, which is a thing a person may genuinely draw,
so it is accepted and warned about rather than refused. Nothing about what a Beam *means* is stored:
which Placed Items, Openings and Clearance Envelopes it takes space from, and by how much, are
derived on the way to the warning list and never written down.

**A Backup made by this version cannot be opened by an older one.** It is domain schema v12, and a
build that stops at v11 has no twelfth step to read it with, so it answers **"saved by a newer
BuildBox"** and writes nothing (#20 §5). Old Backups are unaffected: v1 through v11 still open, and
the step that runs on the way in adds one empty list to each container and changes no measurement, no
entity and no existing value.

## What v13 holds (#78)

One thing, an addition to both containers:

* `skirting`, the **Skirtings** of a Floor (#78 §1) — the `hostWallId` of the Wall it is drawn
  against and the `side` of that Wall it stands off, a `start` and an `end` measured along the Wall's
  reference line, a `bottom` and a `height` that place it against the storey, and a `thickness` that
  stands it off the face — plus the optional `label`, `predecessorIds` and `drawingLayerId` every
  Building Element carries — in the Existing Model and in every Design Option's proposed model. A
  Skirting is the first element *hosted* on another: it names one Wall and one face of it, and it
  stores no outline. The body it draws, the gaps the doorways and the junctions leave in it and the
  lengths read from it are derived from the host Wall's tidied face and never written down.

`migrateV12toV13` writes `skirting: []` on the Existing Model and on every Design Option's proposed
model that arrives without the collection, and nothing else. It reads no clock, mints no ID and
touches no other record, because a Skirting is always one a person drew against a Wall they had
already placed — there is no built-in height to invent and no Wall that implies one. A container that
already carries the collection comes back untouched, so the step is idempotent and a v13 file is the
same object it arrived as. No entity moves and no warning reopens on the way in, because no
measurement changed.

The strict validator refuses a Skirting whose `hostWallId` names no Wall in the Project, or a Wall on
a different Floor from the Skirting's own; a range whose `end` is not further along the Wall than its
`start`; a range that runs past either end of the Wall it is drawn against; a `side` outside `left`
and `right`; a `height` or `thickness` of zero or less; and any field a Skirting does not have — a
polygon, a line or a list of gaps is refused as an unknown field, because the shape is derived. A
negative `bottom` is a Skirting below this Floor's lower limit, which is a thing a person may
genuinely draw, so it is accepted and warned about rather than refused. A range that runs under a
junction is a legal Skirting with a derived gap, not an error: only the Wall's own length bounds what
may be stored.

**A Backup made by this version cannot be opened by an older one.** It is domain schema v13, and a
build that stops at v12 has no thirteenth step to read it with, so it answers **"saved by a newer
BuildBox"** and writes nothing (#20 §5). Old Backups are unaffected: v1 through v12 still open, and
the step that runs on the way in adds one empty list to each container and changes no measurement, no
entity and no existing value.

## What v14 holds (#79)

One thing, an addition to both containers:

* `services`, the **Services** of a Floor (#79 §1) — a `kind` (`water`, `drain`, `gas`, `electrical`,
  `air_con` or `other`), a `shape` (`run` or `riser`) fixed after creation, and the measurements that
  shape has: a Run carries a `section` (`round` or `rectangular`), a straight centreline `line`, a
  `centrelineElevation`, and either an `outsideDiameter` or a `width` and a `depth`; a Riser carries a
  plan `point`, an `outsideDiameter`, a `bottomElevation` and a `height` — plus the optional `label`,
  `predecessorIds` and `drawingLayerId` every Building Element carries — in the Existing Model and in
  every Design Option's proposed model. A Service is hostless like a Beam: it is documented for
  coordination and for nothing else. It stores no host, no connection, no network, no fitting, no
  slope and no material, and it stores no Bottom, Centre or Top of a Run — those three are arithmetic
  on the centreline and the vertical side of the section, and a record that remembered one could
  disagree with its own Diameter.

`migrateV13toV14` writes `services: []` on the Existing Model and on every Design Option's proposed
model that arrives without the collection, and nothing else. It reads no clock, mints no ID and touches
no other record: no legacy service data exists (#20 §7), and a pipe nobody documented is not a record
of a pipe, so there is nothing to translate and nothing to infer. A container that already carries the
collection comes back untouched, so the step is idempotent and a v14 file is the same object it arrived
as. No entity moves and no warning reopens on the way in, because no measurement changed.

The strict validator refuses a Run whose centreline is no longer than the drawing tolerance — a Run
with no length has no direction to read its faces from; a Riser whose `height` is zero or less; an
`outsideDiameter`, `width` or `depth` of zero or less; a `kind`, `shape` or `section` outside its
closed vocabulary; and a field that belongs to the other shape or section — a `width` on a round Run,
an `outsideDiameter` on a rectangular one, a `section`, a `line` or a `centrelineElevation` on a
Riser, a `point` or a `height` on a Run — each refused by name at the field it sits at, because such a
record describes two different elements at once. A negative `centrelineElevation` or
`bottomElevation` is a Service below this Floor's Datum, which is a thing a person may genuinely
document, so it is accepted and warned about rather than refused. Nothing about what a Service *means*
against other content is stored: which Openings, Beams, Placed Items and Clearance Envelopes it takes
space from, and by how much, are derived on the way to the warning list and never written down.

**A Backup made by this version cannot be opened by an older one.** It is domain schema v14, and a
build that stops at v13 has no fourteenth step to read it with, so it answers **"saved by a newer
BuildBox"** and writes nothing (#20 §5). Old Backups are unaffected: v1 through v13 still open, and
the step that runs on the way in adds one empty list to each container and changes no measurement, no
entity and no existing value.

## What this release means for a reader (#73)

In plain words:

* A Project can hold **Design Options** — named alternatives over one Existing Model — and every
  Plan View remembers which Option it looks through and which of the four **Renovation Displays**
  (Existing, Proposed, Combined, Demolition) it draws.
* Every Project gains **Drawing Layers**, starting with three: `Structure`, `Services` and
  `Furniture`. Existing Walls, Openings and Rooms are filed on `Structure` and existing furniture on
  `Furniture`, so a Project looks and prints the way it did before; nothing is lost by hiding a
  layer, and a hidden layer's content still measures.
* The **Export dialog** now asks which layers a drawing draws and which Option a List is counted
  over, and says how many rows that scope hides.

**A Backup made by this version cannot be opened by an older one.** It is domain schema v8, and a
build that stops at v7 has no eighth step to read it with, so it answers
**"saved by a newer BuildBox"** and writes nothing (#20 §5). Old Backups are unaffected: v1 through
v7 still open, and the step that runs on the way in adds the empty Options, the two view settings,
the three starting layers and the layer filing — it changes no measurement, no drawing and no
existing value.
