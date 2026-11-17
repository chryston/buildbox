/**
 * One reason the legacy reader refused an input.
 *
 * `path` is dot/bracket syntax rooted at the value that was handed to the validator,
 * for example `projects[2].units[0].root.children[1].splitRatio` or
 * `state.floorPlan.objects[3].rotation`. The empty string means the input itself.
 *
 * `code` is a stable kebab-case identifier — a machine-readable contract with the UI
 * and with tests. #42 moves this shape to `lib` unchanged, so don't reshape it here.
 */
export interface ValidationProblem {
  path: string
  code: string
  message: string
}

/** The input value itself, used when no deeper path applies (bad JSON, wrong root). */
export const ROOT_PATH = ''

export const problem = (path: string, code: string, message: string): ValidationProblem => ({
  path,
  code,
  message,
})
