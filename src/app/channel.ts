/**
 * Which channel this build writes to (#53, #20 §11).
 *
 * Production is the default: a build made with no `VITE_FF_*` set opens the database people
 * keep their work in, and the Packages it writes are unmarked. A build made with **any**
 * flag on is a preview — it opens the preview database instead, and marks its Packages
 * `preview: true` so a production build refuses them rather than importing preview work into
 * a real database.
 *
 * The mechanism, not one flag, is the rule: when the last capability ships there is no flag
 * left to set, and a build cannot accidentally be a preview. `import.meta.env` is a static
 * object in a built bundle, so this is a handful of string comparisons at startup.
 */

/** The database production keeps its Projects in. */
export const PRODUCTION_DB_NAME = 'buildbox'

/** The database a flagged build keeps its Projects in: never the one real work lives in. */
export const PREVIEW_DB_NAME = 'buildbox-preview'

/** The prefix every remaining build-time flag shares; `projects_v2` was the first and is gone (#53). */
const FLAG_PREFIX = 'VITE_FF_'

/** Whether any build-time flag is on; `env` is `import.meta.env` or a stand-in for it. */
export function isPreviewChannel(env: Record<string, unknown>): boolean {
  return Object.entries(env).some(([key, value]) => key.startsWith(FLAG_PREFIX) && value === 'true')
}

/** The database this build opens. */
export function channelDbName(env: Record<string, unknown>): typeof PRODUCTION_DB_NAME | typeof PREVIEW_DB_NAME {
  return isPreviewChannel(env) ? PREVIEW_DB_NAME : PRODUCTION_DB_NAME
}

/** Whether this build's Packages are marked `preview: true` and it alone may read them back. */
export const IS_PREVIEW = isPreviewChannel(import.meta.env as unknown as Record<string, unknown>)

/** The database this build opens. */
export const DB_NAME = channelDbName(import.meta.env as unknown as Record<string, unknown>)
