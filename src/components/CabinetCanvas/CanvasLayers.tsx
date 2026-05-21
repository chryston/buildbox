import type { LayoutDivider, LayoutPanel, LayoutVoid } from '../../types'
import { MATERIALS } from '../../utils/materials'

interface Props {
  panels: LayoutPanel[]
  voids: LayoutVoid[]
  dividers: LayoutDivider[]
  selectedId: string | null
  onSelectVoid: (id: string) => void
  onSelectDivider: (id: string) => void
}

export default function CanvasLayers({
  panels,
  voids,
  dividers,
  selectedId,
  onSelectVoid,
  onSelectDivider,
}: Props) {
  return (
    <>
      <g data-layer="panels">
        {panels.map((p) => (
          <rect
            key={p.id}
            x={p.x}
            y={p.y}
            width={p.w}
            height={p.h}
            fill={MATERIALS[p.material].fill}
            stroke={MATERIALS[p.material].stroke}
            strokeWidth={1}
          />
        ))}
      </g>

      <g data-layer="voids">
        {voids.map((v) => (
          <rect
            key={v.nodeId}
            data-testid={`void-${v.nodeId}`}
            x={v.x}
            y={v.y}
            width={v.w}
            height={v.h}
            fill={v.nodeId === selectedId ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.03)'}
            stroke={v.nodeId === selectedId ? '#7c3aed' : 'transparent'}
            strokeWidth={2}
            cursor="pointer"
            onClick={() => onSelectVoid(v.nodeId)}
          />
        ))}
      </g>

      <g data-layer="dividers">
        {dividers.map((d) => (
          <rect
            key={d.nodeId}
            data-testid={`divider-${d.nodeId}`}
            x={d.x}
            y={d.y}
            width={d.w}
            height={d.h}
            fill={MATERIALS[d.material].fill}
            stroke={d.childAId === selectedId ? '#7c3aed' : MATERIALS[d.material].stroke}
            strokeWidth={d.childAId === selectedId ? 2 : 1}
            cursor="pointer"
            onClick={() => onSelectDivider(d.childAId)}
          />
        ))}
      </g>

      <g data-layer="accessories">
        {voids.map((v) => (
          <g key={v.nodeId}>
            {v.elementType === 'drawer' && (
              <g>
                <rect
                  x={v.x + 6}
                  y={v.y + 6}
                  width={v.w - 12}
                  height={v.h - 12}
                  fill="none"
                  stroke="#7c3aed"
                  strokeWidth={1.5}
                  rx={2}
                />
                <circle cx={v.x + v.w / 2} cy={v.y + v.h / 2} r={4} fill="#7c3aed" />
              </g>
            )}
            {(v.accessories ?? []).map((a) => (
              <g key={a.id}>
                {(a.type === 'door' || a.type === 'drawer-front') && (
                  <rect
                    x={v.x + 4}
                    y={v.y + 4}
                    width={v.w - 8}
                    height={v.h - 8}
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    strokeDasharray={a.type === 'drawer-front' ? '6 2' : undefined}
                    rx={2}
                  />
                )}
                {a.type === 'pull' && (
                  <rect
                    x={v.x + v.w / 2 - 10}
                    y={v.y + v.h / 2 - 1.5}
                    width={20}
                    height={3}
                    fill="#cbd5e1"
                    rx={1.5}
                  />
                )}
                {a.type === 'hinge' && (
                  <>
                    <circle cx={v.x + 6} cy={v.y + 16} r={3} fill="#cbd5e1" />
                    <circle cx={v.x + 6} cy={v.y + v.h - 16} r={3} fill="#cbd5e1" />
                  </>
                )}
              </g>
            ))}
          </g>
        ))}
      </g>
    </>
  )
}
