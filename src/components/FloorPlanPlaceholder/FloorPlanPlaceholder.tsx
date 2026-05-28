export default function FloorPlanPlaceholder() {
  return (
    <div className="flex flex-1 items-center justify-center bg-surface">
      <div className="text-center">
        <div className="mb-4 text-6xl">🏠</div>
        <h2 className="mb-2 text-2xl font-semibold text-text-primary">Floor Plan</h2>
        <p className="text-text-muted">Coming Soon</p>
        <p className="mt-2 max-w-xs text-sm text-text-muted">
          Design your room layout and place cabinets in a top-down view. Available in a future update.
        </p>
      </div>
    </div>
  )
}
