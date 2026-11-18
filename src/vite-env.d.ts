/// <reference types="vite/client" />

// Build-time feature flags only (#20 §11): `import.meta.env.VITE_FF_*` is replaced with a
// string literal at build time, so a comparison with `'true'` folds and the flagged branch
// is dropped from the production bundle. There is no runtime flag, and no flag read anywhere
// but `src/main.tsx`.
interface ImportMetaEnv {
  /** Run the cabinet editor and floor plan on Project sessions (#49). Off unless `'true'`. */
  readonly VITE_FF_PROJECTS_V2?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * The version from `package.json`, replaced with a string literal at build time (#50).
 *
 * It is a `define` and not an environment variable because it is not a switch: every build
 * carries its own version, and a Project Backup's manifest has to say which build wrote it.
 */
declare const __BUILDBOX_VERSION__: string
