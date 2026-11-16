// THROWAWAY PROTOTYPE — Plan View Range, Elevation Views, and vertical editing (ticket #29).
// Three fundamentally different single-Floor variants, switchable with ?variant=A|B|C:
//   A · Split plan + elevation, docked range gauge, square drag handles
//   B · Mode tabs + floating range chip + magnetic edge drag + warning rail
//   C · Aligned section strip under plan, ruler stops in inspector, nudge buttons
// One Floor, local X/Y, Floor Datum Z=0. In-memory only. No 3D renderer, no cross-floor anything.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Variant = 'A' | 'B' | 'C'
const variantNames: Record<Variant, string> = { A: 'Split view + docked gauge', B: 'Mode tabs + floating chips', C: 'Aligned section strip + ruler' }

/* ---------- scene (canonical mm, floor-local; Floor Datum Z = 0) ---------- */
type Kind = 'Wall' | 'Opening' | 'Placed Item' | 'Beam' | 'Service' | 'Skirting'
type Ent = { id: string; label: string; kind: Kind; x: number; y: number; w: number; h: number; bottom: number; height: number; design?: string; host?: string; service?: string }
type Design = { id: string; label: string; height: number }

const UPPER_LIMIT = 2600 // Floor upper coordination limit; lower limit unset
const initialEnts: Ent[] = [
  { id: 'w1', label: 'Wall W-1', kind: 'Wall', x: 400, y: 100, w: 4200, h: 120, bottom: 0, height: 2600 },
  { id: 'w2', label: 'Wall W-2', kind: 'Wall', x: 400, y: 100, w: 120, h: 2800, bottom: 0, height: 2600 },
  { id: 'w3', label: 'Wall W-3', kind: 'Wall', x: 4480, y: 100, w: 120, h: 2800, bottom: 0, height: 2600 },
  { id: 'w4', label: 'Wall W-4', kind: 'Wall', x: 400, y: 2780, w: 2200, h: 120, bottom: 0, height: 2600 },
  { id: 'win1', label: 'Window WND-1', kind: 'Opening', x: 1800, y: 100, w: 1500, h: 120, bottom: 900, height: 1200, host: 'w1' },
  { id: 'b1', label: 'Base cabinet #1', kind: 'Placed Item', x: 700, y: 220, w: 1200, h: 600, bottom: 0, height: 860, design: 'base860' },
  { id: 'b2', label: 'Base cabinet #2', kind: 'Placed Item', x: 3260, y: 220, w: 1200, h: 600, bottom: 0, height: 860, design: 'base860' },
  { id: 'wc1', label: 'Wall cabinet #1', kind: 'Placed Item', x: 700, y: 220, w: 1200, h: 350, bottom: 1500, height: 700, design: 'wall600' },
  { id: 'bm1', label: 'Beam B-1', kind: 'Beam', x: 1000, y: 100, w: 200, h: 2800, bottom: 2160, height: 300 },
  { id: 'sv1', label: 'Service E 80×60', kind: 'Service', x: 400, y: 2470, w: 4200, h: 80, bottom: 2620, height: 60, service: 'E 80×60' },
  { id: 'sv2', label: 'Service D O100', kind: 'Service', x: 4280, y: 220, w: 100, h: 2000, bottom: -150, height: 100, service: 'D O100' },
  { id: 'sk1', label: 'Skirting SK-1', kind: 'Skirting', x: 520, y: 220, w: 1480, h: 15, bottom: 0, height: 100, host: 'w1' },
]
const initialDesigns: Design[] = [
  { id: 'base860', label: 'Base cabinet 860', height: 860 },
  { id: 'wall600', label: 'Wall cabinet 600', height: 700 },
]

const topOf = (e: { bottom: number; height: number }) => e.bottom + e.height
const fmt = (mm: number) => `${Math.round(mm)} mm`
const PLAN = { x: 300, y: 0, w: 4400, h: 3000 }
const ELEV = { x: 300, zMin: -300, zMax: 2900 }

/* ---------- derived: range styling, elevation band, warnings ---------- */
type RangeStyle = 'primary' | 'overhead' | 'below'
function rangeStyle(e: Ent, lo: number, hi: number): RangeStyle {
  if (topOf(e) <= lo) return 'below'
  if (e.bottom >= hi) return 'overhead'
  return 'primary'
}
type Elev = { lineY: number; depth: number }
const inBand = (e: Ent, v: Elev) => e.y <= v.lineY && e.y + e.h >= v.lineY - v.depth

type Warning = { id: string; text: string; ents: string[] }
const WARN_PAIRS: Record<string, true> = { 'Beam|Placed Item': true, 'Placed Item|Service': true, 'Placed Item|Skirting': true, 'Placed Item|Placed Item': true }
function computeWarnings(ents: Ent[]): Warning[] {
  const ws: Warning[] = []
  const planOv = (a: Ent, b: Ent) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const planOvY = (a: Ent, b: Ent) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  for (let i = 0; i < ents.length; i++) for (let j = i + 1; j < ents.length; j++) {
    const a = ents[i], b = ents[j]
    if (!([a.kind, b.kind].sort().join('|') in WARN_PAIRS)) continue
    const vo = Math.min(topOf(a), topOf(b)) - Math.max(a.bottom, b.bottom)
    const po = planOv(a, b), qo = planOvY(a, b)
    if (vo <= 0 || po <= 0 || qo <= 0) continue
    if (a.kind === 'Skirting' || b.kind === 'Skirting') {
      const sk = a.kind === 'Skirting' ? a : b, it = a.kind === 'Skirting' ? b : a
      ws.push({ id: `${sk.id}~${it.id}`, text: `${sk.label} projects ${fmt(Math.min(po, qo))} into ${it.label}’s footprint.`, ents: [sk.id, it.id] })
    } else {
      ws.push({ id: `${a.id}~${b.id}`, text: `${a.label} overlaps ${b.label} by ${fmt(vo)}.`, ents: [a.id, b.id] })
    }
  }
  for (const e of ents) {
    if (topOf(e) > UPPER_LIMIT) ws.push({ id: `${e.id}~limit-top`, text: `${e.label} top is ${fmt(topOf(e) - UPPER_LIMIT)} above this Floor’s upper limit.`, ents: [e.id] })
  }
  return ws
}

