import type { CutListEntry } from '../../types'

interface Props {
  entries: CutListEntry[]
}

export default function CutListPanel({ entries }: Props) {
  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/60">Cut List</h2>
      <table className="w-full border-collapse text-sm text-white/80">
        <thead>
          <tr className="border-b border-white/10 text-xs text-white/40">
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
            <tr key={index} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-1">{entry.label}</td>
              <td className="py-1 text-right">{entry.qty}</td>
              <td className="py-1 text-right">{Math.round(entry.width)}</td>
              <td className="py-1 text-right">{Math.round(entry.height)}</td>
              <td className="py-1 text-right">{Math.round(entry.depth)}</td>
              <td className="py-1 pl-2 text-left text-xs text-white/40">{entry.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
