/**
 * The public face of the `platform` module (#49, #20 §2): the browser capabilities the
 * composition root hands to `session` and to the views — the clock, the cross-tab lock,
 * image decoding and object-URL lifetime.
 *
 * `platform` is impure by definition and imports nothing but `lib`; the types it speaks are the
 * ports `session` and `persistence` already publish. Only `src/app` imports it (#20 §2), which is
 * what keeps `session` testable without a browser.
 *
 * The Backup encoder is the one exception, and it is a pair of files rather than a widening of
 * the rule: `./backup.worker.ts` is a Worker entry that imports `package` and nothing else, and
 * `./backupEncoder.ts` is its host. Both are claimed out of `platform` by name in
 * `eslint.config.js`, so the rule "platform imports nothing but `lib`" still holds for every
 * other file in this folder.
 */
export { createPlatformClock } from './clock'
export { createRandomIdSource } from './ids'
export { createWebLocksPort, projectLockKey } from './locks'
export { createImageDecoder, readPlanImageFile, type PlanImageSource } from './images'
export { createObjectUrlCache, type ObjectUrlCache } from './objectUrls'
export { createBackupEncoder } from './backupEncoder'
export { createDownload } from './download'
export { createLegacySource, LEGACY_STORE_KEY } from './legacySource'
