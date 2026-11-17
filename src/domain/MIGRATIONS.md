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
