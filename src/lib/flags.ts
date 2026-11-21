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
 * It is a module-level constant rather than a function on purpose. Vite replaces
 * `import.meta.env.VITE_FF_RENOVATION` with a string literal at build time, so a flag-off build
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
 */
export const FF_RENOVATION = import.meta.env.VITE_FF_RENOVATION === 'true'
