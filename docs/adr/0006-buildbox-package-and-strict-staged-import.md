# The `.buildbox` package is the only importable file, through strict staged import

Anything a user can hand back to the app is both an attack surface and a migration surface, so one format is validated in exactly one place.

1. A Project Backup is one deterministic ZIP. It holds a hashed manifest, canonical `project.json` and content-addressed assets. It is versioned independently of the domain schema and the IndexedDB version.
2. Every import is untrusted. It goes through: size and limit checks; hash checks; sequential migration; strict validation; an explicit Replace or Import as copy choice. It then commits in one atomic transaction or not at all. There is no best-effort casting, no partial import and no entity-level merge.
3. Exports (`buildbox-export` ZIPs and loose CSV/PDF/SVG/PNG files) and preview-build packages are rejected as Backups. Legacy `.buildbox.json` is accepted only through the cutover's migration review.

## Considered options

- Entity-level merge of two Projects on import: rejected — it needs a conflict model nobody asked for and makes "not at all" impossible to promise.
- Lenient field casting so older files just work: rejected — it hides corruption until it is written back.

**Owning resolutions:** [#14 save, recovery, import, and migration](https://github.com/chryston/buildbox/issues/14#issuecomment-6035259636), [#20 target architecture and migration seams](https://github.com/chryston/buildbox/issues/20#issuecomment-6911090101) (§6), [#19 export product contract](https://github.com/chryston/buildbox/issues/19#issuecomment-6910731014).
