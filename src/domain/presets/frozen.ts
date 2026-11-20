/**
 * Freezing a value all the way down.
 *
 * The pack is shared, module-level data: every tool, panel and test reads the same object,
 * so one stray write would change what another part of the app sees and nothing would say
 * so. `Object.freeze` alone would leave the nested `values` records and the arrays inside
 * the entries writable, which is where a mistake actually happens — `entry.values.width =
 * 800` is exactly the edit a frozen top level does not stop.
 *
 * The type stays as the entry was declared: freezing is a runtime guarantee, and the API
 * that hands out a writable copy of an entry (`overridableCopyOf`) is the one place a
 * caller is meant to write.
 */
export const deepFrozen = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFrozen(child)
    Object.freeze(value)
  }
  return value
}
