import { useStore } from '../../store/store'
import type { AnnotationType, FloorPlanObjectType } from '../../types'
import { OBJECT_CATALOG, OBJECT_CATEGORIES } from '../../data/floorPlanObjects'

interface Props {
  onAddObject: (type: FloorPlanObjectType) => void
  onAddCustomTemplate: (id: string) => void
  onAddCustomShape: () => void
  onSetAnnotationType: (type: AnnotationType | null) => void
  activeAnnotationType: AnnotationType | null
}

const CATEGORY_ICONS: Record<keyof typeof OBJECT_CATEGORIES, string> = {
  'Seating': '🪑',
  'Sleeping': '🛏',
  'Appliances': '🍳',
  'Bathroom': '🚿',
  'Lighting & Other': '💡',
  'Carpentry': '🏗',
}

export default function FloorPlanSidebar({ onAddObject, onAddCustomTemplate, onAddCustomShape, onSetAnnotationType, activeAnnotationType }: Props) {
  const customTemplates = useStore(s => s.floorPlan.customTemplates)

  return (
    <aside className="flex w-48 flex-col overflow-y-auto border-r border-divider bg-panel text-xs">
      <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
        Object Library
      </div>

      {(Object.entries(OBJECT_CATEGORIES) as [keyof typeof OBJECT_CATEGORIES, FloorPlanObjectType[]][]).map(([category, types]) => (
        <div key={category}>
          <div className="px-3 py-1 text-xs font-semibold text-text-primary">
            <span aria-hidden="true">{CATEGORY_ICONS[category]}</span> {category}
          </div>
          {types.map(type => {
            const def = OBJECT_CATALOG.find(o => o.type === type)!
            return (
              <button
                key={type}
                type="button"
                onClick={() => onAddObject(type)}
                className="w-full px-4 py-1 text-left text-text-muted hover:bg-surface-raised hover:text-text-primary"
              >
                {def.label}
              </button>
            )
          })}
        </div>
      ))}

      <div className="mt-2 border-t border-divider px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
        Annotations
      </div>
      <button
        type="button"
        aria-pressed={activeAnnotationType === 'wall-hack' ? 'true' : 'false'}
        onClick={() => onSetAnnotationType(activeAnnotationType === 'wall-hack' ? null : 'wall-hack')}
        className={`mx-2 mb-1 rounded border px-2 py-1 text-left text-xs ${
          activeAnnotationType === 'wall-hack'
            ? 'border-red-500 bg-accent text-white'
            : 'border-red-500 text-red-400 hover:bg-surface-raised'
        }`}
      >
        🔨 <span>Wall to Hack</span>
      </button>
      <button
        type="button"
        aria-pressed={activeAnnotationType === 'tile-zone' ? 'true' : 'false'}
        onClick={() => onSetAnnotationType(activeAnnotationType === 'tile-zone' ? null : 'tile-zone')}
        className={`mx-2 mb-1 rounded border px-2 py-1 text-left text-xs ${
          activeAnnotationType === 'tile-zone'
            ? 'border-blue-500 bg-accent text-white'
            : 'border-blue-500 text-blue-400 hover:bg-surface-raised'
        }`}
      >
        🟦 <span>Floor to Tile</span>
      </button>

      <div className="mt-2 border-t border-divider px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
        Custom
      </div>
      {customTemplates.map(template => (
        <button
          key={template.id}
          type="button"
          onClick={() => onAddCustomTemplate(template.id)}
          className="mx-2 mb-1 rounded border border-divider px-2 py-1 text-left text-text-muted hover:bg-surface-raised hover:text-text-primary"
        >
          {template.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onAddCustomShape}
        className="mx-2 mb-3 rounded bg-accent py-1 text-center text-xs text-white hover:bg-accent-hover"
      >
        + Add Custom Shape
      </button>
    </aside>
  )
}
