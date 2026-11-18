/**
 * The colour swatches the selection inspector offers (#55).
 *
 * These are Item Design data — the `#rrggbb` a `plan.updateObject` writes into
 * `design.color` — not chrome, so they are values rather than tokens, exactly the eight
 * the legacy properties panel offered and the same set `edit/planCatalogue.ts` colours
 * its entries with. Workspace *styling* uses only `var(--bb-*)` tokens (#55 criterion 14);
 * this module is the data the styling draws.
 */
export const PLAN_SWATCHES: readonly string[] = [
  '#6366f1',
  '#10b981',
  '#0ea5e9',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#92400e',
  '#374151',
]
