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
