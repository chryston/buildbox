/**
 * The URL of the Noto Sans subset a PDF embeds (#61 §7).
 *
 * A module of one line, and the line is here rather than in `./export.ts` for a build reason:
 * Vite rewrites `?url` imports into a string literal naming the asset, so whichever chunk imports
 * this file carries the font's name. Imported from `export.ts` statically, that would be the app
 * shell — and §11 says the subset belongs to the lazy `export` chunk and to nothing else.
 * `scripts/check-size-budget.mjs` fails the build if the name ever appears in the shell again.
 *
 * It is the 52 kB Latin-1 subset, not the 569 kB `NotoSans-Regular.ttf` the interface uses: a
 * drawing sets dimensions and labels, and every byte of face it embeds is a byte the reader
 * downloads with the file.
 */
import fontUrl from '../assets/fonts/NotoSans-Latin1.ttf?url'

export { fontUrl }
