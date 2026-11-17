/**
 * The public face of the `platform` module (#49, #20 §2): the browser capabilities the
 * composition root hands to `session` and to the views — the clock, the cross-tab lock,
 * image decoding and object-URL lifetime.
 *
 * `platform` is impure by definition and imports nothing but `lib`; the types it speaks are
 * the ports `session` and `persistence` already publish. Only `src/app` imports it (#20 §2),
 * which is what keeps `session` testable without a browser.
 */
export { createPlatformClock } from './clock'
export { createRandomIdSource } from './ids'
export { createWebLocksPort, projectLockKey } from './locks'
export { readPlanImageFile, type PlanImageSource } from './images'
export { createObjectUrlCache, type ObjectUrlCache } from './objectUrls'
