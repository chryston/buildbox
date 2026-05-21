interface Props {
  overConstrainedIds: string[]
}

export default function WarningBanner({ overConstrainedIds }: Props) {
  if (overConstrainedIds.length === 0) return null

  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-xs text-amber-200"
    >
      <span>⚠</span>
      <span>
        {overConstrainedIds.length} section{overConstrainedIds.length > 1 ? 's' : ''} are over-constrained and have been
        {' '}scaled proportionally.
      </span>
    </div>
  )
}
