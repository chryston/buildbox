/// <reference types="vite/client" />

// Build-time feature flags (#20 §11) are read as a set, not by name: `src/app/channel.ts` asks
// whether any `VITE_FF_*` is `'true'` and picks the preview channel from the answer. No module
// names a flag, so there is nothing to declare here — and a flag that ships stops being a flag
// without this file having to change (#53).

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
