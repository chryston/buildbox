import { useEffect, useState } from 'react'
import CutListPanel from '../CutListPanel/CutListPanel'
import UnitSelector from './UnitSelector'
import type {
  AccessoryType,
  CabinetMaterialId,
  CabinetNode,
  CabinetUnit,
  CutListEntry,
  DrawerConfig,
  ElementType,
  LayoutVoid,
  SlideType,
} from '../../types'
import { MATERIALS } from '../../utils/materials'

interface Props {
  cutList?: CutListEntry[]
  selectedId: string | null
  selectedNode: CabinetNode | null
  selectedVoid?: LayoutVoid | null
  evenH?: number | null
  currentMaterial?: CabinetMaterialId
  onAddShelf: (id: string) => void
  onAddDivider: (id: string) => void
  onDelete: (id: string) => void
  onToggleLock: (id: string) => void
  onSetCabinetMaterial: (mat: CabinetMaterialId) => void
  onDistributeEvenly?: (columnRootId: string, evenH: number) => void
  onSetElementType: (id: string, type: ElementType) => void
  onSetDrawerConfig: (id: string, config: DrawerConfig) => void
  onAddAccessory: (nodeId: string, type: AccessoryType) => void
  onRemoveAccessory: (nodeId: string, accessoryId: string) => void
  // Multi-unit props (optional for backward compatibility)
  units?: CabinetUnit[]
  activeUnitId?: string | null
  onAddUnit?: () => void
  onRemoveUnit?: (unitId: string) => void
  onSelectUnit?: (unitId: string) => void
  onRenameUnit?: (unitId: string, label: string) => void
}

const ELEMENT_TYPES: ElementType[] = ['void', 'drawer', 'hanging-space', 'microwave']
const ELEMENT_TYPE_LABELS: Record<ElementType, string> = {
  void: 'Empty',
  drawer: 'Drawer',
  'hanging-space': 'Hanging Space',
  microwave: 'Microwave',
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
      className="w-full text-left px-3 py-2 rounded text-sm bg-panel hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed border border-divider text-text-primary"
    >
      {label}
    </button>
  )
}

export default function Sidebar({
  cutList = [],
  selectedId,
  selectedNode,
  selectedVoid = null,
  evenH = null,
  currentMaterial = 'oak',
  onAddShelf,
  onAddDivider,
  onDelete,
  onToggleLock,
  onSetCabinetMaterial,
  onDistributeEvenly,
  onSetElementType,
  onSetDrawerConfig,
  onAddAccessory,
  onRemoveAccessory,
  units = [],
  activeUnitId = null,
  onAddUnit = () => {},
  onRemoveUnit = () => {},
  onSelectUnit = () => {},
  onRenameUnit = () => {},
}: Props) {
  const grouped = cutList.reduce<Record<string, { label: string; entries: CutListEntry[] }>>((acc, e) => {
    if (!acc[e.unitId]) acc[e.unitId] = { label: e.unitLabel, entries: [] }
    acc[e.unitId].entries.push(e)
    return acc
  }, {})
  const isVoid = !selectedNode?.splitAxis
  const isLocked = selectedNode?.locked ?? false
  const [revealStr, setRevealStr] = useState(String(selectedNode?.drawerConfig?.reveal ?? 3))

  useEffect(() => {
    if (selectedNode?.drawerConfig) {
      setRevealStr(String(selectedNode.drawerConfig.reveal))
    }
  }, [selectedId, selectedNode?.drawerConfig?.reveal])

  return (
    <aside className="w-60 flex flex-col bg-panel border-l border-divider overflow-y-auto">
      <UnitSelector
        units={units}
        activeUnitId={activeUnitId}
        onSelect={onSelectUnit}
        onAdd={onAddUnit}
        onRemove={onRemoveUnit}
        onRename={onRenameUnit}
      />

      {/* Global material swatch — always visible */}
      <div className="p-3 border-b border-divider">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Material</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(MATERIALS) as CabinetMaterialId[]).map((key) => (
            <button
              key={key}
              type="button"
              title={MATERIALS[key].label}
              aria-label={MATERIALS[key].label}
              onClick={() => onSetCabinetMaterial(key)}
              className={`w-8 h-8 rounded-full border-2 ${currentMaterial === key ? 'border-accent' : 'border-transparent'}`}
              style={{ backgroundColor: MATERIALS[key].fill }}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1 p-3">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Actions</p>
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
        {selectedVoid?.columnRootId && evenH !== null && onDistributeEvenly && (
          <button
            type="button"
            onClick={() => onDistributeEvenly(selectedVoid.columnRootId!, evenH!)}
            className="w-full text-left px-3 py-1.5 text-sm bg-panel hover:bg-gray-100 rounded border border-divider text-text-primary"
          >
            Even Space
          </button>
        )}
      </div>

      {selectedId && (
        <div className="p-3 border-t border-divider">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Element Type</p>
          <div className="flex flex-col gap-1">
            {ELEMENT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onSetElementType(selectedId, t)}
                className={`text-left px-3 py-1.5 rounded text-sm ${selectedNode?.elementType === t ? 'bg-accent text-white' : 'bg-panel hover:bg-gray-100 text-text-muted'}`}
              >
                {ELEMENT_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedId && selectedNode?.elementType === 'drawer' && selectedNode.drawerConfig && (
        <div className="p-3 border-t border-divider">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Drawer Config</p>
          <label className="flex items-center gap-2 text-sm text-text-muted mb-2">
            Slide type
            <select
              value={selectedNode.drawerConfig.slideType}
              onChange={(e) =>
                onSetDrawerConfig(selectedId, {
                  ...selectedNode.drawerConfig!,
                  slideType: e.target.value as SlideType,
                })
              }
              className="bg-white border border-divider rounded px-1 py-0.5 text-text-primary text-sm"
            >
              <option value="side-mount">Side-mount</option>
              <option value="undermount">Undermount</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-text-muted">
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
              className="w-16 bg-white border border-divider rounded px-1 py-0.5 text-text-primary text-sm text-right"
            />
          </label>
        </div>
      )}

      {selectedId && (
        <section className="border-t border-divider p-3">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-text-muted">Accessories</h3>
          <div className="mb-2 flex flex-wrap gap-1">
            {(['door', 'drawer-front', 'pull', 'hinge'] as AccessoryType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onAddAccessory(selectedId, type)}
                className="rounded bg-gray-100 px-2 py-0.5 text-xs text-text-muted hover:bg-gray-200"
              >
                + {type}
              </button>
            ))}
          </div>
          {(selectedNode?.accessories ?? []).map((acc) => (
            <div key={acc.id} className="flex items-center justify-between py-0.5 text-xs text-text-muted">
              <span>{acc.label ?? acc.type}</span>
              <button
                type="button"
                onClick={() => onRemoveAccessory(selectedId, acc.id)}
                aria-label={`Remove ${acc.label ?? acc.type}`}
                className="text-text-muted hover:text-text-primary"
              >
                ✕
              </button>
            </div>
          ))}
        </section>
      )}
      <details className="border-t border-divider">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Cut List ({cutList.length} parts)
        </summary>
        <div className="max-h-64 overflow-y-auto">
          {Object.entries(grouped).map(([unitId, { label, entries }]) => (
            <div key={unitId}>
              {Object.keys(grouped).length > 1 && (
                <p className="text-xs font-semibold text-text-muted mt-2 mb-1 px-4">{label}</p>
              )}
              <CutListPanel entries={entries} />
            </div>
          ))}
          {cutList.length === 0 && <CutListPanel entries={[]} />}
        </div>
      </details>
    </aside>
  )
}
