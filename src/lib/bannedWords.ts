/**
 * The words #19 §12 keeps out of anything BuildBox authors (#63 criterion 3).
 *
 * The export contract bans compliance and engineering language from every string the
 * product writes — a sheet, a dialog, a preset name — because BuildBox has measured
 * nothing about the reader's flat and has no authority to promise anything about it. The
 * list lives here, in the innermost module, so that every check reads the same words: the
 * scan of the preset pack in `domain/presets`, and the CI scan over shipped strings that #66
 * adds. One list, imported rather than copied — a second copy is a second list, and the two
 * drift the first time one is widened. (`ui/strings` still carries its own eight of these,
 * because #20 §2 keeps `lib` out of `ui`; #66's scan covers that copy with this list.)
 *
 * Two of these are ordinary English in a developer's sentence and a promise in a user's.
 * `must` and `required` state an obligation BuildBox cannot impose; `code` and `structural`
 * imply a building code and a structural system, which is the engineering claim the whole
 * list exists to keep out. `sized for`, `rated`, `certified` and `engineered` are the same
 * claim in softer words, and `cannot span`, `requires propping` and `accept risk` are the
 * conclusions a professional draws and BuildBox must not.
 */

/** Every banned word or phrase, as #19 §12 lists them. */
export const BANNED_WORDS: readonly string[] = [
  'compliant',
  'compliance',
  'safe',
  'rated',
  'approved',
  'certified',
  'code',
  'to code',
  'engineered',
  'structural',
  'sized for',
  'must',
  'required',
  'unsupported',
  'cannot span',
  'requires propping',
  'accept risk',
  'load-bearing',
]

/**
 * Does `text` use `word` as a whole word, in any case?
 *
 * Whole-word, so a name like `Enclosed` is not failed for `code`. Every entry of the list
 * below is plain text with no character a `RegExp` reads specially, so it is dropped into
 * the pattern as it stands. A caller that wants stricter rules — the preset pack fails on
 * `code` as a substring too — applies them on top of this rather than widening the list.
 */
export const mentionsWord = (text: string, word: string): boolean =>
  new RegExp(`\\b${word}\\b`, 'i').test(text)

/** The banned words one string says, so a test can name them instead of failing blind. */
export const bannedWordsIn = (text: string): string[] => BANNED_WORDS.filter((word) => mentionsWord(text, word))
