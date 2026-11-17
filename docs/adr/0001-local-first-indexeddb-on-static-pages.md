# Local-first IndexedDB on static GitHub Pages; backend deferred

BuildBox is served as static pages, so there is no server that could hold a user's work and the browser has to be the system of record.

1. BuildBox stays a static app on GitHub Pages. IndexedDB, including image Blobs, is the local system of record, and every completed Edit Transaction is committed atomically with a truthful `Saving…` / `Saved locally` / `Save failed` status.
2. Domain and view code reach storage only through repository ports with stable IDs and expected revisions. Recovery is the user-owned `.buildbox` Project Backup plus bounded local Recovery Points, never "the browser kept it".
3. Firebase, Supabase, accounts, authentication and sync are deferred until cloud recovery, cross-device sync, sharing or collaboration is actually required. A future Sync Adapter must surface conflicts and never relies on silent last-write-wins.

## Considered options

- A hosted backend from the start: rejected — no cloud requirement exists yet, and it would demote the user's own copy to a cache.
- `localStorage` for everything: rejected — no room for Plan Image Blobs and no transactional commit.

## Consequences

- Loss paths are owned by the user through the Project Backup; the app never claims durability it cannot guarantee.
- Repository ports keep the IndexedDB adapter replaceable by a Sync Adapter without touching domain code.

**Owning resolutions:** [#12 local-first persistence research](https://github.com/chryston/buildbox/issues/12#issuecomment-6032253899), [#14 save, recovery, import, and migration](https://github.com/chryston/buildbox/issues/14#issuecomment-6035259636).