/* ---------- vertical snapping ---------- */
const SNAP_TOL = 30
function snapV(v: number, targets: { v: number; label: string }[]): { v: number; label?: string } {
  let best: { v: number; label: string } | null = null
  for (const t of targets) if (!best || Math.abs(v - t.v) < Math.abs(v - best.v)) best = t
  return best && Math.abs(v - best.v) <= SNAP_TOL ? { v: best.v, label: best.label } : { v }
}

/* ---------- scenarios ---------- */
const SCENARIOS = [
  { id: 'range', label: 'Plan View Range styling', hint: 'Range 0–1200: overhead dashed, below faded' },
  { id: 'cycle', label: 'Click-to-cycle overlap', hint: 'Wall cabinet over base cabinet, badge 2/2' },
  { id: 'elevation', label: 'Numeric + drag elevation', hint: 'Wall cabinet selected — Base/Top fields + drag handles' },
  { id: 'section', label: 'Finite-depth section', hint: 'Section line + far edge dragged on plan pull in the service' },
  { id: 'shared', label: 'Shared Item Design height', hint: 'Base cabinet 860 → 920, 2 placements preview' },
  { id: 'snap', label: 'Vertical snapping', hint: 'Mid-drag ghost snapping to Base cabinet #1 top 860' },
  { id: 'warning', label: 'Warnings + Seen', hint: 'One warning acknowledged, rest open' },
] as const
type Scenario = (typeof SCENARIOS)[number]['id']

/* ---------- model ---------- */
type Drag = { mode: 'top' | 'bottom' | 'body' | 'line' | 'depth' | 'gauge-lo' | 'gauge-hi' | 'section2'; id?: string; z0: number; x0: number; y0: number; orig: Ent | null; moved: boolean }
function useRangeModel() {
  const [ents, setEnts] = useState(initialEnts)
  const [designs, setDesigns] = useState(initialDesigns)
  const [range, setRange] = useState({ lo: 0, hi: 1200 })
  const [elev, setElev] = useState<Elev>({ lineY: 1400, depth: 2000 })
  const [selected, setSelected] = useState<string | null>(null)
  const [cycle, setCycle] = useState({ ids: [] as string[], i: 0 })
  const [ghost, setGhost] = useState<{ id: string; bottom: number; height: number; snap?: string; delta?: number } | null>(null)
  const [demo, setDemo] = useState<{ id: string; bottom: number; snap: string } | null>(null)
  const [shared, setShared] = useState<{ designId: string; height: number } | null>(null)
  const [acks, setAcks] = useState<Record<string, string>>({})
  const [warnOpen, setWarnOpen] = useState(true)
  const [scenario, setScenario] = useState<Scenario>('range')
  const [log, setLog] = useState<string[]>(['Prototype loaded — Ground Floor · local Z = 0 at Floor Datum'])
  const note = (s: string) => setLog(l => [s, ...l].slice(0, 7))

  const warnings = useMemo(() => computeWarnings(ents), [ents])
  const seenOf = (w: Warning) => acks[w.id] === w.text
  const reopened = (w: Warning) => acks[w.id] !== undefined && acks[w.id] !== w.text
  const ent = (id: string | null) => ents.find(e => e.id === id) ?? null
  const designOf = (e: Ent | null) => (e?.design ? designs.find(d => d.id === e.design) ?? null : null)
  const placementsOf = (designId: string) => ents.filter(e => e.design === designId)
  const bandEnts = useMemo(() => ents.filter(e => inBand(e, elev)), [ents, elev])
  const snapTargets = useMemo(() => {
    const t: { v: number; label: string }[] = [{ v: 0, label: 'Floor Datum 0' }, { v: UPPER_LIMIT, label: 'Upper limit 2600' }]
    for (const e of bandEnts) { t.push({ v: e.bottom, label: `${e.label} base ${e.bottom}` }); t.push({ v: topOf(e), label: `${e.label} top ${topOf(e)}` }) }
    return t
  }, [bandEnts])

  const setGeom = (id: string, bottom: number, height: number, msg?: string) => {
    setEnts(es => es.map(e => (e.id === id ? { ...e, bottom: Math.round(bottom), height: Math.max(1, Math.round(height)) } : e)))
    if (msg) note(msg)
  }
  const select = (id: string | null, hits: string[] = []) => {
    if (id && cycle.ids.length > 1 && cycle.ids.includes(id) && cycle.ids.includes(selected ?? '')) {
      const i = (cycle.i + 1) % cycle.ids.length
      setCycle(c => ({ ...c, i })); setSelected(cycle.ids[i]); note(`Cycled under pointer → ${ent(cycle.ids[i])?.label} (${i + 1}/${cycle.ids.length})`)
      return
    }
    setSelected(id); setCycle({ ids: hits, i: 0 })
  }
  const ack = (w: Warning) => { setAcks(a => ({ ...a, [w.id]: w.text })); note(`Acknowledged “seen”: ${w.text}`) }
  const applyDesign = (designId: string, height: number) => {
    setDesigns(ds => ds.map(d => (d.id === designId ? { ...d, height } : d)))
    const d = designs.find(x => x.id === designId)!
    note(`Item Design ${d.label} height ${d.height} → ${height} mm — ${placementsOf(designId).length} Placed Items updated`)
    setShared(null)
  }
  const applyScenario = (s: Scenario) => {
    setScenario(s); setGhost(null); setDemo(null); setShared(null)
    const u = new URL(location.href); u.searchParams.set('scenario', s); history.replaceState(null, '', u)
    if (s === 'range') { setRange({ lo: 0, hi: 1200 }); setSelected(null); setElev({ lineY: 1400, depth: 2000 }); note('Scenario · range 0–1200: dashed = overhead, faded = below') }
    if (s === 'cycle') { setRange({ lo: 0, hi: 1200 }); setSelected('wc1'); setCycle({ ids: ['b1', 'wc1'], i: 1 }); note('Scenario · pointer over overlapping cabinets — click again to cycle') }
    if (s === 'elevation') { setSelected('wc1'); setRange({ lo: 0, hi: 2600 }); note('Scenario · Wall cabinet #1 — edit Base/Top numerically or drag its handles in Elevation View') }
    if (s === 'section') { setElev({ lineY: 2550, depth: 2600 }); setSelected('sv1'); note('Scenario · depth 2600 — Service E 80×60 now projects; drag the section line or far edge') }
    if (s === 'shared') { setSelected('b1'); setShared({ designId: 'base860', height: 920 }); note('Scenario · editing shared Item Design height') }
    if (s === 'snap') { setSelected('wc1'); setDemo({ id: 'wc1', bottom: 860, snap: 'Snap · Base cabinet #1 top 860' }); note('Scenario · dragging Wall cabinet #1 base in Elevation View — snapped to Base cabinet #1 top') }
    if (s === 'warning') { const ws = computeWarnings(ents); const a: Record<string, string> = {}; for (const w of ws) if (w.id.startsWith('sv1')) a[w.id] = w.text; setAcks(a); setWarnOpen(true); note('Scenario · one warning marked seen; others open') }
  }
  return {
    ents, designs, range, setRange, elev, setElev, selected, setSelected, cycle, select, ghost, setGhost, demo, setDemo,
    shared, setShared, warnings, seenOf, reopened, ack, ent, designOf, placementsOf, bandEnts, snapTargets, setGeom, applyDesign,
    scenario, applyScenario, log, warnOpen, setWarnOpen, note,
  }
}
type M = ReturnType<typeof useRangeModel>

