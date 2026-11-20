import type { CutListRow } from '../../derive'

interface Props {
  /** The Cut List rows of one scope — the same rows the CSV export writes (#62 criterion 8). */
  rows: readonly CutListRow[]
}

/**
 * The Cut List panel: the parts of the model, as the contract names them.
 *
 * It renders rows and nothing else. The quantities are `derive`'s, so the numbers here are the
 * numbers a `.csv` would carry for the same scope — including `Qty`, which is `qty_in_scope`:
 * what the reader is about to cut, not what one cabinet of the design needs.
 */
export default function CutListPanel({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-muted">
        No parts to show
      </div>
    )
  }

  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Cut List</h2>
      <table className="w-full border-collapse text-sm text-text-primary">
        <thead>
          <tr className="border-b border-divider text-xs text-text-muted">
            <th className="py-1 text-left">Part</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Length</th>
            <th className="py-1 text-right">Width</th>
            <th className="py-1 text-right">Thickness</th>
            <th className="py-1 pl-2 text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-divider hover:bg-surface-raised">
              <td className="py-1">{row.part}</td>
              <td className="py-1 text-right">{row.qtyInScope}</td>
              <td className="py-1 text-right">{Math.round(row.lengthMm)}</td>
              <td className="py-1 text-right">{Math.round(row.widthMm)}</td>
              <td className="py-1 text-right">{Math.round(row.thicknessMm)}</td>
              <td className="py-1 pl-2 text-left text-xs text-text-muted">{row.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
