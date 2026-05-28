interface Props {
  overConstrainedIds: string[]
}

export default function WarningBanner({ overConstrainedIds }: Props) {
  const count = overConstrainedIds.length

  if (count === 0) return null

  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800"
    >
      <span>⚠</span>
      <span>
        {count} section{count !== 1 ? 's' : ''} {count !== 1 ? 'are' : 'is'} over-constrained and {count !== 1 ? 'have' : 'has'} been scaled proportionally.
      </span>
    </div>
  )
}
