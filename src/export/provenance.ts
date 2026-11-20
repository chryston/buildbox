/**
 * What a file says about itself (#61 §6, export contract §9).
 *
 * The same object goes into every format: an SVG `<metadata>` element, a PDF XMP packet, a PNG
 * `iTXt` chunk, and the `manifest.json` beside a set of drawings. One builder, four carriers —
 * which is the only way criterion 1's "identical in every format" is true rather than hoped.
 *
 * What is *not* here is the point. No author, account, device, path, user agent, IP, locale,
 * time zone or file-system handle: a drawing gets emailed to a cabinet shop, and a shop should
 * not learn who owns a flat in Singapore from its metadata. `metadataPrivacy.test.ts` walks every
 * key and value rather than trusting this comment.
 *
 * The Project ID and revision *are* here, and nowhere on the drawing face: they are what makes a
 * quote traceable to the file it was priced from, and a stranger with the PDF cannot do anything
 * with them.
 */

import { canonicalJson } from '../lib'
// The export contract has one version, and `csv/tables.ts` is where it is written (#62 §5): a
// drawing and a CSV carry the same number because they read the same constant.
import { CSV_CONTRACT_VERSION } from './csv/tables'
import type { ExportDeps, ExportSnapshot, ListsRecipe, Recipe } from './types'

/**
 * The provenance of one export.
 *
 * `recipe` is the whole recipe, not a summary: a drawing that came back three years later with a
 * question on it should say what scale it was drawn at and which views were in the set.
 */
export interface Provenance {
  readonly generator: 'BuildBox'
  readonly buildbox_version: string
  readonly contract_version: string
  readonly exported_at: string
  readonly project_id: string
  readonly project_revision: number
  readonly unsaved_changes?: true
  /** Whatever the recipe was: the drawings' (#61) or the lists' (#62). */
  readonly recipe: Recipe | ListsRecipe
}

/** The provenance for one call. Nothing in it is derived from the environment. */
export function provenanceOf(
  snapshot: ExportSnapshot,
  recipe: Recipe | ListsRecipe,
  deps: Pick<ExportDeps, 'clock' | 'buildboxVersion' | 'contractVersion' | 'unsavedChanges'>,
): Provenance {
  return {
    generator: 'BuildBox',
    buildbox_version: deps.buildboxVersion,
    contract_version: deps.contractVersion ?? CSV_CONTRACT_VERSION,
    exported_at: deps.clock.now(),
    project_id: snapshot.project.id,
    project_revision: snapshot.revision,
    ...(deps.unsavedChanges === true ? { unsaved_changes: true as const } : {}),
    recipe,
  }
}

/** The provenance as canonical JSON: sorted keys, no insignificant space, byte-stable. */
export function provenanceJson(provenance: Provenance): string {
  return canonicalJson(provenance)
}

/**
 * The provenance with its timestamp removed, for the PDF `/ID`.
 *
 * The `/ID` has to survive a re-export of the same content at a different second — that is what
 * makes it a content hash and not a copy of the clock — so the one field that moves on its own is
 * dropped before hashing. Criterion 1 asserts it matches across two runs and across Worker and
 * main thread.
 */
export function provenanceForHash(provenance: Provenance): string {
  const rest: Omit<Provenance, 'exported_at'> = {
    generator: provenance.generator,
    buildbox_version: provenance.buildbox_version,
    contract_version: provenance.contract_version,
    project_id: provenance.project_id,
    project_revision: provenance.project_revision,
    ...(provenance.unsaved_changes === true ? { unsaved_changes: true as const } : {}),
    recipe: provenance.recipe,
  }
  return canonicalJson(rest)
}

/**
 * The XMP packet a PDF carries.
 *
 * A real XMP packet is an RDF graph, and a graph of one property is still a packet. The JSON goes
 * in as escaped text rather than as one RDF property per field so that the packet and the SVG
 * element cannot disagree about a value's spelling — they carry the same bytes.
 */
export function xmpPacket(provenance: Provenance): string {
  const json = provenanceJson(provenance)
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="BuildBox">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:bb="https://buildbox.app/ns/export/1.0/">',
    `<bb:ExportJSON>${escapeXml(json)}</bb:ExportJSON>`,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('')
}

/** XML text escaping, and nothing else: the JSON is already a string. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
