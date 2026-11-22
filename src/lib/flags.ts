/**
 * The build-time capability flags (#20 §11, #69).
 *
 * `src/app/channel.ts` asks the *mechanism* question — is any `VITE_FF_*` on, and so is this a
 * preview build writing to `buildbox-preview`? This file asks the *capability* question for the
 * one flag that still has a capability behind it, and it lives in `lib` because `lib` is the only
 * module every gated module may import: `domain` registers a migrator on the answer, `derive`
 * decides whether a Design Option is part of the effective model on it, `edit` decides which
 * Intents are in the catalogue on it, and `ui` decides what to render on it. None of them may
 * import `app`.
 *
 * It is a module-level constant rather than a function on purpose. The build replaces the flag
 * expression with a string literal — the note on the constant says which expression and why — so a flag-off build
 * compiles this to `false`, every `if (FF_RENOVATION)` branch below it folds away, and the
 * renovation code is never reachable — which is what lets `scripts/check-bundle-strings.mjs`
 * prove the claim by grepping the bundle for `__renovation_intents__`. A function would be a call
 * site the bundler has to be clever about; a constant is not.
 *
 * `#73` turns the flag on and deletes it, and with it this file's only entry.
 */

/**
 * Whether this build carries the renovation model (#69): Design Options, the Renovation States
 * derived from them, the renovation Intents, and the UI that drives them.
 *
 * `process.env`, and not the `import.meta.env` a Vite app usually reads, for two reasons. This file
 * is inside the `lib` barrel, `domain` imports the barrel for its banned words, and the Playwright
 * support modules import `domain` from raw Node, where `import.meta.env` does not exist — reading a
 * property off it threw during spec collection, taking the whole smoke suite with it; an undefined
 * `process.env` entry simply answers `false`. And the value still has to be a literal at build
 * time, which `vite.config.ts`'s `define` entry provides: it is replaced with `"true"` or `"false"`,
 * every `if (FF_RENOVATION)` branch below folds away, and `scripts/check-bundle-strings.mjs` can
 * prove the dark-feature claim by grepping the bundle for `__renovation_intents__`. An optional
 * chain or a `typeof` guard on the expression defeats that replacement and silently produces a
 * flag-on build that behaves like a flag-off one.
 *
 * The value comes from the mode's `.env` file — `.env.renovation` for the preview build — so this
 * flag and `src/app/channel.ts`'s preview-database rule cannot disagree.
 */
export const FF_RENOVATION = process.env.VITE_FF_RENOVATION === 'true'
