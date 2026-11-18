/**
 * The Floor workspace (#55): the production Plan View and the shell around it.
 *
 * The module is deliberately self-contained — it speaks to the rest of the app through
 * structural ports (`IntentBuilder`, `AssetUrlSource`, `ViewportCache`, …) supplied by
 * `app` at the seam, the way `ui/legacy` does, so the eslint boundary can hold it to
 * `session`, `drawing`, `derive`, `domain` and `export` only.
 */
export * from './displayUnits'
export * from './planModel'
export * from './viewport'
