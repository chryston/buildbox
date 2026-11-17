/**
 * The package format version and the budget every import is read under (#20 §6, §12,
 * #44). `PACKAGE_FORMAT_VERSION` is one of the three independent version constants —
 * the workspace file version and the IndexedDB `schemaVersion` say nothing about it,
 * and neither does `DOMAIN_SCHEMA_VERSION`, which lives in the manifest beside it.
 *
 * Any change to what `encodeProject` writes bumps this constant, adds a fixture under
 * `fixtures/package/v<N>/` and needs a release note (#20 §12).
 */
export const PACKAGE_FORMAT_VERSION = 1

/** The `format` a BuildBox Backup manifest carries. */
export const PACKAGE_FORMAT = 'buildbox-project'

/**
 * The `format` an export ZIP carries (#19). It is not importable as a Backup; naming it
 * here is what lets the staged import tell the two apart instead of guessing.
 */
export const EXPORT_FORMAT = 'buildbox-export'

/** The three entry names the format reserves. */
export const MANIFEST_ENTRY = 'manifest.json'
export const PROJECT_ENTRY = 'project.json'
export const ASSET_PREFIX = 'assets/'

/** The media type `project.json` is listed under. */
export const PROJECT_MEDIA_TYPE = 'application/json'

/**
 * The limits an untrusted archive is read under (#44 §"Constants"). They are checked
 * against bytes actually produced, never against what the archive declares.
 */
export const PACKAGE_LIMITS = {
  /** The whole `.buildbox` file: 250 MB. */
  maxInputBytes: 262_144_000,
  /** Entries in the central directory. */
  maxEntries: 2_000,
  /** One entry, uncompressed: 50 MB. */
  maxEntryBytes: 52_428_800,
  /** Every entry added together, uncompressed: 250 MB. */
  maxTotalBytes: 262_144_000,
  /** Highest tolerated uncompressed : compressed ratio. */
  maxRatio: 100,
} as const

/**
 * Below this many uncompressed bytes the ratio is not checked (#44: the per-entry ratio
 * applies "for entries of at least 1 MiB uncompressed"). A 2 KB manifest deflated at
 * level 6 is 60:1 on its own, so a ratio without a floor would reject ordinary
 * packages; 1 MiB is where a ratio starts to mean an attack rather than good
 * compression of repetitive JSON.
 */
export const RATIO_FLOOR_BYTES = 1_048_576