/* ---------- shared SVG helpers ---------- */
function toWorld(svg: SVGSVGElement, ev: { clientX: number; clientY: number }) {
  const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM()!.inverse())
  return { x: p.x, y: p.y }
}
const kindClass = (e: Ent) => `k-${e.kind.toLowerCase().replace(' ', '-')}`
const rangeClass = (e: Ent, lo: number, hi: number) => `rs-${rangeStyle(e, lo, hi)}`

/* ---------- Plan canvas ---------- */
function PlanSVG({ m, section, badges, onPick, height }: { m: M; section: 'drag' | 'pick' | 'none'; badges?: boolean; onPick?: (x: number, y: number, hits: string[]) => void; height?: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [sectionPick, setSectionPick] = useState<number | null>(null)
  const { lo, hi } = m.range
  const order = [...m.ents].sort((a, b) => rank(a) - rank(b))
  function rank(e: Ent) { const s = rangeStyle(e, lo, hi); return s === 'below' ? 0 : s === 'primary' ? 1 : 2 }
  const hitsAt = (x: number, y: number) => order.filter(e => e.kind !== 'Wall' && e.kind !== 'Opening' && x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h).reverse().map(e => e.id)
    .concat(order.filter(e => (e.kind === 'Wall' || e.kind === 'Opening') && x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h).reverse().map(e => e.id))
  const down = (ev: React.PointerEvent) => {
    const w = toWorld(svgRef.current!, ev); svgRef.current!.setPointerCapture(ev.pointerId)
    if (section === 'drag') {
      if (Math.abs(w.y - m.elev.lineY) < 90) { drag.current = { mode: 'line', z0: w.y, x0: w.x, y0: w.y, orig: null, moved: false }; return }
      const far = m.elev.lineY - m.elev.depth
      if (Math.abs(w.y - far) < 90) { drag.current = { mode: 'depth', z0: w.y, x0: w.x, y0: w.y, orig: null, moved: false }; return }
    }
    const hits = hitsAt(w.x, w.y)
    drag.current = { mode: 'section2', z0: w.y, x0: w.x, y0: w.y, orig: null, moved: false }
    ;(drag.current as Drag & { hits?: string[] }).hits = hits
  }
  const move = (ev: React.PointerEvent) => {
    const d = drag.current; if (!d) return
    const w = toWorld(svgRef.current!, ev); d.moved = true
    if (d.mode === 'line') m.setElev(v => ({ ...v, lineY: Math.round(Math.max(200, Math.min(2900, w.y))) }))
    if (d.mode === 'depth') m.setElev(v => ({ ...v, depth: Math.round(Math.max(200, Math.min(2800, v.lineY - w.y))) }))
  }
  const up = (ev: React.PointerEvent) => {
    const d = drag.current; drag.current = null
    if (!d) return
    const w = toWorld(svgRef.current!, ev)
    if (d.mode === 'section2' && !d.moved) {
      if (section === 'pick') {
        if (sectionPick === null) { setSectionPick(w.y); m.note('Section line set — click again to set projection depth') }
        else { m.setElev({ lineY: Math.round((sectionPick + w.y) / 2), depth: Math.round(Math.abs(w.y - sectionPick)) }); setSectionPick(null); m.note('Elevation View section defined by two clicks') }
        return
      }
      const hits = (d as Drag & { hits?: string[] }).hits ?? []
      onPick?.(w.x, w.y, hits)
    }
    if (d.mode === 'line' && d.moved) m.note(`Section line → y ${m.elev.lineY} · depth band ${m.elev.lineY - m.elev.depth}…${m.elev.lineY}`)
    if (d.mode === 'depth' && d.moved) m.note(`Projection depth → ${m.elev.depth} mm · ${m.bandEnts.length} entities project`)
  }
  const warnIds = new Set(m.warnings.filter(w => !m.seenOf(w)).flatMap(w => w.ents))
  return (
    <svg ref={svgRef} className="plan" viewBox={`${PLAN.x} ${PLAN.y} ${PLAN.w} ${PLAN.h}`} style={height ? { height } : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <rect x={PLAN.x} y={PLAN.y} width={PLAN.w} height={PLAN.h} className="plan-bg" />
      {section !== 'none' && <g className="section">
        <rect x={PLAN.x} y={m.elev.lineY - m.elev.depth} width={PLAN.w} height={m.elev.depth} className="depth-band" />
        <line x1={PLAN.x} y1={m.elev.lineY} x2={PLAN.x + PLAN.w} y2={m.elev.lineY} className="section-line" />
        <line x1={3400} y1={m.elev.lineY} x2={3400} y2={m.elev.lineY - 260} className="section-arrow" markerStart="url(#arr)" />
        <text x={560} y={m.elev.lineY - 14} className="section-label">Section · looking North · depth {m.elev.depth}</text>
        <text x={560} y={m.elev.lineY - m.elev.depth + 40} className="section-label">far edge — drag</text>
      </g>}
      <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M8 0 L0 4 L8 8 z" fill="#ffb547" /></marker></defs>
      {order.map(e => {
        const sel = m.selected === e.id
        const sharedGhost = m.shared && e.design === m.shared.designId
        return <g key={e.id} className={`${kindClass(e)} ${rangeClass(e, lo, hi)} ${sel ? 'sel' : ''}`}>
          <rect x={e.x} y={e.y} width={e.w} height={e.h} />
          {e.kind === 'Opening' && <line x1={e.x} y1={e.y} x2={e.x + e.w} y2={e.y + e.h} className="open-diag" />}
          {sharedGhost && <rect x={e.x} y={e.y} width={e.w} height={e.h} className="shared-ghost" />}
          {sel && <rect x={e.x - 24} y={e.y - 24} width={e.w + 48} height={e.h + 48} className="sel-box" />}
        </g>
      })}
      {order.map(e => <g key={`l-${e.id}`} pointerEvents="none">
        {e.kind === 'Placed Item' && m.placementsOf(e.design!).length > 1 && <text x={e.x + 12} y={e.y + 40} className="shared-badge">⧉{m.placementsOf(e.design!).length}</text>}
        {badges && warnIds.has(e.id) && <g className="warn-badge"><circle cx={e.x + e.w - 10} cy={e.y + 10} r={44} /><text x={e.x + e.w - 10} y={e.y + 26}>!</text></g>}
        {e.kind !== 'Skirting' && <text x={e.x + e.w > 4050 ? e.x + e.w : e.x + 12} y={e.kind === 'Placed Item' || e.kind === 'Service' ? e.y + e.h - 70 : e.h < 500 ? Math.max(90, e.y - 40) : e.y + 60} textAnchor={e.x + e.w > 4050 ? 'end' : 'start'} className="ent-label plan-ent-label">{e.label}</text>}
      </g>)}
      {m.cycle.ids.length > 1 && m.selected && (() => { const e = m.ent(m.selected)!; return <g className="cycle-badge"><rect x={e.x + e.w - 150} y={e.y + e.h - 70} width={150} height={54} rx={10} /><text x={e.x + e.w - 136} y={e.y + e.h - 32}>{m.cycle.i + 1}/{m.cycle.ids.length} · {e.label.split(' #')[0]}</text></g> })()}
    </svg>
  )
}

/* ---------- Elevation canvas ---------- */
function ElevSVG({ m, feel, height }: { m: M; feel: 'handles' | 'magnetic' | 'notch'; height?: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [hoverEdge, setHoverEdge] = useState<{ id: string; edge: 'top' | 'bottom' } | null>(null)
  const z2y = (z: number) => -z
  const worldZ = (ev: { clientX: number; clientY: number }) => -toWorld(svgRef.current!, ev).y
  const worldX = (ev: { clientX: number; clientY: number }) => toWorld(svgRef.current!, ev).x
  const sel = m.ent(m.selected)
  const kindRank = (e: Ent) => e.kind === 'Wall' ? 0 : e.kind === 'Beam' ? 1 : e.kind === 'Opening' ? 2 : e.kind === 'Service' ? 3 : e.kind === 'Skirting' ? 4 : 5
  const shown = [...m.bandEnts].sort((a, b) => kindRank(a) - kindRank(b))
  const edgeHit = (e: Ent, z: number): 'top' | 'bottom' | null => {
    if (Math.abs(z - topOf(e)) < 70) return 'top'
    if (Math.abs(z - e.bottom) < 70) return 'bottom'
    return null
  }
  const down = (ev: React.PointerEvent) => {
    const z = worldZ(ev), x = worldX(ev); svgRef.current!.setPointerCapture(ev.pointerId)
    const hits = shown.filter(e => x >= e.x && x <= e.x + e.w && z >= e.bottom && z <= topOf(e)).reverse()
    const h = hits[0] ?? null
    if (h) {
      const edge = feel === 'handles' ? null : edgeHit(h, z)
      const onHandle = feel === 'handles' && m.selected === h.id && (Math.abs(z - topOf(h)) < 90 || Math.abs(z - h.bottom) < 90)
      const mode: Drag['mode'] = onHandle || edge ? (edge ?? (Math.abs(z - topOf(h)) < Math.abs(z - h.bottom) ? 'top' : 'bottom')) : 'body'
      if (m.selected !== h.id) m.select(h.id, hits.map(e => e.id))
      drag.current = { mode, id: h.id, z0: z, x0: x, orig: h, moved: false }
    } else { m.select(null) }
  }
  const move = (ev: React.PointerEvent) => {
    const d = drag.current
    if (!d) {
      if (feel === 'magnetic') {
        const z = worldZ(ev), x = worldX(ev)
        const h = shown.find(e => x >= e.x && x <= e.x + e.w && z >= e.bottom - 70 && z <= topOf(e) + 70)
        setHoverEdge(h ? (() => { const ed = edgeHit(h, z); return ed ? { id: h.id, edge: ed } : null })() : null)
      }
      return
    }
    const z = worldZ(ev)
    if (!d.moved && Math.abs(z - d.z0) < 12) return
    d.moved = true
    const o = d.orig!
    let bottom = o.bottom, height = o.height, snap: string | undefined, delta: number | undefined
    const others = shown.filter(e => e.id !== o.id)
    const targets = [...m.snapTargets.filter(t => !t.label.startsWith(o.label))]
    if (d.mode === 'body') {
      const s = snapV(o.bottom + (z - d.z0), targets); bottom = s.v; snap = s.label; height = o.height; delta = Math.round(z - d.z0)
      const s2 = snapV(topOf(o) + (z - d.z0), others.flatMap(e => [e.bottom, topOf(e)]))
      if (snap === undefined && s2.label) { bottom = s2.v - o.height; snap = s2.label }
    } else if (d.mode === 'bottom') {
      const s = snapV(z, targets); bottom = Math.min(s.v, topOf(o) - 50); snap = s.label; height = topOf(o) - bottom
    } else {
      const s = snapV(z, targets); height = Math.max(50, s.v - bottom); snap = s.label
    }
    m.setGhost({ id: o.id, bottom, height, snap, delta })
  }
  const up = () => {
    const d = drag.current; drag.current = null
    if (!d || !d.moved || !m.ghost) { m.setGhost(null); return }
    const g = m.ghost, o = d.orig!
    m.setGeom(g.id, g.bottom, g.height, `${o.label}: ${o.bottom}–${topOf(o)} → ${g.bottom}–${g.bottom + g.height} mm${g.snap ? ` (${g.snap})` : ''}`)
    m.setGhost(null); m.setDemo(null)
  }
  const g = m.ghost ?? (m.demo ? { ...m.demo, height: m.ent(m.demo.id)!.height } : null)
  const gEnt = g ? m.ent(g.id) : null
  return (
    <svg ref={svgRef} className="elev" viewBox={`${ELEV.x} ${-ELEV.zMax} 4400 ${ELEV.zMax - ELEV.zMin}`} style={height ? { height } : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHoverEdge(null)}>
      <rect x={ELEV.x} y={-ELEV.zMax} width={4400} height={ELEV.zMax - ELEV.zMin} className="plan-bg" />
      <line x1={ELEV.x} y1={z2y(0)} x2={ELEV.x + 4400} y2={z2y(0)} className="datum" />
      <line x1={ELEV.x} y1={z2y(UPPER_LIMIT)} x2={ELEV.x + 4400} y2={z2y(UPPER_LIMIT)} className="limit" />
      {[500, 1000, 1500, 2000, 2500].map(z => <line key={z} x1={ELEV.x} y1={z2y(z)} x2={ELEV.x + 4400} y2={z2y(z)} className="tick" />)}
      {shown.map(e => {
        const s = m.selected === e.id
        const sharedGhost = m.shared && e.design === m.shared.designId
        return <g key={e.id} className={`${kindClass(e)} ${s ? 'sel' : ''} ${hoverEdge?.id === e.id ? `edge-${hoverEdge.edge}` : ''}`}>
          <rect x={e.x} y={z2y(topOf(e))} width={e.w} height={e.height} />
          {sharedGhost && gEnt && <rect x={e.x} y={z2y(e.bottom + m.shared!.height)} width={e.w} height={m.shared!.height} className="shared-ghost" />}
          {s && feel === 'handles' && <g className="handles">
            <rect x={e.x + e.w / 2 - 40} y={z2y(topOf(e)) - 40} width={80} height={80} className="handle" />
            <rect x={e.x + e.w / 2 - 40} y={z2y(e.bottom) - 40} width={80} height={80} className="handle" />
          </g>}
          {s && feel === 'notch' && <g className="handles">
            <rect x={e.x + e.w / 2 - 60} y={z2y(topOf(e)) - 14} width={120} height={28} rx={12} className="notch" />
            <rect x={e.x + e.w / 2 - 60} y={z2y(e.bottom) - 14} width={120} height={28} rx={12} className="notch" />
          </g>}
        </g>
      })}
      {shown.map(e => <g key={`l-${e.id}`} className="elev-labels" pointerEvents="none">
        {e.kind !== 'Wall' && <text x={e.kind === 'Skirting' ? e.x + e.w + 10 : e.x + e.w > 4050 ? e.x + e.w : e.x + 10} y={e.kind === 'Opening' || e.kind === 'Service' ? z2y(topOf(e)) - 16 : e.kind === 'Skirting' ? z2y(e.bottom) + 95 : z2y(topOf(e)) + 40} textAnchor={e.kind !== 'Skirting' && e.x + e.w > 4050 ? 'end' : 'start'} className="ent-label">{e.label}</text>}
        {(e.kind === 'Placed Item' || e.kind === 'Opening' || m.selected === e.id) && <text x={e.x + 10} y={e.kind === 'Opening' ? z2y(e.bottom) - 16 : z2y(topOf(e)) + 130} className="dim-label">{e.bottom}–{topOf(e)}</text>}
      </g>)}
      <g className="elev-labels" pointerEvents="none">
        <text x={ELEV.x + 20} y={z2y(0) + 100} className="datum-label">Floor Datum 0</text>
        <text x={ELEV.x + 20} y={z2y(UPPER_LIMIT) - 12} className="limit-label">Upper limit 2600</text>
        {[500, 1000, 1500, 2000, 2500].map(z => <text key={z} x={ELEV.x + 4380} y={z2y(z) - 8} textAnchor="end" className="tick-label">{z}</text>)}
      </g>
      {g && gEnt && <g className="ghost">
        <rect x={gEnt.x} y={z2y(g.bottom + g.height)} width={gEnt.w} height={g.height} />
        {g.snap && <g>
          <line x1={ELEV.x} y1={z2y(g.bottom)} x2={ELEV.x + 4400} y2={z2y(g.bottom)} className="snap-guide" />
          <text x={ELEV.x + 4370} y={z2y(g.bottom) - 14} textAnchor="end" className="snap-label">{g.snap}</text>
        </g>}
        {g.delta !== undefined && <g className="delta-chip"><rect x={gEnt.x + gEnt.w + 30} y={z2y(g.bottom + g.height) - 30} width={190} height={60} rx={12} /><text x={gEnt.x + gEnt.w + 46} y={z2y(g.bottom + g.height) + 12}>Δ {g.delta} mm</text></g>}
      </g>}
    </svg>
  )
}

/* ---------- Range gauge (docked ruler, variant A) ---------- */
function RangeGauge({ m }: { m: M }) {
  const ref = useRef<SVGSVGElement>(null)
  const drag = useRef<'lo' | 'hi' | null>(null)
  const z2y = (z: number) => 40 + (2900 - z) * (560 / 3200)
  const y2z = (y: number) => 2900 - (y - 40) * (3200 / 560)
  const down = (ev: React.PointerEvent) => { const y = toWorld(ref.current!, ev).y; drag.current = Math.abs(y - z2y(m.range.hi)) < 26 ? 'hi' : Math.abs(y - z2y(m.range.lo)) < 26 ? 'lo' : null; ref.current!.setPointerCapture(ev.pointerId) }
  const move = (ev: React.PointerEvent) => { if (!drag.current) return; const z = Math.round(Math.max(-300, Math.min(2900, y2z(toWorld(ref.current!, ev).y))) / 10) * 10; m.setRange(r => drag.current === 'hi' ? { ...r, hi: Math.max(r.lo + 100, z) } : { ...r, lo: Math.min(r.hi - 100, z) }) }
  const up = () => { if (drag.current) m.note(`Plan View Range → ${m.range.lo}…${m.range.hi} mm`); drag.current = null }
  return <svg ref={ref} className="gauge" viewBox="0 0 90 620" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
    <rect x={30} y={z2y(2900)} width={26} height={z2y(-300) - z2y(2900)} className="gauge-track" />
    <rect x={30} y={z2y(m.range.hi)} width={26} height={z2y(m.range.lo) - z2y(m.range.hi)} className="gauge-band" />
    {[0, 1000, 2000].map(z => <text key={z} x={62} y={z2y(z) + 6} className="gauge-tick">{z}</text>)}
    <line x1={22} y1={z2y(m.range.hi)} x2={64} y2={z2y(m.range.hi)} className="gauge-stop" />
    <line x1={22} y1={z2y(m.range.lo)} x2={64} y2={z2y(m.range.lo)} className="gauge-stop" />
    <text x={43} y={16} className="gauge-title">Range</text>
  </svg>
}

/* ---------- Range chip popover (variant B) ---------- */
function RangeChip({ m }: { m: M }) {
  const [open, setOpen] = useState(false)
  return <div className="range-chip">
    <button className="chip-btn" onClick={() => setOpen(!open)}>Plan View Range {m.range.lo}–{m.range.hi} mm ▾</button>
    {open && <div className="chip-pop">
      <div className="kv"><span>Lower</span><input type="number" step={50} value={m.range.lo} onChange={e => m.setRange(r => ({ ...r, lo: Math.min(+e.target.value, r.hi - 100) }))} /></div>
      <div className="kv"><span>Upper</span><input type="number" step={50} value={m.range.hi} onChange={e => m.setRange(r => ({ ...r, hi: Math.max(+e.target.value, r.lo + 100) }))} /></div>
      <p className="helper">Primary content solid · above range dashed · below range faded. Range belongs to this Plan View only.</p>
    </div>}
  </div>
}

/* ---------- Depth mini-map (variant B elevation mode) ---------- */
function DepthMap({ m }: { m: M }) {
  const ref = useRef<SVGSVGElement>(null)
  const drag = useRef<'line' | 'far' | null>(null)
  const y2p = (y: number) => 6 + (y / 3000) * 68
  const p2y = (p: number) => ((p - 6) / 68) * 3000
  const down = (ev: React.PointerEvent) => { const y = toWorld(ref.current!, ev).y; drag.current = Math.abs(y - y2p(m.elev.lineY)) < 5 ? 'line' : Math.abs(y - y2p(m.elev.lineY - m.elev.depth)) < 5 ? 'far' : null }
  const move = (ev: React.PointerEvent) => { if (!drag.current) return; const y = Math.max(0, Math.min(3000, p2y(toWorld(ref.current!, ev).y))); if (drag.current === 'line') m.setElev(v => ({ ...v, lineY: Math.round(y) })); else m.setElev(v => ({ ...v, depth: Math.round(Math.max(200, Math.min(2800, v.lineY - y))) })) }
  const up = () => { drag.current = null }
  return <div className="depth-map"><b>Section · looking North</b>
    <svg ref={ref} viewBox="0 0 260 80" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <rect x={0} y={6} width={260} height={68} className="plan-bg" />
      <rect x={0} y={y2p(m.elev.lineY - m.elev.depth)} width={260} height={y2p(m.elev.lineY) - y2p(m.elev.lineY - m.elev.depth)} className="depth-band" />
      <line x1={0} y1={y2p(m.elev.lineY)} x2={260} y2={y2p(m.elev.lineY)} className="section-line" />
      <line x1={0} y1={y2p(m.elev.lineY - m.elev.depth)} x2={260} y2={y2p(m.elev.lineY - m.elev.depth)} className="section-far" />
    </svg>
    <span>line y {m.elev.lineY} · depth {m.elev.depth} · {m.bandEnts.length} entities project</span>
  </div>
}

/* ---------- Inspector ---------- */
function Fields({ m, e }: { m: M; e: Ent }) {
  const d = m.designOf(e)
  const label = e.kind === 'Beam' ? ['Underside', 'Top'] : ['Base', 'Top']
  return <div className="fields">
    <div className="kv"><span>{label[0]}</span><input type="number" step={10} value={e.bottom} onChange={ev => m.setGeom(e.id, +ev.target.value, e.height, `${e.label} ${label[0].toLowerCase()} → ${ev.target.value} mm`)} /><em>mm</em></div>
    <div className="kv"><span>{label[1]}</span><input type="number" step={10} value={topOf(e)} onChange={ev => m.setGeom(e.id, e.bottom, +ev.target.value - e.bottom, `${e.label} ${label[1].toLowerCase()} → ${ev.target.value} mm`)} /><em>mm</em></div>
    <div className="kv"><span>Height</span><b>{e.height} mm</b><em>{d ? 'from Item Design' : 'derived'}</em></div>
    <div className="kv"><span>Range role</span><b className={`role rs-${rangeStyle(e, m.range.lo, m.range.hi)}`}>{rangeStyle(e, m.range.lo, m.range.hi)}</b></div>
    {d && <div className="shared-row">
      <span>Item Design · <b>{d.label}</b> · shared by {m.placementsOf(d.id).length} Placed Items</span>
      <button className="primary" onClick={() => m.setShared({ designId: d.id, height: d.height })}>Edit shared design…</button>
    </div>}
  </div>
}
function Inspector({ m, nudge }: { m: M; nudge?: boolean }) {
  const e = m.ent(m.selected)
  if (!e) return <p className="helper pad">Select an entity in Plan or Elevation. Click the same spot again to cycle through overlapping entities.</p>
  return <div className="pad">
    <p className="eyebrow">{e.kind}{m.cycle.ids.length > 1 ? ` · ${m.cycle.i + 1}/${m.cycle.ids.length} under pointer` : ''}</p>
    <h3>{e.label}</h3>
    <Fields m={m} e={e} />
    {nudge && <div className="row-actions"><button onClick={() => m.setGeom(e.id, e.bottom - 10, e.height)}>Base −10</button><button onClick={() => m.setGeom(e.id, e.bottom + 10, e.height)}>Base +10</button><button onClick={() => m.setGeom(e.id, e.bottom, e.height + 10)}>Top +10</button><button onClick={() => m.setGeom(e.id, e.bottom, e.height - 10)}>Top −10</button></div>}
  </div>
}

/* ---------- Warnings ---------- */
function Warnings({ m, rail }: { m: M; rail?: boolean }) {
  return <div className={`warnings ${rail ? 'rail' : ''}`}>
    <div className="warn-head"><b>Coordination warnings</b><em>{m.warnings.filter(w => !m.seenOf(w)).length} open · {m.warnings.filter(w => m.seenOf(w)).length} seen</em>
      <button className="mini" onClick={() => m.setWarnOpen(!m.warnOpen)}>{m.warnOpen ? 'Collapse' : 'Expand'}</button></div>
    {m.warnOpen && m.warnings.map(w => <div key={w.id} className={`warn-row ${m.seenOf(w) ? 'seen' : ''}`}>
      <span>{w.text}{m.reopened(w) && <em className="reopen"> · reopened after change</em>}</span>
      {m.seenOf(w) ? <span className="seen-tag">Seen ✓</span> : <button className="mini" onClick={() => m.ack(w)}>Seen</button>}
    </div>)}
    {m.warnOpen && !m.warnings.length && <p className="helper">Nothing overlaps in this Floor.</p>}
  </div>
}

/* ---------- Shared design dialog ---------- */
function SharedDialog({ m }: { m: M }) {
  if (!m.shared) return null
  const d = m.designs.find(x => x.id === m.shared!.designId)!
  const ps = m.placementsOf(d.id)
  return <div className="modal-backdrop"><section className="modal">
    <p className="eyebrow">Shared Item Design</p><h2>{d.label}</h2>
    <div className="kv"><span>Design height</span><input type="number" step={10} value={m.shared.height} onChange={e => m.setShared({ ...m.shared, height: +e.target.value })} /><em>mm</em></div>
    <p className="helper">Every Placed Item keeps its own base elevation; only the design height changes. Dashed outlines preview the new top in both views.</p>
    <table><thead><tr><th>Placed Item</th><th>Floor</th><th>Base</th><th>New top</th></tr></thead><tbody>
      {ps.map(p => <tr key={p.id}><td>{p.id === m.selected ? '▸ ' : ''}{p.label}</td><td>Ground Floor</td><td>{p.bottom}</td><td>{p.bottom + m.shared!.height}</td></tr>)}
    </tbody></table>
    <div className="modal-actions"><button onClick={() => m.setShared(null)}>Cancel — change nothing</button><button className="primary" onClick={() => m.applyDesign(d.id, m.shared!.height)}>Apply to {ps.length} Placed Items</button></div>
  </section></div>
}

/* ---------- Scenario list + state log ---------- */
function Scenarios({ m, compact }: { m: M; compact?: boolean }) {
  return <div className={`scenarios ${compact ? 'compact' : ''}`}>
    <b>Scenarios</b>
    {SCENARIOS.map(s => <button key={s.id} className={m.scenario === s.id ? 'on' : ''} title={s.hint} onClick={() => m.applyScenario(s.id)}>{s.label}</button>)}
  </div>
}
function Log({ m }: { m: M }) {
  return <div className="state-log"><b>State</b> range={m.range.lo}…{m.range.hi} · section y={m.elev.lineY} depth={m.elev.depth} · sel={m.ent(m.selected)?.label ?? '–'}{m.cycle.ids.length > 1 ? ` (${m.cycle.i + 1}/${m.cycle.ids.length})` : ''} · designs={m.designs.map(d => `${d.id}:${d.height}`).join(' ')} · warnings={m.warnings.length} ({m.warnings.filter(w => !m.seenOf(w)).length} open)<br />{m.log.map((l, i) => <span key={i} className={i ? 'old' : ''}>{l}</span>)}</div>
}

/* ---------- Variant A: split plan + elevation, docked gauge, square handles ---------- */
function VariantA({ m }: { m: M }) {
  return <div className="va">
    <header className="toolbar"><b className="brand">BuildBox</b><span className="crumb">Ground Floor ▾</span><span className="crumb">Plan · Default Plan View</span><span className="crumb">Kitchen · North Elevation</span>
      <span className="grow" /><Scenarios m={m} compact /></header>
    <div className="va-body">
      <main className="plan-col"><div className="col-head">Plan View · range {m.range.lo}–{m.range.hi} mm</div>
        <PlanSVG m={m} section="drag" onPick={(x, y, hits) => m.select(hits[0] ?? null, hits)} /></main>
      <aside className="gauge-col"><RangeGauge m={m} /><div className="gauge-nums"><input type="number" step={50} value={m.range.lo} onChange={e => m.setRange(r => ({ ...r, lo: Math.min(+e.target.value, r.hi - 100) }))} /><input type="number" step={50} value={m.range.hi} onChange={e => m.setRange(r => ({ ...r, hi: Math.max(+e.target.value, r.lo + 100) }))} /></div></aside>
      <main className="elev-col"><div className="col-head">Elevation View · section y {m.elev.lineY} · depth {m.elev.depth} · drag square handles</div><ElevSVG m={m} feel="handles" /></main>
      <aside className="inspector"><Inspector m={m} /><Warnings m={m} /><Log m={m} /></aside>
    </div>
  </div>
}

/* ---------- Variant B: mode tabs, floating chip, magnetic drag, warning rail ---------- */
function VariantB({ m }: { m: M }) {
  const [mode, setMode] = useState<'plan' | 'elev'>('plan')
  const [sectionTool, setSectionTool] = useState(false)
  useEffect(() => {
    if (m.scenario === 'elevation' || m.scenario === 'snap') setMode('elev')
    if (m.scenario === 'section') { setMode('plan'); setSectionTool(true) }
  }, [m.scenario])
  return <div className="vb">
    <header className="toolbar"><b className="brand">BuildBox</b>
      <span className="tabs"><button className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>Plan</button><button className={mode === 'elev' ? 'on' : ''} onClick={() => setMode('elev')}>Elevation</button></span>
      {mode === 'plan' && <button className={sectionTool ? 'primary' : ''} onClick={() => setSectionTool(!sectionTool)}>✂ Section</button>}
      <span className="crumb">Ground Floor</span><span className="grow" /><Scenarios m={m} compact /></header>
    <div className="vb-body">
      <main className={`canvas-wrap ${sectionTool ? 'sectioning' : ''}`}>
        {mode === 'plan' && <>
          <RangeChip m={m} />
          {sectionTool && <div className="hint">Click once for the section line, again for the projection depth</div>}
          <PlanSVG m={m} section={sectionTool ? 'pick' : 'none'} onPick={(x, y, hits) => { if (!sectionTool) m.select(hits[0] ?? null, hits) }} />
        </>}
        {mode === 'elev' && <>
          <DepthMap m={m} />
          <ElevSVG m={m} feel="magnetic" />
          <p className="helper elev-hint">Hover an edge to grab it · drag the body to move the whole Vertical Extent · snapping is magnetic</p>
        </>}
        {m.ent(m.selected) && <div className="bottom-sheet"><Inspector m={m} /></div>}
      </main>
      <aside className="rail-col"><Warnings m={m} rail /><Scenarios m={m} /><Log m={m} /></aside>
    </div>
  </div>
}

/* ---------- Variant C: aligned section strip, ruler stops in inspector ---------- */
function VariantC({ m }: { m: M }) {
  return <div className="vc">
    <header className="toolbar"><b className="brand">BuildBox</b><span className="crumb">Ground Floor ▾</span><span className="crumb">Kitchen · North Elevation — aligned below the section line</span><span className="grow" /><Scenarios m={m} compact /></header>
    <div className="vc-body">
      <main className="vc-main">
        <PlanSVG m={m} section="drag" badges height="52vh" onPick={(x, y, hits) => m.select(hits[0] ?? null, hits)} />
        <div className="col-head">Elevation View · same X scale · drag notch handles or use ±10</div>
        <ElevSVG m={m} feel="notch" height="34vh" />
      </main>
      <aside className="inspector wide">
        <RangeStops m={m} />
        <Inspector m={m} nudge />
        <Warnings m={m} />
        <Log m={m} />
      </aside>
    </div>
  </div>
}
function RangeStops({ m }: { m: M }) {
  const ref = useRef<SVGSVGElement>(null)
  const drag = useRef<'lo' | 'hi' | null>(null)
  const z2y = (z: number) => 14 + (2900 - z) * (240 / 3200)
  const y2z = (y: number) => 2900 - (y - 14) * (3200 / 240)
  const down = (ev: React.PointerEvent) => { const y = toWorld(ref.current!, ev).y; drag.current = Math.abs(y - z2y(m.range.hi)) < 14 ? 'hi' : Math.abs(y - z2y(m.range.lo)) < 14 ? 'lo' : null; ref.current!.setPointerCapture(ev.pointerId) }
  const move = (ev: React.PointerEvent) => { if (!drag.current) return; const z = Math.round(Math.max(-300, Math.min(2900, y2z(toWorld(ref.current!, ev).y))) / 10) * 10; m.setRange(r => drag.current === 'hi' ? { ...r, hi: Math.max(r.lo + 100, z) } : { ...r, lo: Math.min(r.hi - 100, z) }) }
  const up = () => { if (drag.current) m.note(`Plan View Range → ${m.range.lo}…${m.range.hi} mm`); drag.current = null }
  return <div className="range-stops pad"><p className="eyebrow">Plan View Range · this view only</p>
    <svg ref={ref} viewBox="0 0 280 268" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <rect x={110} y={z2y(2900)} width={60} height={z2y(-300) - z2y(2900)} className="gauge-track" />
      <rect x={110} y={z2y(m.range.hi)} width={60} height={z2y(m.range.lo) - z2y(m.range.hi)} className="gauge-band" />
      <g className="gauge-stop"><rect x={96} y={z2y(m.range.hi) - 12} width={88} height={24} rx={10} /><text x={140} y={z2y(m.range.hi) + 7}>top {m.range.hi}</text></g>
      <g className="gauge-stop"><rect x={96} y={z2y(m.range.lo) - 12} width={88} height={24} rx={10} /><text x={140} y={z2y(m.range.lo) + 7}>cut {m.range.lo}</text></g>
      <text x={20} y={z2y(UPPER_LIMIT) + 6} className="tick-label">2600</text>
      <text x={20} y={z2y(0) + 6} className="tick-label">0</text>
    </svg>
    <p className="helper">Drag the stops: entities above “top” draw dashed overhead, below “cut” draw faded.</p>
  </div>
}

/* ---------- shell + switcher ---------- */
function App() {
  const read = () => (new URLSearchParams(location.search).get('variant') as Variant) || 'A'
  const [variant, setVariant] = useState<Variant>(read)
  const m = useRangeModel()
  const choose = (v: Variant) => { const u = new URL(location.href); u.searchParams.set('variant', v); history.replaceState(null, '', u); setVariant(v) }
  const cycleV = (d: number) => setVariant(v => { const all: Variant[] = ['A', 'B', 'C']; const n = all[(all.indexOf(v) + d + 3) % 3]; const u = new URL(location.href); u.searchParams.set('variant', n); history.replaceState(null, '', u); return n })
  useEffect(() => {
    const s = new URLSearchParams(location.search).get('scenario') as Scenario | null
    if (s && SCENARIOS.some(x => x.id === s)) m.applyScenario(s)
    const k = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (t.closest('input,textarea,select,[contenteditable]')) return; if (e.key === 'ArrowLeft') cycleV(-1); if (e.key === 'ArrowRight') cycleV(1); if (e.key === 'Escape') { m.setShared(null); m.setGhost(null); m.setDemo(null) } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])
  return <div className="prototype"><div className="prototype-notice">Throwaway prototype · Plan View Range & Elevation Views · one Floor · in-memory only</div>
    {variant === 'A' && <VariantA m={m} />}{variant === 'B' && <VariantB m={m} />}{variant === 'C' && <VariantC m={m} />}
    <SharedDialog m={m} />
    <div className="variant-switcher"><button onClick={() => cycleV(-1)}>←</button>{(['A', 'B', 'C'] as Variant[]).map(v => <button key={v} className={variant === v ? 'active' : ''} onClick={() => choose(v)}>{v}</button>)}<span>{variant} · {variantNames[variant]}</span><button onClick={() => cycleV(1)}>→</button></div>
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
