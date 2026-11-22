import { readFileSync, readdirSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import projectFixture from '../../../fixtures/domain/v1/project-basic.json?raw'
import { quantities } from '../../derive'
import type { QuantityScope } from '../../derive'
import { CUT_LIST_TABLE, writeCsv } from '../../export'
import { parseCsv } from '../../export/testing'
import { migrateProject } from '../../domain'
import type { Project } from '../../domain'
import CutListPanel from './CutListPanel'

// The fixture envelope is `{ domainSchemaVersion, project }`, and it is migrated the way `derive`'s
// own fixture reader migrates it (#42 §5): a derivation is tested against the data the app holds,
// not against whatever shape the file happens to be saved in — and a v1 file has no Openings or
// Rooms at all, which the effective model of #69 §5 reads like anything else. Read as raw text
// because a jsdom module has no URL to resolve: `derive`'s `basicProject()` calls
// `fileURLToPath(import.meta.url)`, and here that throws.
const envelope: { domainSchemaVersion: number; project: unknown } = JSON.parse(projectFixture)
let issued = 0
const migrated = migrateProject(envelope.project, envelope.domainSchemaVersion, (count) =>
  Array.from({ length: count }, () => `view-${String((issued += 1))}`))
if (!migrated.ok) throw new Error(migrated.error.message)
const project: Project = migrated.project

/** The scope the Sidebar shows: the first Floor, the Existing Model, every layer. */
const scope: QuantityScope = {
  floorIds: [project.floors[0]!.id],
  designOptionIds: 'existing-only',
  renovationStates: ['existing'],
  drawingLayers: 'all',
}

describe('CutListPanel', () => {
  it('renders an empty state when there are no entries', () => {
    render(<CutListPanel rows={[]} />)

    expect(screen.getByText('No parts to show')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the rows the CSV export writes for the same Project (#62 criterion 8)', () => {
    const rows = quantities(project, 1, scope).cuts
    expect(rows.length).toBeGreaterThan(0)
    render(<CutListPanel rows={rows} />)

    // The file's own column order, read off the table it was written from by row key: the panel
    // shows six of the fourteen columns, and which six is the contract's business, not this
    // test's.
    const at = Object.fromEntries(CUT_LIST_TABLE.columns.map((column, position) => [column.key, position] as [string, number]))
    const [, ...written] = parseCsv(writeCsv(CUT_LIST_TABLE, rows)).rows
    const shown = screen.getAllByRole('row').slice(1)
    expect(shown).toHaveLength(written.length)
    shown.forEach((tr, index) => {
      const cells = within(tr).getAllByRole('cell').map((cell) => cell.textContent ?? '')
      const file = written[index]!
      const cell = (key: string): string => file[at[key]!]!
      expect(cells[0]).toBe(cell('part'))
      expect(cells[5]).toBe(cell('notes'))
      // The quantities are the file's. The sizes are the file's sizes read at the whole
      // millimetre the panel displays — the file carries three decimals and the sidebar does not,
      // which is a difference of display and not of the row underneath it.
      expect(Number(cells[1])).toBe(Number(cell('qtyInScope')))
      expect(Number(cells[2])).toBe(Math.round(Number(cell('lengthMm'))))
      expect(Number(cells[3])).toBe(Math.round(Number(cell('widthMm'))))
      expect(Number(cells[4])).toBe(Math.round(Number(cell('thicknessMm'))))
    })
  })

  it('labels the columns the contract names them, not the legacy W/H/D', () => {
    render(<CutListPanel rows={quantities(project, 1, scope).cuts} />)
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((each) => each.textContent)
    expect(headers).toEqual(['Part', 'Qty', 'Length', 'Width', 'Thickness', 'Notes'])
  })
})

// The other half of criterion 8: a view renders the rows `derive` derived, it does not run the
// cut-list engine over the model. `src/components` is legacy code and may still import `cabinet`
// for its types, so the boundary is stated here rather than left to the folder's allow-list.
const VIEW_FOLDERS = ['src/ui', 'src/components']
const CUT_LIST_FUNCTIONS = ['computeCutListForUnits', 'computeCutListForUnit']
const IMPORT_FROM_CABINET = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"][^'"]*\/cabinet(?:\/index)?['"]/g

describe('the views', () => {
  it('never ask cabinet for a cut list (#62 criterion 8)', () => {
    const files = VIEW_FOLDERS.flatMap((folder) =>
      readdirSync(folder, { recursive: true, encoding: 'utf8' })
        .filter((name) => /\.(ts|tsx)$/.test(name))
        .map((name) => `${folder}/${name}`),
    )
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_FROM_CABINET)) {
        const names = (match[1] ?? '').split(',').map((each) => each.trim().replace(/^type\s+/, ''))
        for (const banned of CUT_LIST_FUNCTIONS) {
          expect(names, `${file} imports ${banned} from cabinet`).not.toContain(banned)
        }
      }
    }
  })
})
