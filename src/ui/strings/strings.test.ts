/**
 * Every sentence the interface speaks, in one file, checked as a whole (#51 criterion 5).
 *
 * The snapshot is the point rather than a convenience. #51's acceptance is that no component holds
 * a literal, and the only way to notice a sentence that has quietly moved into one is to look at
 * the entire vocabulary at once — a per-string assertion would have to be written for each new
 * line, and nobody writes those for the line they were trying to get on screen.
 *
 * It also freezes the two records that map a state to a sentence. `recoveryReason` and
 * `saveFailureReason` are indexed by unions owned by `session` and `persistence`, so a new kind
 * there is a type error here; a new *word* here is a snapshot diff, which is the review the copy
 * deserves.
 */
import { describe, expect, it } from 'vitest'
import { STRINGS } from './index'

describe('the copy', () => {
  it('is the whole vocabulary of the interface', () => {
    expect(STRINGS).toMatchSnapshot()
  })

  it('keeps every sentence out of the components that speak it (#51 criterion 5)', async () => {
    // The check is textual on purpose: a component that renders a literal still type-checks, still
    // snapshots, and still shows the user a sentence nobody reviewed.
    const sources = import.meta.glob('./**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<
      string,
      string
    >
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('.test.'))
      .flatMap(([path, source]) =>
        [...source.matchAll(/<(?:h1|h2|h3|p|button|span|strong|small|label)\b[^>]*>([^<>{}]+)<\//g)]
          .map((match) => match[1].trim())
          // Punctuation and single characters are markup, not copy: the failure icon is `!`, and
          // `·` separates the parts of a line.
          .filter((text) => text.length > 1 && /[A-Za-z]{3}/.test(text))
          .map((text) => `${path}: ${text}`),
      )
    expect(offenders).toEqual([])
  })
})
