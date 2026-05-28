import type { CutListEntry } from '../../types'

interface Props {
  entries: CutListEntry[]
}

export default function CutListPanel({ entries }: Props) {
  if (entries.length === 0) {
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
            <th className="py-1 text-right">W</th>
            <th className="py-1 text-right">H</th>
            <th className="py-1 text-right">D</th>
            <th className="py-1 pl-2 text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={index} className="border-b border-divider hover:bg-gray-50">
              <td className="py-1">{entry.label}</td>
              <td className="py-1 text-right">{entry.qty}</td>
              <td className="py-1 text-right">{Math.round(entry.width)}</td>
              <td className="py-1 text-right">{Math.round(entry.height)}</td>
              <td className="py-1 text-right">{Math.round(entry.depth)}</td>
              <td className="py-1 pl-2 text-left text-xs text-text-muted">{entry.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
