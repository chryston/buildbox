/**
 * The one validation-problem shape for the whole app (#42 §1).
 *
 * `path` is dot/bracket syntax rooted at the value that was handed to the validator,
 * for example `itemDesigns[2].construction.root.children[0].splitRatio` or
 * `existingModel.placedItems[3].floorId`. The empty string means the input itself.
 *
 * `code` is a stable kebab-case identifier — a machine-readable contract with the UI
 * and with tests. Validators report every problem they find; nothing here decides what
 * the user is shown first.
 */
export interface ValidationProblem {
  path: string
  code: string
  message: string
}

/** The input value itself, used when no deeper path applies (bad JSON, wrong root). */
export const ROOT_PATH = ''

/** One problem, in the one shape every validator uses. */
export const problem = (path: string, code: string, message: string): ValidationProblem => ({
  path,
  code,
  message,
})

/**
 * The path of `key` inside `base`: `a.b` for a field, `a[0]` for an array element, and
 * a bare `b` at the root. A numeric key is an array index; anything else is a field name.
 */
export const childPath = (base: string, key: string | number): string =>
  base === ''
    ? String(key)
    : typeof key === 'number'
      ? `${base}[${key}]`
      : `${base}.${key}`
