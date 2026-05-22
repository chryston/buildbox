import { useEffect, useState } from 'react'
import CutListPanel from '../CutListPanel/CutListPanel'
import type {
  AccessoryType,
  CabinetNode,
  CutListEntry,
  DrawerConfig,
  ElementType,
  MaterialId,
  SlideType,
} from '../../types'
import { MATERIALS } from '../../utils/materials'

interface Props {
  cutList?: CutListEntry[]
  selectedId: string | null
  selectedNode: CabinetNode | null
  onAddShelf: (id: string) => void
  onAddDivider: (id: string) => void
  onDelete: (id: string) => void
  onToggleLock: (id: string) => void
  onSetMaterial: (id: string, mat: MaterialId) => void
  onSetElementType: (id: string, type: ElementType) => void
  onSetDrawerConfig: (id: string, config: DrawerConfig) => void
  onAddAccessory: (nodeId: string, type: AccessoryType) => void
  onRemoveAccessory: (nodeId: string, accessoryId: string) => void
}

const ELEMENT_TYPES: ElementType[] = ['void', 'drawer', 'hanging-space']
const ELEMENT_TYPE_LABELS: Record<ElementType, string> = {
  void: 'Empty',
  drawer: 'Drawer',
  'hanging-space': 'Hanging Space',
}

function Btn({
  label,
  onClick,
  disabled = false,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left px-3 py-2 rounded text-sm bg-panel hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  )
}

export default function Sidebar({
  cutList = [],
  selectedId,
  selectedNode,
  onAddShelf,
  onAddDivider,
  onDelete,
  onToggleLock,
  onSetMaterial,
  onSetElementType,
  onSetDrawerConfig,
  onAddAccessory,
  onRemoveAccessory,
}: Props) {
  const isVoid = !selectedNode?.splitAxis
  const isLocked = selectedNode?.locked ?? false
  const [revealStr, setRevealStr] = useState(String(selectedNode?.drawerConfig?.reveal ?? 3))

  useEffect(() => {
    if (selectedNode?.drawerConfig) {
      setRevealStr(String(selectedNode.drawerConfig.reveal))
    }
  }, [selectedId, selectedNode?.drawerConfig?.reveal])

  return (
    <aside className="w-60 flex flex-col bg-panel border-l border-white/10 overflow-y-auto">
      <div className="flex flex-col gap-1 p-3">
        <p className="text-xs text-white/40 uppercase tracking-wide mb-1">Actions</p>
        <Btn
          label="Add Shelf"
          disabled={!selectedId || !isVoid}
          onClick={() => selectedId && onAddShelf(selectedId)}
        />
        <Btn
          label="Add Divider"
          disabled={!selectedId || !isVoid}
          onClick={() => selectedId && onAddDivider(selectedId)}
        />
        <Btn
          label="Delete"
          disabled={!selectedId}
          onClick={() => selectedId && onDelete(selectedId)}
        />
        {selectedId && (
          <Btn
            label={isLocked ? '🔒 Locked – click to unlock' : '🔓 Unlocked – click to lock'}
            onClick={() => selectedId && onToggleLock(selectedId)}
          />
        )}
      </div>

      {selectedId && (
        <div className="p-3 border-t border-white/10">
          <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Material</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(MATERIALS) as MaterialId[]).map((key) => (
              <button
                key={key}
                type="button"
                title={MATERIALS[key].label}
                aria-label={MATERIALS[key].label}
                onClick={() => onSetMaterial(selectedId, key)}
                className={`w-8 h-8 rounded-full border-2 ${selectedNode?.material === key ? 'border-accent' : 'border-transparent'}`}
                style={{ backgroundColor: MATERIALS[key].fill }}
              />
            ))}
          </div>
        </div>
      )}

      {selectedId && (
        <div className="p-3 border-t border-white/10">
          <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Element Type</p>
          <div className="flex flex-col gap-1">
            {ELEMENT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onSetElementType(selectedId, t)}
                className={`text-left px-3 py-1.5 rounded text-sm ${selectedNode?.elementType === t ? 'bg-accent text-white' : 'bg-panel hover:bg-white/10 text-white/70'}`}
              >
                {ELEMENT_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedId && selectedNode?.elementType === 'drawer' && selectedNode.drawerConfig && (
        <div className="p-3 border-t border-white/10">
          <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Drawer Config</p>
          <label className="flex items-center gap-2 text-sm text-white/80 mb-2">
            Slide type
            <select
              value={selectedNode.drawerConfig.slideType}
              onChange={(e) =>
                onSetDrawerConfig(selectedId, {
                  ...selectedNode.drawerConfig!,
                  slideType: e.target.value as SlideType,
                })
              }
              className="bg-surface border border-white/20 rounded px-1 py-0.5 text-white text-sm"
            >
              <option value="side-mount">Side-mount</option>
              <option value="undermount">Undermount</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-white/80">
            Reveal (mm)
            <input
              type="number"
              value={revealStr}
              onChange={(e) => setRevealStr(e.target.value)}
              onBlur={() => {
                const value = Number.parseFloat(revealStr)
                if (!Number.isNaN(value) && value >= 0 && selectedNode?.drawerConfig) {
                  onSetDrawerConfig(selectedId, {
                    ...selectedNode.drawerConfig,
                    reveal: value,
                  })
                }
              }}
              className="w-16 bg-surface border border-white/20 rounded px-1 py-0.5 text-white text-sm text-right"
            />
          </label>
        </div>
      )}

      {selectedId && (
        <section className="border-t border-white/10 p-3">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-white/40">Accessories</h3>
          <div className="mb-2 flex flex-wrap gap-1">
            {(['door', 'drawer-front', 'pull', 'hinge'] as AccessoryType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onAddAccessory(selectedId, type)}
                className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/70 hover:bg-white/20"
              >
                + {type}
              </button>
            ))}
          </div>
          {(selectedNode?.accessories ?? []).map((acc) => (
            <div key={acc.id} className="flex items-center justify-between py-0.5 text-xs text-white/60">
              <span>{acc.label ?? acc.type}</span>
              <button
                type="button"
                onClick={() => onRemoveAccessory(selectedId, acc.id)}
                aria-label={`Remove ${acc.label ?? acc.type}`}
                className="text-white/30 hover:text-white/70"
              >
                ✕
              </button>
            </div>
          ))}
        </section>
      )}
      <details className="border-t border-white/10">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/40">
          Cut List ({cutList.length} parts)
        </summary>
        <div className="max-h-64 overflow-y-auto">
          <CutListPanel entries={cutList} />
        </div>
      </details>
    </aside>
  )
}
