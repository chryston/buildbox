/**
 * The `pure` Vitest project's guard (#20 §9.1, §13.13).
 *
 * Pure modules run under Node, with no DOM at all: a test that reaches for `document`
 * has to fail here rather than quietly depend on jsdom leaking in. `navigator` is not
 * checked — Node 24 defines a minimal global `navigator` — but lint's
 * `no-restricted-globals` still bans it in pure source.
 */
const FORBIDDEN_GLOBALS = ['window', 'document', 'localStorage', 'indexedDB']

const present = FORBIDDEN_GLOBALS.filter(
  (name) => typeof (globalThis as Record<string, unknown>)[name] !== 'undefined',
)

if (present.length > 0) {
  throw new Error(
    `The pure Vitest project must not expose DOM globals; found ${present.join(', ')}. ` +
      'A DOM-touching test belongs in the jsdom project.',
  )
}
