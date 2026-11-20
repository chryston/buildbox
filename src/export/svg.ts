/**
 * A sheet as an SVG file (#61 §2).
 *
 * The tree comes from `drawing`, which is the same tree the Plan View draws on screen — that is
 * the whole point of #60, and it is why a drawing that looks right on screen looks right in a
 * file. This file adds the three things a *file* needs and a live canvas does not: a size in real
 * millimetres so a viewer prints it at one to one, provenance in a `<metadata>` element, and
 * colours that do not depend on a stylesheet the reader does not have.
 *
 * The last of those is the only rewrite done here. `STYLES` colours its lines with the app's CSS
 * custom properties, which resolve against `tokens.css` in the browser and against nothing in a
 * file opened on a phone — where `var(--bb-text)` is an invalid paint and the drawing comes out
 * black-on-black. Every `fill` and `stroke` is therefore put through the print palette, and no
 * `var(` reaches the bytes.
 */

import type { DisplayItem, DisplayList } from '../drawing'
import type { SvgNode } from '../drawing'
import { serializeSvg, toSvgTree } from '../drawing'
import { dataUri } from './base64'
import type { Sheet } from './fit'
import { SHEET_SIZING } from './sheet'
import { provenanceJson, type Provenance } from './provenance'
import { resolveColour } from './palette'
import type { AssetBytes } from './types'

/** The attributes that can carry a colour, and so can carry a `var(…)`. */
const PAINT_ATTRS: readonly string[] = ['fill', 'stroke']

/** One node with its paints resolved for paper. */
function resolvePaints(node: SvgNode): SvgNode {
  const attrs: [string, string][] = node.attrs.map(([key, value]) =>
    PAINT_ATTRS.includes(key) ? [key, resolveColour(value)] : [key, value],
  )
  if (node.children === undefined) return { tag: node.tag, attrs, text: node.text }
  return { tag: node.tag, attrs, children: node.children.map(resolvePaints) }
}

/**
 * The whole sheet as a tree: the sheet's size, the provenance, then the drawing's own layers.
 *
 * `width` and `height` are in millimetres, so a viewer asked to print at 100% prints the sheet at
 * its real size — the property criterion 2 measures. The `viewBox` is the whole sheet and not the
 * drawing's bounds, because on paper the furniture is part of the drawing.
 */
export function svgTree(
  sheet: Sheet,
  list: DisplayList,
  provenance: Provenance,
  assetUris: ReadonlyMap<string, string>,
): SvgNode {
  const drawing = toSvgTree(list, {
    sizing: SHEET_SIZING,
    includeRefs: false,
    resolveAsset: (hash) => assetUris.get(hash) ?? null,
  })
  const metadata: SvgNode = { tag: 'metadata', attrs: [], text: provenanceJson(provenance) }
  return {
    tag: 'svg',
    attrs: [
      ['xmlns', 'http://www.w3.org/2000/svg'],
      ['width', `${sheet.widthMm}mm`],
      ['height', `${sheet.heightMm}mm`],
      ['viewBox', `0 0 ${sheet.widthMm} ${sheet.heightMm}`],
    ],
    children: [metadata, ...(drawing.children ?? []).map(resolvePaints)],
  }
}

/** Every image hash a list draws, in the order the list draws them. */
function imageHashes(list: DisplayList): string[] {
  const found: string[] = []
  const walk = (items: readonly DisplayItem[]): void => {
    for (const item of items) {
      if (item.kind === 'image') found.push(item.assetHash)
      else if (item.kind === 'group') walk(item.items)
    }
  }
  for (const layer of list.layers) walk(layer.items)
  return found
}

/**
 * The stored bytes of every Plan Image on the sheet, as `data:` URIs.
 *
 * `drawing`'s serialiser is a pure function and `resolveAsset` is called from inside it, so the
 * only way an image can be inlined is for its bytes to be in hand beforehand. An asset the store
 * does not have is simply absent from the map, and an image with nothing to show is left out of
 * the tree rather than written with a broken `href` — which is what `drawing` already does for the
 * screen, so the two agree on what a missing asset looks like.
 *
 * An image is inlined at no more than its stored resolution: the bytes are the stored bytes,
 * untouched, which is the only way "at no more than its stored resolution" can be true.
 */
export async function inlineAssets(
  list: DisplayList,
  assets: AssetBytes | undefined,
): Promise<Map<string, string>> {
  const uris = new Map<string, string>()
  if (assets === undefined) return uris
  for (const hash of imageHashes(list)) {
    if (uris.has(hash)) continue
    const found = await assets(hash)
    if (found !== null) uris.set(hash, dataUri(found.mediaType, found.bytes))
  }
  return uris
}

/**
 * The whole sheet as bytes.
 *
 * An XML declaration and a trailing newline: the first says what these bytes are to anything that
 * sniffs them, the second lets the file be catted into a terminal without the prompt landing on
 * the last tag. Both are fixed, so both are byte-stable.
 */
export function writeSvg(
  sheet: Sheet,
  list: DisplayList,
  provenance: Provenance,
  assetUris: ReadonlyMap<string, string>,
): Uint8Array {
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n${serializeSvg(svgTree(sheet, list, provenance, assetUris))}\n`
  return new TextEncoder().encode(text)
}
