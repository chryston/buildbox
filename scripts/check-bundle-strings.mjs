// #53 criterion 2: the removed export paths must be gone from what ships, not merely from
// `src/`. Three strings prove which release this bundle is from: the workspace-JSON filename
// the old `Export` wrote, the floor-plan-JSON filename its sibling wrote, and the flag that
// used to choose between the two apps. None of them has a producer any more.
//
// `buildbox-store` is deliberately NOT on this list: reading the old key is the Migration
// review's job until #86, and `package/legacy` and `platform/legacySource` are allowed to name
// it. `buildbox-preview` is not either — the preview channel (#20 §11) is a mechanism this
// build still carries, and it is named by whichever flag is set, not by a flag of its own.
//
// Run as part of `npm run build`, after `vite build`.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import process from 'node:process'

const outDir = process.argv[2] ?? 'dist'
// `floor-plan.svg` is the file name the removed `Export SVG` button produced (#61 criterion 8).
// It is forbidden here so the old path cannot come back as a helper nobody thought to delete.
const FORBIDDEN = [
  '.buildbox.json',
  '-floor-plan.json',
  'floor-plan.svg',
  'VITE_FF_PROJECTS_V2',
  '__PROJECTS_V2__',
  // #69 criterion 13: the renovation Intents are registered from one module, and that module is
  // reachable only through `FF_RENOVATION`. A flag-off build that still carries the marker string
  // has shipped the renovation catalogue to production, which is the thing the flag exists to
  // prevent. A flagged build is allowed to carry it, so the check is skipped when the flag is on.
  ...(process.env['VITE_FF_RENOVATION'] === 'true' ? [] : ['__renovation_intents__']),
  // The same rule for the words: the renovation dialogs and the `Design Options` settings section
  // are dark, so a flag-off bundle that still carries their copy has shipped a surface nobody can
  // open. Two sentences prove it — one the delete review says, one the move review asks.
  ...(process.env['VITE_FF_RENOVATION'] === 'true'
    ? []
    : ['Nothing in the Existing Model changes.', 'Move to a Design Option']),
  // #70 §2: the saved-view card composes these two undo labels. A flag-off bundle carrying either
  // has shipped the card, and with it the Design Option and Renovation Display pickers.
  ...(process.env['VITE_FF_RENOVATION'] === 'true' ? [] : ['Set Design Option: ', 'Set Renovation Display: ']),
  // #70 §3: the mode bar's four sentences. They are the whole content of a dark surface, so one per
  // Display is the cheapest proof that the band — and with it the Renovation Display concept — stayed
  // out of the flag-off bundle.
  ...(process.env['VITE_FF_RENOVATION'] === 'true'
    ? []
    : [
        'Surveying the shared baseline.',
        'Marking what the option removes or replaces.',
        'Editing new work owned by the option.',
        'Everything together. All state-aware tools',
        'tools hidden in this display',
        'works in',
        'No Design Option',
        'Choose what to place from the Library menu.',
        'Select one thing to mark for demolition.',
        'display needs an active Design Option.',
        'Show Existing',
        // #70 §4: the legend under the canvas. Its two overlay labels and its note are words no
        // flag-off surface says, so they prove the row stayed out of the shipped bundle.
        'Demolition (hatch overlay)',
        'Proposed (halo overlay)',
        'Layer colour is kept underneath renovation graphics',
        // #70 §8: the candidate list beside the pointer. No flag-off surface says it.
        'click again to cycle',
        // #70 §5: the inspector's renovation block. `Move`, `Delete`, `Restore`, `Replaces` and the
        // Kind words are product vocabulary that exists flag-off, so the needles are the sentences.
        'Existing Model (shared)',
        'Nothing selected. Click an entity',
        'Proposed work is edited in Proposed or Combined display',
        'is drawn against this record',
        'Correct Existing Model…',
        'is drawn in',
        // #70 §7a, §7b: the forced choice and the danger dialog. `Cancel`, `move`, `change` and the
        // Option's own name exist flag-off, so the needles are the sentences around them.
        'belongs to the Existing Model',
        'Moving a baseline entity is never done silently',
        'add moved successor',
        'Correct Existing Model instead',
        'Cancel — change nothing',
        'Correct the shared Existing Model?',
        'retains it as Existing',
        'demolishes it (no successor)',
        'its successor stays aligned',
        'its successor keeps its own geometry',
        'Use this for measuring errors',
        'only Existing Model entities can be demolished',
        'Mark demolition:',
        // #70 §7d: the restore confirmation. `Restore` is product vocabulary that exists flag-off,
        // so the needles are the two sentences only that dialog says.
        'Removes the demolition record in',
        'Also deletes successor(s):',
        // #71 §2, §5, §8: the Drawing Layer surface. `Unlayered` is already said by the export
        // scope's layer list (#70), so the needles are the undo labels the rows compose and the
        // sentences only the layer list, its delete dialog and the read-only refusal say.
        'New Layer: ',
        'Rename Layer: ',
        'Set Layer Colour: ',
        'Reorder Layer: ',
        'Delete Layer: ',
        'Set Active Layer: ',
        'Move to Layer: ',
        'Snap to Hidden Content',
        'A layer needs a name.',
        'A layer colour is six hex digits',
        'is already at the front',
        'The order has to name every layer',
        'On this layer:',
        'will become Unlayered',
        'Nothing is on it.',
        'The Unlayered row is hidden in this view',
        'is read-only in this view',
        // #71 §3, §5: the Layers list in the saved-view card and the review behind `Delete…`.
        // `Layers`, `Unlayered`, `Active` and `Delete` are short words a flag-off surface could say by
        // accident, so the needles are the row's and the table's own sentences.
        'Layers (front first)',
        'No Drawing Layers. All content is Unlayered.',
        'Colour in this view',
        'Project default colour',
        'Use Project layer order',
        'Snap to hidden content',
        'View style override',
        'Becomes Unlayered',
        'lose their own settings',
        'stops being drawn here',
      ]),
]
// Only the files that could contain application code: an image or a font cannot.
const SCANNED = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.txt', '.map'])

if (!existsSync(outDir)) {
  console.error(`${outDir} not found — run \`vite build\` first`)
  process.exit(1)
}

function* textFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* textFiles(path)
    else if (SCANNED.has(extname(entry.name))) yield path
  }
}

const found = []
let scanned = 0
for (const file of textFiles(outDir)) {
  scanned += 1
  const text = readFileSync(file, 'utf8')
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) found.push(`${relative('.', file)} contains "${needle}"`)
  }
}

if (found.length > 0) {
  console.error(`${outDir} still ships a removed export path (${scanned} files scanned):`)
  for (const problem of found) console.error(`  ${problem}`)
  console.error('Download Backup replaced the workspace and floor-plan JSON exports at S4 (#19 §10).')
  process.exit(1)
}

console.log(`${outDir}: no removed export strings (${scanned} files scanned)`)
