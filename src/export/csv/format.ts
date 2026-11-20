/**
 * The one number formatter and the one text guard the CSV contract asks for (#62 §2,
 * export contract §6).
 *
 * Every table in the contract — these two and the element tables, the Warnings List and the
 * Comment Register that follow — writes its numbers through `formatNumber`, so a length means the
 * same digits in every file BuildBox has ever written. That is why there is one rounding rule
 * here and why `toFixed` appears nowhere: `toFixed` rounds half to even for some inputs
 * (`(1.005).toFixed(2)` is `1`, not `1.01`) and switches to an exponent above 1e21, and a
 * spreadsheet reading `1.2345675e+6` in a length cell has lost the number.
 *
 * The rule is half away from zero. It is carried out on **decimal digits** rather than by
 * multiplying by `10^dp` and dividing back, because that multiply is itself lossy: `1e21 · 1000`
 * is not `1e24` in binary floating point but 999999999999999983222784, and dividing it back
 * prints a length whose last six digits are noise. `Number.prototype.toString` already gives the
 * shortest decimal that reads back as the same number — the digits a person would have typed — so
 * this file shifts the decimal point, rounds one digit by hand, and trims. No exponent, no
 * separator, and no digit that is not the number's.
 *
 * The sign is applied at the end, from the original value: `-0` and a negative that rounded away
 * to nothing are both written `0`, and a negative that survived keeps its sign (§6).
 */

/** Decimals a `_mm` cell carries: enough to clean floating-point noise, no more (§6). */
export const LENGTH_DP = 3
/** Decimals an `area_m2` cell carries: a square millimetre on a square metre is 1e-6. */
export const AREA_DP = 6
/** Decimals a `_deg` cell carries. */
export const ANGLE_DP = 3
/** An `integer` cell has nothing after the point. */
export const INTEGER_DP = 0

/**
 * `value` at `dp` decimals, as a CSV cell: no exponent, no thousands separator, `.` as the
 * decimal point, trailing zeros trimmed, the point dropped when nothing follows it.
 *
 * @throws TypeError when `value` is not finite — a cell holding `NaN` is a file nobody can read —
 * and `RangeError` when `dp` is not a non-negative integer.
 */
export function formatNumber(value: number, dp: number): string {
  if (!Number.isFinite(value)) throw new TypeError(`not a finite number: ${String(value)}`)
  if (!Number.isInteger(dp) || dp < 0) throw new RangeError(`decimals must be a non-negative integer: ${String(dp)}`)
  // `-0 < 0` is false, which is the answer wanted: a zero is written without a sign.
  const sign = value < 0 ? '-' : ''
  const { whole, fraction } = decimalDigits(Math.abs(value).toString())
  const unsigned = roundDigits(whole, fraction, dp)
  return sign === '' || unsigned === '0' ? unsigned : `${sign}${unsigned}`
}

/**
 * A text cell a spreadsheet will display instead of act on (§6).
 *
 * A cell whose first character is `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`, so a design
 * named `=SUM(A1:A9)` arrives as text. Only `text` cells are touched: `id`, `enum` and `multi`
 * cells are machine-readable codes that a reader has to be able to compare byte for byte, and a
 * numeric cell is never prefixed at all — a negative length is a real negative length, not an
 * injection.
 */
export function neutralise(text: string): string {
  return FORMULA_LEAD.test(text) ? `'${text}` : text
}

const FORMULA_LEAD = /^[=+\-@\t\r]/

/** A field as RFC 4180 wants it: quoted when it holds a comma, a quote, CR or LF. */
export function quote(field: string): string {
  return NEEDS_QUOTES.test(field) ? `"${field.replace(/"/g, '""')}"` : field
}

const NEEDS_QUOTES = /[",\r\n]/

/**
 * The digits of a `toString` result, either side of where the decimal point belongs.
 *
 * `toString` reaches for exponent notation below 1e-6 and at or above 1e21, so both forms are
 * expanded rather than approximated: the small end still rounds to `0.000001` at six decimals,
 * and the large end is a whole number a length cell has to print in full.
 */
function decimalDigits(decimal: string): { whole: string; fraction: string } {
  const [mantissa = '0', exponent = ''] = decimal.split('e')
  const digits = mantissa.replace('.', '')
  const point = (mantissa.includes('.') ? mantissa.indexOf('.') : digits.length) + Number(exponent || '0')
  if (point <= 0) return { whole: '0', fraction: `${'0'.repeat(-point)}${digits}` }
  if (point >= digits.length) return { whole: digits.padEnd(point, '0'), fraction: '' }
  return { whole: digits.slice(0, point), fraction: digits.slice(point) }
}

/**
 * `whole.fraction` to `dp` decimals, the last kept digit rounded up when the next one is 5 or
 * more — which is half away from zero, because the sign is not here to be away from.
 */
function roundDigits(whole: string, fraction: string, dp: number): string {
  const source = fraction.padEnd(dp + 1, '0')
  const kept = source.slice(0, dp)
  // The digit after the last kept one decides: 5 or more goes up, which is half away from zero
  // because the sign is not here to be away from.
  const digits = Number(source[dp]) >= 5 ? carry(`${whole}${kept}`) : `${whole}${kept}`
  const unsigned = digits.slice(0, digits.length - dp) || '0'
  const decimals = digits.slice(digits.length - dp).replace(/0+$/, '')
  return decimals === '' ? unsigned : `${unsigned}.${decimals}`
}

/**
 * `digits` plus one in its last place, carrying through the nines and growing when they are all
 * nines: `999999999` is `1000000000`, and `0999` is `1000`.
 */
function carry(digits: string): string {
  const out = digits.split('')
  let index = out.length - 1
  while (index >= 0 && out[index] === '9') {
    out[index] = '0'
    index -= 1
  }
  if (index < 0) return `1${out.join('')}`
  out[index] = String(Number(out[index]) + 1)
  return out.join('')
}
