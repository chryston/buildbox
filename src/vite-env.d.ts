/// <reference types="vite/client" />

// Build-time feature flags (#20 §11) are read as a set, not by name: `src/app/channel.ts` asks
// whether any `VITE_FF_*` is `'true'` and picks the preview channel from the answer. No flag is
// declared now — the last one was the renovation model, which shipped in #73 — so the env keeps the
// shape `vite/client` gives it, and the next dark capability adds a key here (#53).

/**
 * The version from `package.json`, replaced with a string literal at build time (#50).
 *
 * It is a `define` and not an environment variable because it is not a switch: every build
 * carries its own version, and a Project Backup's manifest has to say which build wrote it.
 */
declare const __BUILDBOX_VERSION__: string
