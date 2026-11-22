/// <reference types="vite/client" />

// Build-time feature flags (#20 §11) are read as a set, not by name: `src/app/channel.ts` asks
// whether any `VITE_FF_*` is `'true'` and picks the preview channel from the answer. A module
// that needs one flag by name reads it through `FF_RENOVATION` in `src/lib/flags.ts`, which is
// also where the type below comes in useful: a flag that ships stops being a flag without this
// file having to change (#53), so the list holds only the flags still dark.

interface ImportMetaEnv {
  /** `#69`: the renovation model. `'true'` turns it on; anything else, including absent, is off. */
  readonly VITE_FF_RENOVATION?: string
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
