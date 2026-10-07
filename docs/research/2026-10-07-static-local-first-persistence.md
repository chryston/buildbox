# Local-first persistence on a static GitHub Pages deployment

**Issue:** [#12 — Research local-first persistence on a static deployment](https://github.com/chryston/buildbox/issues/12)  
**Researched:** 2026-10-07

## Decision

BuildBox should remain a static GitHub Pages application and use **IndexedDB as its required local system of record**, including `Blob` records for imported images. Keep `localStorage` only long enough to migrate the existing state, then only for tiny, non-critical preferences if needed. Treat OPFS as an optional future optimization for unusually large or high-throughput binary assets, not as a second required persistence path. Use ordinary browser downloads and `<input type="file">` for a portable backup/restore flow; offer File System Access pickers only as a feature-detected enhancement.

**Firebase is not required, and the GitHub Pages deployment does not need to change, for local autosave, embedded images, export/import, persistence requests, or an offline app shell.** A managed backend becomes useful only when the product requires account-based cloud recovery, cross-device synchronization, collaboration, or access-controlled sharing. Even then, Pages can remain the frontend and call Firebase or another HTTPS service; the backend is a separate adapter and operational dependency, not a prerequisite for local-first storage.

## Current BuildBox context

- Zustand currently persists `projects`, `activeProjectId`, and the global `floorPlan` as one `buildbox-store` value in `localStorage`, with store schema version 3 (`src/store/store.ts`).
- A floor-plan image is currently a base64 data URL inside that persisted object (`src/types/index.ts`, `src/components/FloorPlan/FloorPlanPage.tsx`). This expands binary data by roughly one third before JSON overhead and puts the whole workspace against Web Storage's small limit.
- Workspace export is version 1 JSON and contains cabinet projects only (`src/utils/workspaceIO.ts`); floor-plan export is separate and embeds the image data URL (`src/utils/floorPlanExport.ts`). Neither is yet a complete backup of one coordinated BuildBox project.
- The production workflow emits static Vite assets to GitHub Pages at `https://chryston.github.io/buildbox` (`.github/workflows/static.yml`, `package.json`). GitHub defines Pages as static HTML/CSS/JavaScript hosting, and all correctly configured Pages sites can use HTTPS.[^pages][^pages-https]

These facts make a storage migration urgent before users attach realistic floor-plan images, but do not imply a need for a server.

## Browser capability and constraint matrix

| Mechanism | What the platform provides | BuildBox use |
|---|---|---|
| `localStorage` | Synchronous, origin-scoped, string-only storage. The documented Web Storage ceiling is 10 MiB total per origin—5 MiB local plus 5 MiB session—and writes beyond it throw `QuotaExceededError`.[^quota][^localstorage] | Do **not** store project graphs or images. At most retain tiny preferences/migration markers. Migrate the current `buildbox-store` value to IndexedDB and remove it only after the new transaction is verified. |
| IndexedDB | Broadly available asynchronous, transactional storage for significant structured data, including files and `Blob`s; values use structured cloning and stores can be indexed.[^idb] | Required canonical store for project records, revisions, asset metadata, and image `Blob`s. It supplies one compatibility path and can atomically commit related records in a transaction. |
| OPFS | `navigator.storage.getDirectory()` exposes an origin-private filesystem. It is not user-visible, needs no picker prompt, is quota-managed, and is deleted when site data is cleared. The API requires a secure context; synchronous access handles are worker-only.[^opfs][^opfs-access] | Optional optimization behind feature detection for future large/high-throughput files. It does not improve recovery or ownership. Avoid it initially because an IndexedDB manifest plus OPFS bytes introduces cross-store consistency work. |
| File System Access pickers | `showOpenFilePicker`, `showSaveFilePicker`, and `showDirectoryPicker` address user-visible files. Picker methods require HTTPS and transient user activation; permissions can need to be requested again. MDN marks the picker methods limited/experimental rather than a cross-browser baseline.[^save-picker][^fsa] | Optional “Open/Save As” enhancement. Never make it the only import/export route. A retained handle is not a guarantee of future permission. |
| File input + download | `<input type="file">` gives JavaScript a user-selected `File`; an anchor with `download` can download generated `Blob` URLs. The file input's `accept` value is only a chooser hint, not validation.[^file-input][^download] | Cross-browser baseline for explicit import and export. Import copies bytes into managed storage; it does not retain ongoing access to the original file. |
| Service worker + Cache API | A service worker is an HTTPS, origin/path-scoped network proxy used for offline experiences and static response caching. It cannot use synchronous Web Storage.[^sw] | Optional offline app shell. Cache versioned build assets, not authoritative project data. Register and resolve assets under the Pages project base path (`/buildbox/`). Persistence works without a service worker. |

### Origin consequences on GitHub Pages

Browser storage is scoped by **origin**—scheme, host, and port—not URL path.[^quota][^origin] Therefore:

- `/buildbox/` path changes on the same `https://chryston.github.io` host do not move IndexedDB data, although service-worker scope and asset URLs are path-sensitive.
- Other project sites on the same `chryston.github.io` host share the origin. Use app-prefixed database/store names, and recognize that same-origin script is inside the browser storage trust boundary.
- Moving to a custom domain creates a new origin. Redirects do not transfer localStorage, IndexedDB, OPFS, or service-worker state. Release export first, keep the old origin reachable for a migration window, and import on the new origin.
- HTTP and HTTPS are different origins. Enforce HTTPS; GitHub Pages supports it for both `github.io` sites and correctly configured custom domains.[^pages-https]

## Quota, persistence, and eviction

IndexedDB, Cache API, and OPFS share browser-managed origin storage. The values returned by `navigator.storage.estimate()` are estimates, not reservations, so every write must still handle quota and transaction failure.[^quota]

Current documented maximum policies vary substantially:

- Firefox best-effort storage is the smaller of 10% of disk or a 10 GiB site-group limit; persisted origins can use up to 50% of disk, capped at 8 TiB.
- Chromium-based browsers document up to 60% of disk per origin.
- Safari/WebKit documents roughly 60% per origin in browser apps and 15% in embedded WebViews from macOS 14/iOS 17, with additional global and cross-origin limits.

These figures are ceilings, not promised free space. Storage is **best-effort by default**. `navigator.storage.persist()` can request protection from automatic storage-pressure eviction, but the browser may return `false`; Firefox may prompt while Chromium/Safari commonly decide from engagement. Persistence still does not survive explicit site-data clearing, profile/device loss, or private browsing teardown. Safari can also proactively evict script-created data for an origin with no user interaction in the preceding seven days under its tracking-prevention policy. When an origin is evicted, its managed data is removed together.[^quota][^persist]

Product consequences:

1. Ask for persistence after the user has created meaningful work, explain the benefit, and display the returned status without claiming “backed up.”
2. Check estimated headroom before a large image import; impose documented per-file/project limits; catch `QuotaExceededError`; preserve the last committed revision if a write fails.
3. Detect missing/corrupt records at startup and offer recovery/import instead of silently initializing over them.
4. Warn that private sessions are temporary. No reliable cross-browser API proves incognito mode, so infer failure/ephemerality conservatively rather than fingerprinting it.
5. Make explicit export—and later optional remote sync—the recovery boundary. Browser persistence alone is never the only durable copy of valuable work.

## Recommended local data model

Use one IndexedDB database with separately versioned object stores, for example:

- `projects`: domain snapshot and metadata keyed by stable project ID;
- `assets`: raw `Blob`, media type, byte length, dimensions, and content hash keyed by stable asset ID;
- `revisions`: bounded recovery checkpoints, parent revision, timestamp, and reason;
- `settings`: tiny application settings and migration completion state.

Project records reference asset IDs, never data URLs, object URLs, OPFS paths, or Firebase document IDs. Create object URLs only while rendering and revoke them afterward. Save a project snapshot and its changed asset records in one read-write transaction. Keep a small bounded revision history so an interrupted or logically bad save can roll back without keeping unlimited copies of images.

For the one-time cutover, parse and validate `buildbox-store`, decode any image data URL to a `Blob`, write all records in one IndexedDB transaction, read back the new root record, then mark migration complete and remove the old key. If migration fails, leave the legacy value untouched and show an export/retry path.

### Images

- Accept a deliberately small raster allowlist (for example PNG, JPEG, and WebP), check decoded dimensions and byte limits, and derive the actual media type from file bytes/decoding rather than trusting filename, `accept`, or `File.type` alone.
- Copy imported bytes into IndexedDB. A file input or picker selection is not the project's durable copy.
- Avoid active SVG/HTML and remote URL references in project assets unless a later threat model and sanitizer support them; they create script, external-resource, and privacy risks.
- Deduplicate by a cryptographic content hash if storage pressure justifies the computation; do not use filenames as identity.

## Portable format, versioning, and recovery

Adopt one self-contained `.buildbox` package for the coordinated project. For image-bearing projects, a ZIP-compatible container avoids base64 expansion and permits streamed assets:

```text
manifest.json
projects/<project-id>.json
assets/<asset-id>.<validated-extension>
```

`manifest.json` should contain a format identifier, **export schema version independent of the app release**, creation/export timestamps, stable IDs, entry paths, byte lengths, media types, and SHA-256 digests. Export must include every referenced asset and no device-local handles. Produce deterministic paths/order where practical so files can be compared and tested.

Maintain three separate version concepts:

1. **IndexedDB database version** for object-store/index upgrades (`upgradeneeded`);
2. **domain schema version** on stored snapshots for data migrations;
3. **package format version** for import/export compatibility.

Never use the deployed app version as a substitute. Keep explicit, sequential, tested migrators. Import into a staging transaction: enforce total/uncompressed/file-count limits, reject absolute or `..` archive paths, validate schema and IDs, verify hashes and image decoding, migrate a copy, then atomically replace or merge only after success. Reject unsupported newer major formats with a useful message; do not partially import or overwrite the current workspace. Retain read support for the existing `.buildbox.json` v1 as a legacy importer during the cutover, but all new exports should use the complete package.

Recovery UX should provide: autosave status, last successful save time, storage persistence status, recent local checkpoints, “Download backup,” and “Restore backup.” Export before destructive migrations and origin/domain moves. Test restore, not merely download generation.

## Security boundary

Local-first means local availability, not secret storage:

- Any script executing in the same origin (including an XSS payload or another same-origin Pages project) can act with the application's browser privileges. Do not store credentials, service-account keys, or backend authorization secrets in localStorage/IndexedDB/OPFS.
- Treat project packages and images as untrusted input. Apply size/count/decompression limits, schema validation, safe path handling, media decoding checks, and non-executable rendering. Never insert imported text as HTML.
- Browser-managed persistence is normally unencrypted at the application layer and is accessible to the browser profile/device user. If confidential plans later require application encryption, make it an explicit passphrase/key-management feature; encryption with an automatically stored local key does not protect against same-origin compromise.
- On export, warn users that the package contains the complete floor plan and images. On shared devices, provide an explicit “delete local data” action.

## Future backend adapter

Keep domain/UI code independent of IndexedDB and any vendor SDK. A practical boundary separates:

- `ProjectRepository`: list/load/save-with-expected-revision/delete;
- `AssetRepository`: put/get/delete immutable bytes by asset ID/hash;
- `PackageCodec`: validate/migrate/export/import the portable format;
- optional `SyncAdapter`: push/pull changes and report conflicts.

The local repositories remain available offline. A future adapter maps the same stable IDs, schema versions, revisions, and asset hashes to remote storage. Synchronization must add explicit user identity, authorization, tombstones, conflict policy, retries, and schema negotiation; do not bury “last write wins” inside the repository API.

Firebase/Firestore is one possible remote implementation. Its web persistent cache is disabled by default, uses IndexedDB when enabled, synchronizes with the cloud on reconnect, and resolves multiple changes to one document with last-write-wins.[^firestore-offline] That behavior does not replace BuildBox's portable backup format or conflict design. Firebase's browser API key is expected to be public; authorization must be enforced by Security Rules (and App Check where appropriate), not by hiding configuration in a static bundle.[^firebase-keys] Larger image assets would also need an appropriate blob/object service rather than being coupled to project JSON.

### When a backend is actually required

| Requirement | Backend? | Deployment consequence |
|---|---:|---|
| Local autosave, reload recovery on the same browser profile, embedded images | No | Keep GitHub Pages; IndexedDB. |
| Manual backup/restore or moving devices by file | No | Keep Pages; download and file input. |
| Offline app shell | No | Keep Pages; optional service worker. |
| Account-based recovery, automatic cross-device sync | Yes | Provision an HTTPS backend/Firebase; Pages may remain the frontend. |
| Multi-user collaboration or access-controlled sharing | Yes | Backend, authentication, authorization, conflict/audit design; Pages may remain the frontend. |
| Server-held secrets, privileged processing, or same-origin server sessions | Yes | Add a server/API; change frontend hosting only if the chosen security/runtime design requires it. |

## Recommendation to specification work

1. Specify the IndexedDB repositories, transactions, migration from `buildbox-store`, quota/error states, and bounded recovery revisions.
2. Specify a complete versioned `.buildbox` archive and legacy `.buildbox.json` importer, with asset validation and atomic restore.
3. Add persistence-status and backup/restore UX before relying on browser storage for important work.
4. Keep OPFS, native file pickers, and the service worker as separately feature-detected enhancements.
5. Preserve GitHub Pages. Defer Firebase/backend selection until a cloud-sync, account recovery, sharing, or collaboration requirement exists; define that as a `SyncAdapter`, not as the local repository.

## Sources

[^pages]: GitHub Docs, [What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
[^pages-https]: GitHub Docs, [Securing your GitHub Pages site with HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
[^quota]: MDN, [Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
[^localstorage]: MDN, [`Window.localStorage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
[^idb]: MDN, [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API); W3C, [Indexed Database API 3.0](https://w3c.github.io/IndexedDB/)
[^opfs]: MDN, [Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
[^opfs-access]: MDN, [`StorageManager.getDirectory()`](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory)
[^save-picker]: MDN, [`showSaveFilePicker()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)
[^fsa]: WICG, [File System Access](https://wicg.github.io/file-system-access/)
[^file-input]: MDN, [`<input type="file">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)
[^download]: MDN, [`HTMLAnchorElement.download`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLAnchorElement/download)
[^sw]: MDN, [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
[^origin]: WHATWG HTML, [Origins](https://html.spec.whatwg.org/multipage/browsers.html#concept-origin)
[^persist]: MDN, [`StorageManager.persist()`](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
[^firestore-offline]: Firebase, [Access data offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
[^firebase-keys]: Firebase, [Learn about and manage API keys](https://firebase.google.com/docs/projects/api-keys)
