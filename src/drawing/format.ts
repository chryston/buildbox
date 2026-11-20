/**
 * The one way a number becomes text in a drawing (#58 §8, #60 criterion 13).
 *
 * Millimetres to three decimals: a micrometre, and never `-0`. The rounding is what
 * `pathToCommands` used to write path data with, for the same reason — a float64 sum printed in
 * full is seventeen characters of noise that changes when nothing moved. What this adds is the
 * exponent: past 1e21 both `String` and `toFixed` switch to `1e+30`, which is not a number SVG
 * can read, and a golden file that differs by one scientific notation is a diff nobody can
 * review. A value that large is an integer already, so `BigInt` can spell it out.
 *
 * It lives here rather than beside the commands or beside the SVG writer because both need it
 * and neither may own it: a coordinate in a `transform` and a coordinate in a `d` have to be
 * spelled identically, or the two surfaces drift by the last decimal place and nobody can tell
 * which one moved.
 */
export const mmText = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000
  const plain = Object.is(rounded, -0) ? 0 : rounded
  const text = Math.abs(plain) >= 1e21 ? BigInt(plain).toString() : String(plain)
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}
