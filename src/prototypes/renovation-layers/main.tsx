// THROWAWAY PROTOTYPE — Renovation Displays and mutable Drawing Layers in ordinary Plan editing.
// Three structurally different workspace variants, switchable with ?variant=A|B|C (or ← / →):
//   A · CAD panels: display segmented control, left tool palette, right Layers table
//   B · Saved-view card: one left card owns option + display + layers; contextual mode bar above canvas
//   C · Mode tabs + layer chips: colour-coded display tabs frame the canvas, chips row, floating inspector
// All variants share one in-memory model (useModel), so behaviour is identical; only layout and affordances change.
// No persistence, no undo/history, no production code. Scenarios menu loads the error/dangerous states.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Variant = 'A' | 'B' | 'C'
const variantNames: Record<Variant, string> = { A: 'CAD panels', B: 'Saved-view card', C: 'Mode tabs + layer chips' }

/* ---------- domain stubs ---------- */
type Display = 'Existing' | 'Demolition' | 'Proposed' | 'Combined'
type RState = 'Existing' | 'Demolition' | 'Proposed'
const displays: Display[] = ['Existing', 'Demolition', 'Proposed', 'Combined']
const displayShows: Record<Display, RState[]> = {
  Existing: ['Existing'], Demolition: ['Existing', 'Demolition'], Proposed: ['Existing', 'Proposed'], Combined: ['Existing', 'Demolition', 'Proposed'],
}
type Kind = 'Wall' | 'Door' | 'Pipe' | 'Power point' | 'Cabinet' | 'Appliance' | 'Furniture' | 'Annotation'
type Shape = { x: number; y: number; w: number; h: number }
type Ent = Shape & { id: string; ref: string; kind: Kind; layer: string | null; text?: string; preds?: string[] }
type Layer = { id: string; name: string; color: string }
type Option = { id: string; name: string; demolish: string[]; proposed: Ent[] }
type Perm = { visible: boolean; selectable: boolean; editable: boolean; color?: string }
type View = { id: string; name: string; option: string | null; display: Display; perms: Record<string, Perm>; order: string[] | null; snapHidden: boolean }
type Eff = Ent & { state: RState | null; option?: string }
const UNL = 'unlayered'

const defaultLayerFor: Record<Kind, string> = { Wall: 'Structure', Door: 'Structure', Pipe: 'Services', 'Power point': 'Services', Cabinet: 'Furniture', Appliance: 'Furniture', Furniture: 'Furniture', Annotation: 'Annotations' }

const seedLayers = (): Layer[] => [
  { id: 'L-str', name: 'Structure', color: '#b9b9c2' },
  { id: 'L-svc', name: 'Services', color: '#5fb3ff' },
  { id: 'L-fur', name: 'Furniture', color: '#e3a857' },
  { id: 'L-ann', name: 'Annotations', color: '#f2e27a' },
]
const seedBaseline = (): Ent[] => [
  { id: 'w1', ref: 'W-1', kind: 'Wall', layer: 'L-str', x: 40, y: 40, w: 720, h: 12 },
  { id: 'w4', ref: 'W-4', kind: 'Wall', layer: 'L-str', x: 40, y: 40, w: 12, h: 400 },
  { id: 'w5', ref: 'W-5', kind: 'Wall', layer: 'L-str', x: 40, y: 428, w: 720, h: 12 },
  { id: 'w6', ref: 'W-6', kind: 'Wall', layer: 'L-str', x: 748, y: 40, w: 12, h: 400 },
  { id: 'w2', ref: 'W-2', kind: 'Wall', layer: 'L-str', x: 400, y: 52, w: 12, h: 376 },
  { id: 'd1', ref: 'D-1', kind: 'Door', layer: 'L-str', x: 200, y: 424, w: 80, h: 20 },
  { id: 'p1', ref: 'P-1 waste', kind: 'Pipe', layer: 'L-svc', x: 60, y: 120, w: 140, h: 6 },
  { id: 'e1', ref: 'GPO-1', kind: 'Power point', layer: 'L-svc', x: 300, y: 58, w: 16, h: 16 },
  { id: 'k1', ref: 'Base 600 #1', kind: 'Cabinet', layer: 'L-fur', x: 60, y: 56, w: 120, h: 60 },
  { id: 'f1', ref: 'Fridge', kind: 'Appliance', layer: 'L-fur', x: 320, y: 56, w: 70, h: 70 },
  { id: 't1', ref: 'Dining table', kind: 'Furniture', layer: null, x: 520, y: 180, w: 150, h: 90 },
]
const seedOptions = (): Option[] => [
  {
    id: 'optA', name: 'Option A · Open kitchen', demolish: ['w2', 'k1', 'p1'], proposed: [
      { id: 'k1a', ref: 'Base 600 #1′', kind: 'Cabinet', layer: 'L-fur', x: 60, y: 56, w: 180, h: 60, preds: ['k1'] },
      { id: 'p1a', ref: 'P-1′ waste', kind: 'Pipe', layer: 'L-svc', x: 60, y: 120, w: 260, h: 6, preds: ['p1'] },
      { id: 'i1', ref: 'Island', kind: 'Cabinet', layer: 'L-fur', x: 250, y: 210, w: 200, h: 80 },
      { id: 'e2', ref: 'GPO-2', kind: 'Power point', layer: 'L-svc', x: 330, y: 244, w: 16, h: 16 },
    ],
  },
  {
    id: 'optB', name: 'Option B · Widened opening', demolish: ['w2'], proposed: [
      { id: 'w2b', ref: 'W-2′ (with opening)', kind: 'Wall', layer: 'L-str', x: 400, y: 52, w: 12, h: 376, preds: ['w2'] },
    ],
  },
]
const seedAnnotations = (): Ent[] => [
  { id: 'a1', ref: 'A-1', kind: 'Annotation', layer: 'L-ann', x: 470, y: 90, w: 0, h: 0, text: 'Retain cornice' },
  { id: 'a2', ref: 'A-2', kind: 'Annotation', layer: null, x: 470, y: 380, w: 0, h: 0, text: 'Survey 12 Oct' },
]
const allPerm = (): Perm => ({ visible: true, selectable: true, editable: true })
const seedViews = (layers: Layer[]): View[] => {
  const perms = () => Object.fromEntries([...layers.map(l => l.id), UNL].map(id => [id, allPerm()]))
  return [
    { id: 'v1', name: 'Ground Floor · Plan · Combined', option: 'optA', display: 'Combined', perms: perms(), order: null, snapHidden: false },
    { id: 'v2', name: 'Ground Floor · Plan · Demolition', option: 'optA', display: 'Demolition', perms: { ...perms(), 'L-fur': { visible: false, selectable: false, editable: false } }, order: null, snapHidden: false },
  ]
}
// a second Project used for cross-Project paste
const otherProject = {
  name: 'Unit 4 Fitout',
  layers: [{ id: 'X-joi', name: 'Joinery' }, { id: 'X-svc', name: 'Services' }, { id: 'X-not', name: 'Notes' }],
  clip: [
    { ref: 'Tall pantry', kind: 'Cabinet' as Kind, layer: 'X-joi', w: 60, h: 60 },
    { ref: 'Dishwasher', kind: 'Appliance' as Kind, layer: 'X-joi', w: 60, h: 60 },
    { ref: 'GPO-9', kind: 'Power point' as Kind, layer: 'X-svc', w: 16, h: 16 },
    { ref: 'Note: check stud', kind: 'Annotation' as Kind, layer: 'X-not', w: 0, h: 0 },
  ],
}

/* ---------- tools ---------- */
type Tool = 'Select' | 'Mark demolition' | 'Replace' | 'Place cabinet' | 'Draw wall' | 'Text annotation'
const tools: { t: Tool; icon: string; in: Display[] }[] = [
  { t: 'Select', icon: '↖', in: displays },
  { t: 'Mark demolition', icon: '✕', in: ['Demolition', 'Combined'] },
  { t: 'Replace', icon: '⇄', in: ['Demolition', 'Combined'] },
  { t: 'Place cabinet', icon: '▭', in: ['Proposed', 'Combined'] },
  { t: 'Draw wall', icon: '▮', in: ['Proposed', 'Combined'] },
  { t: 'Text annotation', icon: 'T', in: displays },
]
const toolWhy = (t: Tool) => { const d = tools.find(x => x.t === t)!.in; return `${t} works in ${d.join(' / ')} display` }

/* ---------- model ---------- */
type Modal =
  | { kind: 'correct'; id: string; dx: number }
  | { kind: 'existingEdit'; id: string; dx: number }
  | { kind: 'deleteLayer'; id: string }
  | { kind: 'paste' }
  | { kind: 'annLayer'; x: number; y: number }
  | { kind: 'restore'; id: string }
  | { kind: 'import' }
  | { kind: 'export' }
  | null

function useModel() {
  const [layers, setLayers] = useState<Layer[]>(seedLayers)
  const [baseline, setBaseline] = useState<Ent[]>(seedBaseline)
  const [options, setOptions] = useState<Option[]>(seedOptions)
  const [annotations, setAnnotations] = useState<Ent[]>(seedAnnotations)
  const [views, setViews] = useState<View[]>(() => seedViews(seedLayers()))
  const [viewId, setViewId] = useState('v1')
  const [tool, setToolRaw] = useState<Tool>('Select')
  const [selected, setSelected] = useState<string | null>(null)
  const [cycle, setCycle] = useState<{ x: number; y: number; ids: string[]; i: number } | null>(null)
  const [stateFilter, setStateFilter] = useState<RState[]>([])
  const [activeLayer, setActiveLayer] = useState<string>('L-str')
  const [modal, setModal] = useState<Modal>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>(['Loaded Project “14 Elm St” · Ground Floor'])
  const seqRef = useRef(10)
  const seq = seqRef.current
  const setSeq = (f: (n: number) => number) => { seqRef.current = f(seqRef.current) }
  const say = (s: string) => setLog(l => [s, ...l].slice(0, 14))
  const warn = (s: string) => { setToast(s); setTimeout(() => setToast(t => (t === s ? null : t)), 3200) }
  const nextId = (p: string) => `${p}${++seqRef.current}`

  const view = views.find(v => v.id === viewId)!
  const option = options.find(o => o.id === view.option) ?? null
  const patchView = (p: Partial<View>) => setViews(vs => vs.map(v => (v.id === viewId ? { ...v, ...p } : v)))
  const perm = (layer: string | null): Perm => view.perms[layer ?? UNL] ?? allPerm()
  const setPerm = (layer: string, p: Partial<Perm>) => patchView({ perms: { ...view.perms, [layer]: { ...perm(layer === UNL ? null : layer), ...p } } })
  const projectOrder = [...layers.map(l => l.id), UNL] // back → front
  const order = view.order ?? projectOrder
  const layerName = (id: string | null) => (id === null || id === UNL ? 'Unlayered' : layers.find(l => l.id === id)?.name ?? `⚠ ${id}`)
  const layerColor = (id: string | null) => perm(id).color ?? (id ? layers.find(l => l.id === id)?.color : undefined) ?? '#c9a3ff'
  const needsOption = view.display !== 'Existing' && !option

  // effective entities for the active option
  const effective: Eff[] = useMemo(() => {
    const base: Eff[] = baseline.map(e => ({ ...e, state: option?.demolish.includes(e.id) ? 'Demolition' : 'Existing' }))
    const prop: Eff[] = (option?.proposed ?? []).map(e => ({ ...e, state: 'Proposed', option: option!.id }))
    return [...base, ...prop, ...annotations.map(a => ({ ...a, state: null }))]
  }, [baseline, option, annotations])
  const inDisplay = (e: Eff) => {
    if (e.state === null) return true
    if (view.display === 'Existing') return true // whole shared baseline, unaffected by the option
    if (needsOption) return false
    return displayShows[view.display].includes(e.state)
  }
  const shownState = (e: Eff): RState | null => (view.display === 'Existing' && e.state === 'Demolition' ? 'Existing' : e.state)
  const rank = (e: Eff) => order.indexOf(e.layer ?? UNL) * 10 + (e.kind === 'Annotation' ? 5 : 0) + (shownState(e) === 'Proposed' ? 2 : shownState(e) === 'Demolition' ? 1 : 0)
  const drawn = effective.filter(e => inDisplay(e) && perm(e.layer).visible && (view.display !== 'Existing' || e.state !== 'Proposed')).sort((a, b) => rank(a) - rank(b))
  const sel = effective.find(e => e.id === selected) ?? null

  const toolOk = (t: Tool) => tools.find(x => x.t === t)!.in.includes(view.display) && (!needsOption || t === 'Select' || t === 'Text annotation')
  const setTool = (t: Tool) => { if (!toolOk(t)) { warn(toolWhy(t)); return } setToolRaw(t) }
  useEffect(() => { if (!toolOk(tool)) setToolRaw('Select') }) // display change drops a disallowed tool

  const canSelect = (e: Eff) => {
    if (!perm(e.layer).selectable) return false
    const st = shownState(e)
    if (stateFilter.length && st && !stateFilter.includes(st)) return false
    return true
  }
  const hit = (e: Eff, x: number, y: number) => e.kind === 'Annotation' ? x >= e.x - 4 && x <= e.x + 110 && y >= e.y - 16 && y <= e.y + 4 : x >= e.x - 4 && x <= e.x + e.w + 4 && y >= e.y - 4 && y <= e.y + e.h + 4
  const editBlock = (e: Eff): string | null => {
    if (!perm(e.layer).editable) return `${layerName(e.layer)} is read-only in this view — inspect only`
    if (e.state === 'Proposed' && !['Proposed', 'Combined'].includes(view.display)) return `Proposed work is edited in Proposed or Combined display`
    if (e.state === 'Demolition' && view.display === 'Proposed') return 'Demolished entities are hidden here'
    return null
  }

  function click(x: number, y: number) {
    if (tool === 'Select' || tool === 'Mark demolition' || tool === 'Replace') {
      const ids = drawn.filter(e => hit(e, x, y) && canSelect(e)).reverse().map(e => e.id) // top first
      const hiddenHit = effective.some(e => hit(e, x, y) && !drawn.includes(e) && e.state !== null && e.kind !== 'Annotation')
      if (!ids.length) { setSelected(null); setCycle(null); if (hiddenHit && view.snapHidden) say('Snap reference only: hidden content under cursor is not selectable'); return }
      const same = cycle && Math.abs(cycle.x - x) < 6 && Math.abs(cycle.y - y) < 6 && cycle.ids.join() === ids.join()
      const i = same ? (cycle!.i + 1) % ids.length : 0
      setCycle({ x, y, ids, i }); setSelected(ids[i])
      const e = effective.find(z => z.id === ids[i])!
      if (tool === 'Mark demolition') markDemolition(e)
      if (tool === 'Replace') replace(e)
      return
    }
    if (needsOption && tool !== 'Text annotation') return
    if (tool === 'Place cabinet' || tool === 'Draw wall') {
      const kind: Kind = tool === 'Draw wall' ? 'Wall' : 'Cabinet'
      const def = layers.find(l => l.name === defaultLayerFor[kind])
      const target = def?.id ?? (layers.find(l => l.id === activeLayer)?.id ?? null)
      const ent: Ent = { id: nextId('n'), ref: `${kind === 'Wall' ? 'W' : 'Cab'}-${seq}`, kind, layer: target, x: x - 30, y: y - 20, ...(kind === 'Wall' ? { w: 140, h: 12 } : { w: 60, h: 60 }) }
      if (target !== null && perm(target).editable === false) { warn(`${layerName(target)} is read-only in this view — new work goes nowhere`); return }
      setOptions(os => os.map(o => (o.id === option!.id ? { ...o, proposed: [...o.proposed, ent] } : o)))
      say(`Txn: Proposed ${ent.ref} in ${option!.name} → ${layerName(target)}${def ? '' : ' (default layer missing → active layer / Unlayered)'}`)
      setSelected(ent.id); return
    }
    if (tool === 'Text annotation') {
      const ann = layers.find(l => l.name === 'Annotations')
      if (!ann) { setModal({ kind: 'annLayer', x, y }); return }
      addAnnotation(x, y, ann.id)
    }
  }
  function addAnnotation(x: number, y: number, layer: string | null) {
    const a: Ent = { id: nextId('a'), ref: `A-${seq}`, kind: 'Annotation', layer, x, y, w: 0, h: 0, text: 'New note' }
    setAnnotations(as => [...as, a]); setSelected(a.id); say(`Txn: Annotation ${a.ref} → ${layerName(layer)}`)
  }
  function createAnnotationsLayerAndPlace(x: number, y: number) {
    const L: Layer = { id: nextId('L-'), name: 'Annotations', color: '#f2e27a' }
    setLayers(ls => [...ls, L]); setViews(vs => vs.map(v => ({ ...v, perms: { ...v.perms, [L.id]: allPerm() }, order: v.order ? [...v.order.slice(0, -1), L.id, UNL] : null })))
    addAnnotation(x, y, L.id); say('Txn: created ordinary mutable layer “Annotations” (first Annotation tool use)')
  }
  function markDemolition(e: Eff) {
    if (!option) return
    if (e.state !== 'Existing') { warn(`${e.ref} is ${e.state ?? 'an Annotation'} — only Existing Model entities can be demolished`); return }
    if (!perm(e.layer).editable) { warn(`${layerName(e.layer)} is read-only in this view`); return }
    setOptions(os => os.map(o => (o.id === option.id ? { ...o, demolish: [...o.demolish, e.id] } : o)))
    say(`Txn: demolition record → ${e.ref} in ${option.name} (no successor = removal)`)
  }
  function replace(e: Eff, dx = 0) {
    if (!option) return
    if (e.state !== 'Existing') { warn(`${e.ref} is ${e.state ?? 'an Annotation'} — Replace works on Existing entities`); return }
    if (!perm(e.layer).editable) { warn(`${layerName(e.layer)} is read-only in this view`); return }
    const s: Ent = { ...e, id: nextId('s'), ref: `${e.ref}′`, preds: [e.id], x: e.x + dx }
    setOptions(os => os.map(o => (o.id === option.id ? { ...o, demolish: [...o.demolish, e.id], proposed: [...o.proposed, s] } : o)))
    say(`Txn: replace ${e.ref} → demolition record + proposed ${s.ref} (pred ${e.ref}; baseline untouched)`); setSelected(s.id)
  }
  function move(e: Eff, dx: number) {
    const b = editBlock(e); if (b) { warn(b); return }
    if (e.state === 'Existing' || (e.state === 'Demolition' && view.display === 'Existing')) {
      setModal(view.display === 'Existing' ? { kind: 'correct', id: e.id, dx } : { kind: 'existingEdit', id: e.id, dx }); return
    }
    if (e.state === 'Demolition') { warn('Demolished entity: restore it or edit its successor'); return }
    if (e.kind === 'Annotation') { setAnnotations(as => as.map(a => (a.id === e.id ? { ...a, x: a.x + dx } : a))); say(`Txn: moved ${e.ref}`); return }
    setOptions(os => os.map(o => (o.id === e.option ? { ...o, proposed: o.proposed.map(p => (p.id === e.id ? { ...p, x: p.x + dx } : p)) } : o)))
    say(`Txn: moved proposed ${e.ref} (${option?.name})`)
  }
  function correctBaseline(id: string, dx: number) {
    const e = baseline.find(z => z.id === id)!
    setBaseline(bs => bs.map(z => (z.id === id ? { ...z, x: z.x + dx } : z)))
    // dependent valid updates in the same atomic transaction: successors referencing it follow
    setOptions(os => os.map(o => ({ ...o, proposed: o.proposed.map(p => (p.preds?.includes(id) && p.x === e.x ? { ...p, x: p.x + dx } : p)) })))
    say(`Txn (atomic): Existing Model correction moved ${e.ref} · seen by ${options.length} Design Options · aligned successors updated`)
  }
  function deleteEnt(e: Eff) {
    const b = editBlock(e); if (b) { warn(b); return }
    if (e.kind === 'Annotation') { setAnnotations(as => as.filter(a => a.id !== e.id)); say(`Txn: deleted ${e.ref}`); setSelected(null); return }
    if (e.state === 'Proposed') { setOptions(os => os.map(o => ({ ...o, proposed: o.proposed.filter(p => p.id !== e.id) }))); say(`Txn: deleted proposed ${e.ref}`); setSelected(null); return }
    if (e.state === 'Existing') { if (view.display === 'Existing') warn('Deleting from the shared baseline requires Correct Existing Model…; to remove in this option use Mark demolition'); else markDemolition(e) }
  }
  function restore(id: string) {
    setOptions(os => os.map(o => (o.id === option!.id ? { ...o, demolish: o.demolish.filter(d => d !== id), proposed: o.proposed.filter(p => !p.preds?.includes(id)) } : o)))
    say(`Txn: restored ${baseline.find(b => b.id === id)?.ref} (demolition record + successors removed)`)
  }
  function setLayerOf(e: Eff, layer: string | null) {
    const b = editBlock(e); if (b && !b.startsWith('Proposed')) { warn(b); return }
    const upd = (z: Ent) => (z.id === e.id ? { ...z, layer } : z)
    if (e.kind === 'Annotation') setAnnotations(as => as.map(upd))
    else if (e.state === 'Proposed') setOptions(os => os.map(o => ({ ...o, proposed: o.proposed.map(upd) })))
    else setBaseline(bs => bs.map(upd)) // layer is presentation, not baseline geometry
    say(`Txn: ${e.ref} → ${layerName(layer)}`)
  }
  function members(id: string) {
    const all: Ent[] = [...baseline, ...options.flatMap(o => o.proposed), ...annotations]
    return all.filter(e => (e.layer ?? UNL) === id)
  }
  function deleteLayer(id: string) {
    const name = layerName(id)
    const strip = (z: Ent) => (z.layer === id ? { ...z, layer: null } : z)
    setBaseline(bs => bs.map(strip)); setAnnotations(as => as.map(strip)); setOptions(os => os.map(o => ({ ...o, proposed: o.proposed.map(strip) })))
    setViews(vs => vs.map(v => { const { [id]: _gone, ...rest } = v.perms; return { ...v, perms: rest, order: v.order ? v.order.filter(x => x !== id) : null } }))
    setLayers(ls => ls.filter(l => l.id !== id)); if (activeLayer === id) setActiveLayer(UNL)
    say(`Txn (atomic): deleted layer “${name}” · members → Unlayered · view overrides removed · no model content deleted`)
  }
  function addLayer(name = 'New layer') {
    const L: Layer = { id: nextId('L-'), name, color: '#9ad48a' }
    setLayers(ls => [...ls, L]); setViews(vs => vs.map(v => ({ ...v, perms: { ...v.perms, [L.id]: allPerm() }, order: v.order ? [...v.order.slice(0, -1), L.id, UNL] : null }))); say(`Txn: added layer “${name}”`)
    return L
  }
  const renameLayer = (id: string, name: string) => setLayers(ls => ls.map(l => (l.id === id ? { ...l, name } : l)))
  function moveInOrder(id: string, dir: 1 | -1, scope: 'view' | 'project') {
    if (scope === 'project') {
      const ids = layers.map(l => l.id); const i = ids.indexOf(id); const j = i + dir; if (i < 0 || j < 0 || j >= ids.length) return
      const ls = [...layers];[ls[i], ls[j]] = [ls[j], ls[i]]; setLayers(ls); say(`Project default order changed (${layerName(id)})`); return
    }
    const o = [...order]; const i = o.indexOf(id); const j = i + dir; if (j < 0 || j >= o.length) return
    ;[o[i], o[j]] = [o[j], o[i]]; patchView({ order: o }); say(`View order override: ${layerName(id)} ${dir > 0 ? 'forward' : 'back'} (Project order unchanged)`)
  }
  function paste(map: Record<string, string>) {
    const created: Record<string, string> = {}
    const resolve = (src: string) => { const m = map[src]; if (m === UNL) return null; if (m === 'new') { if (!created[src]) created[src] = addLayer(otherProject.layers.find(l => l.id === src)!.name).id; return created[src] } return m }
    otherProject.clip.forEach((c, k) => {
      const layer = resolve(c.layer)
      if (c.kind === 'Annotation') { setAnnotations(as => [...as, { id: `pa${seq}${k}`, ref: `A-p${k}`, kind: 'Annotation', layer, x: 470, y: 300 + k * 14, w: 0, h: 0, text: c.ref }]); return }
      const ent: Ent = { id: `pc${seq}${k}`, ref: c.ref, kind: c.kind, layer, x: 100 + k * 70, y: 330, w: c.w, h: c.h }
      if (option && view.display !== 'Existing') setOptions(os => os.map(o => (o.id === option.id ? { ...o, proposed: [...o.proposed, ent] } : o)))
    })
    setSeq(n => n + 1); say(`Txn: pasted ${otherProject.clip.length} entities from “${otherProject.name}” with new IDs and reviewed layer mapping`)
  }
  function scenario(s: string) {
    setSelected(null); setCycle(null); setStateFilter([])
    if (s === 'normal') { const L = seedLayers(); setLayers(L); setBaseline(seedBaseline()); setOptions(seedOptions()); setAnnotations(seedAnnotations()); setViews(seedViews(L)); setViewId('v1'); say('Scenario: reset') }
    if (s === 'zero') {
      setLayers([]); const strip = (z: Ent) => ({ ...z, layer: null })
      setBaseline(bs => bs.map(strip)); setAnnotations(as => as.map(strip)); setOptions(os => os.map(o => ({ ...o, proposed: o.proposed.map(strip) })))
      setViews(vs => vs.map(v => ({ ...v, perms: { [UNL]: v.perms[UNL] ?? allPerm() }, order: null }))); setActiveLayer(UNL); say('Scenario: zero-layer Project — everything Unlayered, still valid')
    }
    if (s === 'nooption') { patchView({ option: null, display: 'Demolition' }); say('Scenario: view lost its Design Option') }
    if (s === 'locked') { patchView({ perms: { ...view.perms, 'L-str': { visible: true, selectable: true, editable: false }, 'L-svc': { visible: false, selectable: false, editable: false } } }); say('Scenario: Structure read-only, Services hidden') }
    if (s === 'import') setModal({ kind: 'import' })
  }
  // hidden-content warnings remain canonical
  const warnings = useMemo(() => {
    const out: string[] = []
    const ents = effective.filter(e => e.state === 'Proposed' || e.state === 'Existing')
    const isl = ents.find(e => e.id === 'i1'); const pipe = ents.find(e => e.id === 'p1a')
    if (isl && pipe && isl.x < pipe.x + pipe.w) out.push(`Clearance: Island overlaps P-1′ waste run${perm(pipe.layer).visible ? '' : ' (Services hidden in this view — warning still applies)'}`)
    const f = ents.find(e => e.id === 'f1'); const k = ents.find(e => e.id === 'k1a')
    if (f && k && k.x + k.w > f.x) out.push('Overlap: Base 600 #1′ runs into Fridge')
    return out
  }, [effective, view])

  return {
    layers, baseline, options, annotations, views, view, viewId, setViewId, option, patchView, perm, setPerm, order, projectOrder, layerName, layerColor, needsOption,
    effective, drawn, shownState, sel, selected, setSelected, cycle, stateFilter, setStateFilter, tool, setTool, toolOk, click, move, replace, markDemolition, deleteEnt,
    restore, setLayerOf, members, deleteLayer, addLayer, renameLayer, moveInOrder, paste, activeLayer, setActiveLayer, modal, setModal, toast, warn, log, say,
    correctBaseline, createAnnotationsLayerAndPlace, addAnnotation, scenario, warnings, editBlock,
    setLayerColor: (id: string, c: string) => setLayers(ls => ls.map(l => (l.id === id ? { ...l, color: c } : l))),
  }
}
type M = ReturnType<typeof useModel>

/* ---------- shared pieces ---------- */
function Canvas({ m }: { m: M }) {
  const ref = useRef<SVGSVGElement>(null)
  const onClick = (ev: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect(); m.click(((ev.clientX - r.left) / r.width) * 800, ((ev.clientY - r.top) / r.height) * 480)
  }
  return <svg ref={ref} className={`plan disp-${m.view.display} ${m.tool !== 'Select' ? 'placing' : ''}`} viewBox="0 0 800 480" onClick={onClick}>
    <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#ff6b6b" strokeWidth="2" /></pattern></defs>
    <rect x="52" y="52" width="348" height="376" className="room" /><rect x="412" y="52" width="336" height="376" className="room" />
    <text x="70" y="410" className="room-label">Kitchen</text><text x="430" y="410" className="room-label">Dining</text>
    {m.drawn.map(e => {
      const st = m.shownState(e); const c = m.layerColor(e.layer); const s = m.selected === e.id
      const locked = !m.perm(e.layer).editable; const nosel = !m.perm(e.layer).selectable
      const cls = `ent st-${st ?? 'none'} ${s ? 'sel' : ''} ${nosel ? 'nosel' : ''}`
      if (e.kind === 'Annotation') return <text key={e.id} x={e.x} y={e.y} className={cls} fill={c} fontSize="13">{e.text}{locked ? ' [RO]' : ''}</text>
      const fill = e.kind === 'Wall' || e.kind === 'Door' ? c : `${c}33`
      return <g key={e.id} className={cls}>
        <rect x={e.x} y={e.y} width={e.w} height={e.h} fill={fill} stroke={c} strokeWidth={e.kind === 'Pipe' ? 1 : 2} rx={e.kind === 'Power point' ? 8 : 2} />
        {st === 'Demolition' && <rect x={e.x} y={e.y} width={e.w} height={e.h} className="demo-overlay" fill="url(#hatch)" />}
        {st === 'Proposed' && <rect x={e.x - 3} y={e.y - 3} width={e.w + 6} height={e.h + 6} className="prop-overlay" />}
        {e.w > 50 && e.h > 30 && <text x={e.x + 6} y={e.y + 16} className="ent-label">{e.ref}{locked ? ' [RO]' : ''}</text>}
      </g>
    })}
    {m.cycle && m.cycle.ids.length > 1 && <g transform={`translate(${Math.min(m.cycle.x + 10, 610)},${Math.min(m.cycle.y + 10, 380)})`} className="cycle-pop">
      <rect width="180" height={22 + m.cycle.ids.length * 18} rx="6" />
      <text x="8" y="15" className="cycle-head">Overlap {m.cycle.i + 1}/{m.cycle.ids.length} · click again to cycle</text>
      {m.cycle.ids.map((id, k) => { const e = m.effective.find(z => z.id === id)!; return <text key={id} x="8" y={33 + k * 18} className={`cycle-row ${k === m.cycle!.i ? 'on' : ''}`}>{k === m.cycle!.i ? '▶ ' : '   '}[{m.shownState(e)}] {e.ref}</text> })}
    </g>}
  </svg>
}
function OptionPicker({ m }: { m: M }) {
  return <select value={m.view.option ?? ''} onChange={e => m.patchView({ option: e.target.value || null })} title="Active Design Option of this saved view">
    <option value="">— no Design Option —</option>{m.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
  </select>
}
function ViewPicker({ m }: { m: M }) {
  return <select value={m.viewId} onChange={e => m.setViewId(e.target.value)} title="Saved view">{m.views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
}
function Segmented({ m }: { m: M }) {
  return <span className="seg">{displays.map(d => <button key={d} className={`d-${d} ${m.view.display === d ? 'on' : ''}`} onClick={() => m.patchView({ display: d })}>{d}</button>)}</span>
}
function ScenarioMenu({ m }: { m: M }) {
  return <select value="" onChange={e => { m.scenario(e.target.value); e.target.value = '' }} className="scenario"><option value="">Scenarios ▾</option>
    <option value="normal">Reset to normal planning</option><option value="locked">Structure locked + Services hidden</option><option value="nooption">View without Design Option</option>
    <option value="zero">Zero-layer Project</option><option value="import">Strict import rejection</option></select>
}
function NeedsOption({ m }: { m: M }) {
  if (!m.needsOption) return null
  return <div className="banner error">{m.view.display} display needs an active Design Option. Nothing is drawn from options; editing tools are disabled. <OptionPicker m={m} /> or <button className="mini" onClick={() => m.patchView({ display: 'Existing' })}>Show Existing</button></div>
}
function Warnings({ m }: { m: M }) {
  return m.warnings.length ? <div className="banner warn">{m.warnings.map(w => <span key={w}>⚠ {w}</span>)}</div> : null
}
function StateFilter({ m }: { m: M }) {
  return <span className="state-filter" title="Temporary selection filter — not saved">Pick:{(['Existing', 'Demolition', 'Proposed'] as RState[]).map(s => <button key={s} className={`mini chip-${s} ${m.stateFilter.includes(s) ? 'on' : ''}`} onClick={() => m.setStateFilter(m.stateFilter.includes(s) ? m.stateFilter.filter(x => x !== s) : [...m.stateFilter, s])}>{s}</button>)}</span>
}
function Inspector({ m }: { m: M }) {
  const e = m.sel
  if (!e) return <div className="insp empty">Nothing selected. Click an entity; click the same spot again to cycle overlapping Existing / Demolition / Proposed candidates.</div>
  const st = m.shownState(e); const block = m.editBlock(e); const ro = !m.perm(e.layer).editable
  const preds = e.preds?.map(p => m.baseline.find(b => b.id === p)?.ref ?? `⚠ ${p}`)
  const succ = m.option?.proposed.filter(p => p.preds?.includes(e.id)).map(p => p.ref)
  return <div className="insp">
    <h3>{e.ref} <span className={`badge b-${st ?? 'none'}`}>{st ?? 'Annotation'}</span></h3>
    <dl><dt>Kind</dt><dd>{e.kind}</dd>
      <dt>Owner</dt><dd>{e.kind === 'Annotation' ? 'View drawing content' : e.state === 'Proposed' ? m.option?.name : 'Existing Model (shared)'}</dd>
      {preds && <><dt>Replaces</dt><dd>{preds.join(', ')}</dd></>}
      {succ && succ.length > 0 && <><dt>Successor</dt><dd>{succ.join(', ')}</dd></>}
      <dt>Layer</dt><dd><select value={e.layer ?? UNL} disabled={ro} onChange={ev => m.setLayerOf(e, ev.target.value === UNL ? null : ev.target.value)}>{m.layers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}<option value={UNL}>Unlayered</option></select></dd></dl>
    {ro && <div className="ro">[RO] Read-only in this view: inspect only.</div>}
    {block && !ro && <div className="ro">{block}</div>}
    <div className="actions">
      {e.kind !== 'Annotation' && st === 'Existing' && m.view.display === 'Existing' && <button disabled={ro} onClick={() => m.move(e, 20)}>Correct Existing Model… (move)</button>}
      {(st !== 'Existing' || m.view.display !== 'Existing' || e.kind === 'Annotation') && <button disabled={!!block} onClick={() => m.move(e, 20)}>Move →</button>}
      {st === 'Existing' && m.option && ['Demolition', 'Combined'].includes(m.view.display) && <><button disabled={ro} onClick={() => m.markDemolition(e)}>Mark demolition</button><button disabled={ro} onClick={() => m.replace(e, 10)}>Replace…</button></>}
      {st === 'Demolition' && m.view.display !== 'Existing' && <button disabled={ro} onClick={() => m.setModal({ kind: 'restore', id: e.id })}>Restore</button>}
      {(st === 'Proposed' || e.kind === 'Annotation') && <button disabled={!!block} onClick={() => m.deleteEnt(e)}>Delete</button>}
    </div>
  </div>
}
function Log({ m }: { m: M }) {
  return <details className="log"><summary>Transactions & state ({m.log.length})</summary><ol>{m.log.map((l, i) => <li key={i}>{l}</li>)}</ol>
    <pre>{JSON.stringify({ view: { option: m.view.option, display: m.view.display, order: m.view.order, snapHidden: m.view.snapHidden, perms: m.view.perms }, layers: m.layers.map(l => `${l.id}:${l.name}`), demolish: m.option?.demolish, proposed: m.option?.proposed.map(p => `${p.id}${p.preds ? `←${p.preds}` : ''}@${p.layer ?? 'unlayered'}`) }, null, 1)}</pre></details>
}
const toolButtons = (m: M, vertical = false) => tools.map(x => <button key={x.t} className={`tool ${m.tool === x.t ? 'on' : ''} ${m.toolOk(x.t) ? '' : 'off'}`} title={m.toolOk(x.t) ? x.t : `${toolWhy(x.t)}${m.needsOption ? ' and an active Design Option' : ''}`} onClick={() => m.setTool(x.t)}>{x.icon}{vertical ? '' : ` ${x.t}`}</button>)

// per-row layer controls, shared semantics; layout differs per variant
function PermToggles({ m, id }: { m: M; id: string }) {
  const p = m.perm(id === UNL ? null : id)
  return <span className="perm">
    <button className={`ico ${p.visible ? 'on' : ''}`} title="Visible" onClick={() => m.setPerm(id, { visible: !p.visible })}>{p.visible ? '◉' : '○'}</button>
    <button className={`ico ${p.selectable ? 'on' : ''}`} title="Selectable" onClick={() => m.setPerm(id, { selectable: !p.selectable })}>{p.selectable ? '↖' : '⊘'}</button>
    <button className={`ico ${p.editable ? 'on' : ''}`} title="Editable (off = read-only: select & inspect only)" onClick={() => m.setPerm(id, { editable: !p.editable })}>{p.editable ? '✎' : 'RO'}</button>
  </span>
}
function StyleOverride({ m, id }: { m: M; id: string }) {
  const p = m.perm(id === UNL ? null : id); const L = m.layers.find(l => l.id === id)
  return <span className="style-ov" title="View graphic override (Project default unchanged)">
    <input type="color" value={p.color ?? L?.color ?? '#c9a3ff'} onChange={e => m.setPerm(id, { color: e.target.value })} />
    {p.color && <button className="mini" onClick={() => m.setPerm(id, { color: undefined })}>reset</button>}
  </span>
}

/* ---------- dialogs (shared) ---------- */
function Dialogs({ m }: { m: M }) {
  const d = m.modal; if (!d) return null
  const close = () => m.setModal(null)
  const box = (title: string, body: React.ReactNode, cls = '') => <div className="scrim"><div className={`dialog ${cls}`}><h2>{title}</h2>{body}</div></div>
  if (d.kind === 'correct') {
    const e = m.baseline.find(b => b.id === d.id)!
    return box('Correct the shared Existing Model?', <>
      <p className="danger">This changes the survey baseline, not a Design Option. <b>Every Design Option</b> will see {e.ref} move:</p>
      <ul>{m.options.map(o => <li key={o.id}>{o.name}{o.demolish.includes(e.id) ? ' — demolishes it; its successor stays aligned' : ' — retains it as Existing'}</li>)}</ul>
      <p className="muted">One atomic transaction with dependent updates. Use this for measuring errors, not design changes.</p>
      <footer><button onClick={close}>Cancel</button><button className="danger-btn" onClick={() => { m.correctBaseline(d.id, d.dx); close() }}>Correct Existing Model</button></footer></>, 'danger')
  }
  if (d.kind === 'existingEdit') {
    const e = m.baseline.find(b => b.id === d.id)!
    return box(`${e.ref} belongs to the Existing Model`, <>
      <p>You are in <b>{m.view.display}</b> display editing <b>{m.option?.name}</b>. Moving a baseline entity is never done silently. Choose what you mean:</p>
      <footer className="stack"><button className="primary" onClick={() => { m.replace(m.effective.find(z => z.id === d.id)!, d.dx); close() }}>Replace in {m.option?.name} — demolish {e.ref}, add moved successor</button>
        <button className="danger-btn" onClick={() => m.setModal({ kind: 'correct', id: d.id, dx: d.dx })}>Correct Existing Model instead… (all options)</button>
        <button onClick={close}>Cancel — change nothing</button></footer></>)
  }
  if (d.kind === 'restore') {
    const e = m.baseline.find(b => b.id === d.id)!; const succ = m.option!.proposed.filter(p => p.preds?.includes(d.id))
    return box(`Restore ${e.ref}?`, <><p>Removes the demolition record in {m.option!.name}.</p>{succ.length > 0 && <p className="danger">Also deletes successor{succ.length > 1 ? 's' : ''}: {succ.map(s => s.ref).join(', ')}</p>}
      <footer><button onClick={close}>Cancel</button><button className="primary" onClick={() => { m.restore(d.id); close() }}>Restore</button></footer></>)
  }
  if (d.kind === 'deleteLayer') return <DeleteLayer m={m} id={d.id} />
  if (d.kind === 'paste') return <PasteMapping m={m} />
  if (d.kind === 'export') return <ExportDialog m={m} />
  if (d.kind === 'annLayer') return <AnnLayer m={m} x={d.x} y={d.y} />
  if (d.kind === 'import') return box('Import rejected — nothing was changed', <>
    <p>“kitchen-reno.buildbox” failed strict staged validation. The current Project is untouched.</p>
    <table className="reg"><thead><tr><th>Path</th><th>Problem</th></tr></thead><tbody>
      <tr><td>existingModel.entities[7]</td><td>Proposed entity found in the Existing Model</td></tr>
      <tr><td>options[optB].proposed[2].preds</td><td>Predecessor “w9” missing</td></tr>
      <tr><td>options[optA].proposed[0].preds</td><td>Predecessor owned by another option (cross-option reference)</td></tr>
      <tr><td>layers[3].id</td><td>Duplicate layer ID “L-svc”</td></tr>
      <tr><td>entities[w4].layer</td><td>Dangling layer ID “L-old” (not repaired to Unlayered)</td></tr>
      <tr><td>views[v2].perms.L-zzz</td><td>Override for unknown layer</td></tr>
      <tr><td className="ok">entities[t1].layer = null</td><td className="ok">valid: Unlayered</td></tr></tbody></table>
    <footer><button className="primary" onClick={close}>Close</button></footer></>)
  return null
}
function AnnLayer({ m, x, y }: { m: M; x: number; y: number }) {
  const [pick, setPick] = useState('create')
  return <div className="scrim"><div className="dialog"><h2>First Annotation on this Project</h2>
    <p>No “Annotations” layer exists. BuildBox creates an ordinary, mutable one unless you choose another.</p>
    <label><input type="radio" checked={pick === 'create'} onChange={() => setPick('create')} /> Create layer “Annotations” (default)</label>
    {m.layers.map(l => <label key={l.id}><input type="radio" checked={pick === l.id} onChange={() => setPick(l.id)} /> Use existing “{l.name}”</label>)}
    <label><input type="radio" checked={pick === UNL} onChange={() => setPick(UNL)} /> Unlayered</label>
    <footer><button onClick={() => m.setModal(null)}>Cancel</button><button className="primary" onClick={() => { if (pick === 'create') m.createAnnotationsLayerAndPlace(x, y); else m.addAnnotation(x, y, pick === UNL ? null : pick); m.setModal(null) }}>Place Annotation</button></footer></div></div>
}
function DeleteLayer({ m, id }: { m: M; id: string }) {
  const mem = m.members(id); const name = m.layerName(id)
  const ents = mem.filter(e => e.kind !== 'Annotation'); const anns = mem.filter(e => e.kind === 'Annotation')
  const viewHits = m.views.filter(v => v.perms[id] && (JSON.stringify(v.perms[id]) !== JSON.stringify(allPerm()) || v.order?.includes(id)))
  return <div className="scrim"><div className="dialog"><h2>Delete layer “{name}”?</h2>
    {mem.length === 0 && viewHits.length === 0 ? <p>Unused. Nothing else changes.</p> : <>
      <p>Nothing is deleted from the model. Members move to <b>Unlayered</b>; this layer's saved-view overrides are removed.</p>
      <table className="reg"><thead><tr><th>Dependency</th><th>Count</th><th>Result</th></tr></thead><tbody>
        <tr><td>Model entities (all options)</td><td>{ents.length}</td><td>→ Unlayered</td></tr>
        <tr><td>Annotations</td><td>{anns.length}</td><td>→ Unlayered</td></tr>
        <tr><td>Saved-view overrides</td><td>{viewHits.length}</td><td>removed{viewHits.length ? `: ${viewHits.map(v => v.name).join('; ')}` : ''}</td></tr></tbody></table>
      <p className="muted">{mem.slice(0, 8).map(e => e.ref).join(', ')}{mem.length > 8 ? '…' : ''}</p>
      <p className="muted">Unlayered uses its own per-view visibility — check it before deleting: currently {m.perm(null).visible ? 'visible' : 'HIDDEN'} in this view.</p></>}
    <footer><button onClick={() => m.setModal(null)}>Cancel — change nothing</button><button className="danger-btn" onClick={() => { m.deleteLayer(id); m.setModal(null) }}>Delete layer</button></footer></div></div>
}
function PasteMapping({ m }: { m: M }) {
  const suggest = (n: string) => m.layers.find(l => l.name.toLowerCase() === n.toLowerCase())?.id
  const [map, setMap] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const ready = otherProject.layers.every(l => map[l.id] && confirmed[l.id])
  return <div className="scrim"><div className="dialog wide"><h2>Paste from “{otherProject.name}” — map Drawing Layers</h2>
    <p>{otherProject.clip.length} entities. Source layer IDs don't exist here. Every source layer needs an explicit destination; name matches are only suggestions.</p>
    <table className="reg"><thead><tr><th>Source layer</th><th>Items</th><th>Destination</th><th /></tr></thead><tbody>{otherProject.layers.map(l => {
      const s = suggest(l.name); const v = map[l.id] ?? ''
      return <tr key={l.id}><td>{l.name}</td><td>{otherProject.clip.filter(c => c.layer === l.id).map(c => c.ref).join(', ')}</td>
        <td><select value={v} onChange={e => { setMap({ ...map, [l.id]: e.target.value }); setConfirmed({ ...confirmed, [l.id]: true }) }}><option value="">— choose —</option>{m.layers.map(d => <option key={d.id} value={d.id}>{d.name}{d.id === s ? ' (name match)' : ''}</option>)}<option value="new">Create “{l.name}” here</option><option value={UNL}>Unlayered</option></select></td>
        <td>{s && !confirmed[l.id] && <button className="mini" onClick={() => { setMap({ ...map, [l.id]: s }); setConfirmed({ ...confirmed, [l.id]: true }) }}>Use suggested “{m.layerName(s)}”</button>}</td></tr>
    })}</tbody></table>
    {m.view.display === 'Existing' && <p className="danger">Existing display: pasted model entities would land in the shared baseline — switch to Proposed/Combined. (Annotations still paste.)</p>}
    <footer><button onClick={() => m.setModal(null)}>Cancel</button><button className="primary" disabled={!ready} onClick={() => { m.paste(map); m.setModal(null) }}>Paste with this mapping</button></footer></div></div>
}
function ExportDialog({ m }: { m: M }) {
  const [tab, setTab] = useState<'drawing' | 'schedule'>('drawing')
  const [tmp, setTmp] = useState<Record<string, boolean>>(() => Object.fromEntries([...m.layers.map(l => l.id), UNL].map(id => [id, m.perm(id === UNL ? null : id).visible])))
  const [scope, setScope] = useState({ option: m.view.option ?? m.options[0]?.id, states: ['Existing', 'Proposed'] as RState[], layers: [...m.layers.map(l => l.id), UNL] })
  const opt = m.options.find(o => o.id === scope.option)
  const sched = [...m.baseline.map(e => ({ ...e, st: (opt?.demolish.includes(e.id) ? 'Demolition' : 'Existing') as RState })), ...(opt?.proposed ?? []).map(e => ({ ...e, st: 'Proposed' as RState }))]
    .filter(e => ['Cabinet', 'Appliance', 'Power point', 'Furniture'].includes(e.kind) && scope.states.includes(e.st) && scope.layers.includes(e.layer ?? UNL))
  const hiddenInView = sched.filter(e => !m.perm(e.layer).visible)
  const composition = { view: m.view.name, option: m.view.option, display: m.view.display, range: 'Plan cut 1200 / 0–2700', order: m.order.map(id => m.layerName(id)), layers: Object.entries(tmp).filter(([, v]) => v).map(([k]) => m.layerName(k)), overrides: Object.entries(m.view.perms).filter(([, p]) => p.color).map(([k, p]) => `${m.layerName(k)}=${p.color}`) }
  const tog = <T,>(a: T[], x: T) => (a.includes(x) ? a.filter(y => y !== x) : [...a, x])
  return <div className="scrim"><div className="dialog wide"><h2>Export</h2>
    <div className="tabs"><button className={tab === 'drawing' ? 'on' : ''} onClick={() => setTab('drawing')}>Drawing (SVG / PDF / PNG)</button><button className={tab === 'schedule' ? 'on' : ''} onClick={() => setTab('schedule')}>Schedule / quantities (CSV)</button></div>
    {tab === 'drawing' ? <>
      <p>Starts from the saved view. Toggles here are <b>temporary</b> and don't change “{m.view.name}”.</p>
      <div className="chips">{[...m.layers.map(l => l.id), UNL].map(id => <label key={id} className="chip"><input type="checkbox" checked={tmp[id]} onChange={() => setTmp({ ...tmp, [id]: !tmp[id] })} /> {m.layerName(id)}</label>)}<label className="chip"><input type="checkbox" /> Notes overlay</label></div>
      <pre className="comp">Recorded composition (repeat export is deterministic):{'\n'}{JSON.stringify(composition, null, 1)}</pre></> : <>
      <p>Data exports never inherit view hiding. Scope is explicit:</p>
      <div className="scope"><label>Design Option <select value={scope.option} onChange={e => setScope({ ...scope, option: e.target.value })}>{m.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <span>States {(['Existing', 'Demolition', 'Proposed'] as RState[]).map(s => <label key={s} className="chip"><input type="checkbox" checked={scope.states.includes(s)} onChange={() => setScope({ ...scope, states: tog(scope.states, s) })} />{s}</label>)}</span>
        <span>Layers {[...m.layers.map(l => l.id), UNL].map(id => <label key={id} className="chip"><input type="checkbox" checked={scope.layers.includes(id)} onChange={() => setScope({ ...scope, layers: tog(scope.layers, id) })} />{m.layerName(id)}</label>)}</span></div>
      {hiddenInView.length > 0 && <p className="warn-text">Included although hidden in the current view: {hiddenInView.map(e => e.ref).join(', ')}</p>}
      <table className="reg"><thead><tr><th>Item</th><th>Kind</th><th>State</th><th>Layer</th></tr></thead><tbody>{sched.map(e => <tr key={e.id}><td>{e.ref}</td><td>{e.kind}</td><td>{e.st}</td><td>{m.layerName(e.layer)}</td></tr>)}</tbody></table></>}
    <footer><button onClick={() => m.setModal(null)}>Close</button><button className="primary" onClick={() => { m.say(`Export ${tab} recorded`); m.setModal(null) }}>Export</button></footer></div></div>
}

/* ---------- Variant A: CAD panels ---------- */
function VariantA({ m }: { m: M }) {
  const [projOrder, setProjOrder] = useState(false)
  const rows = [...m.order].reverse()
  return <div className="va">
    <header className="toolbar"><b className="brand">BuildBox</b><ViewPicker m={m} /><OptionPicker m={m} /><Segmented m={m} /><span className="grow" />
      <StateFilter m={m} /><button onClick={() => m.setModal({ kind: 'paste' })}>Paste from other Project…</button><button onClick={() => m.setModal({ kind: 'export' })}>Export…</button><ScenarioMenu m={m} /></header>
    <NeedsOption m={m} /><Warnings m={m} />
    <div className="va-body">
      <nav className="palette">{toolButtons(m, true)}</nav>
      <main className="canvas-wrap"><Canvas m={m} /><Legend /></main>
      <aside className="side">
        <section><h4>Drawing Layers <span className="muted">front ↑</span></h4>
          <table className="layers"><thead><tr><th /><th>Layer</th><th>View</th><th>Style</th><th>Order</th><th /></tr></thead><tbody>{rows.map(id => {
            const L = m.layers.find(l => l.id === id)
            return <tr key={id} className={id === UNL ? 'unl' : ''}>
              <td><input type="radio" title="Active layer (fallback for new work)" checked={m.activeLayer === id} onChange={() => m.setActiveLayer(id)} /></td>
              <td>{L ? <input className="name" value={L.name} onChange={e => m.renameLayer(id, e.target.value)} /> : <i>Unlayered</i>}<small>{m.members(id).length || ''}</small></td>
              <td><PermToggles m={m} id={id} /></td><td><StyleOverride m={m} id={id} /></td>
              <td><button className="mini" onClick={() => m.moveInOrder(id, 1, projOrder ? 'project' : 'view')}>↑</button><button className="mini" onClick={() => m.moveInOrder(id, -1, projOrder ? 'project' : 'view')}>↓</button></td>
              <td>{L && <button className="mini" title="Delete layer…" onClick={() => m.setModal({ kind: 'deleteLayer', id })}>×</button>}</td></tr>
          })}</tbody></table>
          <div className="row"><button className="mini" onClick={() => m.addLayer()}>+ Layer</button>
            <label className="mini-l"><input type="checkbox" checked={projOrder} onChange={() => setProjOrder(!projOrder)} /> ↑↓ edits Project default</label>
            {m.view.order && <button className="mini" onClick={() => m.patchView({ order: null })}>Clear view order</button>}</div>
          <label className="mini-l"><input type="checkbox" checked={m.view.snapHidden} onChange={() => m.patchView({ snapHidden: !m.view.snapHidden })} /> Snap to hidden / non-selectable content</label>
          {m.layers.length === 0 && <p className="muted">This Project has no Drawing Layers. Everything is Unlayered — valid.</p>}
        </section>
        <section><h4>Inspector</h4><Inspector m={m} /></section>
        <Log m={m} />
      </aside>
    </div>
  </div>
}

/* ---------- Variant B: saved-view card ---------- */
const modeCopy: Record<Display, string> = {
  Existing: 'Surveying the shared baseline. Changes here are explicit corrections seen by every option.',
  Demolition: 'Marking what the option removes or replaces.',
  Proposed: 'Editing new work owned by the option. Demolished baseline is hidden.',
  Combined: 'Everything together. All state-aware tools; overlaps cycle on repeated click.',
}
function VariantB({ m }: { m: M }) {
  const [open, setOpen] = useState<string | null>(null)
  return <div className="vb">
    <aside className="card">
      <div className="card-head"><b className="brand">BuildBox</b><ScenarioMenu m={m} /></div>
      <label className="lab">Saved view</label><ViewPicker m={m} />
      <label className="lab">Design Option</label><OptionPicker m={m} />
      <label className="lab">Renovation Display</label>
      <div className="disp-cards">{displays.map(d => <button key={d} className={`dcard d-${d} ${m.view.display === d ? 'on' : ''}`} onClick={() => m.patchView({ display: d })}>
        <b>{d}</b><span className="mini-legend">{displayShows[d].map(s => <i key={s} className={`sw sw-${s}`} title={s} />)}</span></button>)}</div>
      <label className="lab">Layers <span className="muted">(front first)</span><button className="mini" onClick={() => m.addLayer()}>+</button></label>
      <ul className="lay-list">{[...m.order].reverse().map(id => {
        const L = m.layers.find(l => l.id === id); const p = m.perm(id === UNL ? null : id)
        return <li key={id} className={id === UNL ? 'unl' : ''}>
          <div className="lay-row" onClick={() => setOpen(open === id ? null : id)}>
            <input type="checkbox" checked={p.visible} onClick={e => e.stopPropagation()} onChange={() => m.setPerm(id, { visible: !p.visible })} />
            <i className="sw" style={{ background: m.layerColor(id === UNL ? null : id) }} /><span className="grow">{m.layerName(id)}</span>
            {!p.selectable && <em title="Not selectable">⊘</em>}{!p.editable && <em title="Read-only">[RO]</em>}{p.color && <em title="View style override">◐</em>}<span className="muted">{open === id ? '▾' : '▸'}</span></div>
          {open === id && <div className="lay-more">
            <label><input type="checkbox" checked={p.selectable} onChange={() => m.setPerm(id, { selectable: !p.selectable })} /> Selectable</label>
            <label><input type="checkbox" checked={p.editable} onChange={() => m.setPerm(id, { editable: !p.editable })} /> Editable</label>
            <label><input type="radio" checked={m.activeLayer === id} onChange={() => m.setActiveLayer(id)} /> Active</label>
            <div>Colour in this view <StyleOverride m={m} id={id} /></div>
            <div>View order <button className="mini" onClick={() => m.moveInOrder(id, 1, 'view')}>forward</button><button className="mini" onClick={() => m.moveInOrder(id, -1, 'view')}>back</button></div>
            {L && <div className="proj"><span className="muted">Project:</span> <input className="name" value={L.name} onChange={e => m.renameLayer(id, e.target.value)} /> <input type="color" value={L.color} onChange={e => m.setLayerColor(id, e.target.value)} title="Project default colour" />
              <button className="mini" onClick={() => m.moveInOrder(id, 1, 'project')}>↑</button><button className="mini" onClick={() => m.moveInOrder(id, -1, 'project')}>↓</button>
              <button className="mini danger-btn" onClick={() => m.setModal({ kind: 'deleteLayer', id })}>Delete…</button></div>}
          </div>}</li>
      })}</ul>
      {m.layers.length === 0 && <p className="muted">No Drawing Layers. All content is Unlayered.</p>}
      <label className="mini-l"><input type="checkbox" checked={m.view.snapHidden} onChange={() => m.patchView({ snapHidden: !m.view.snapHidden })} /> Snap to hidden content</label>
      {m.view.order && <button className="mini" onClick={() => m.patchView({ order: null })}>Use Project layer order</button>}
      <div className="card-foot"><button onClick={() => m.setModal({ kind: 'paste' })}>Paste from other Project…</button><button onClick={() => m.setModal({ kind: 'export' })}>Export…</button></div>
    </aside>
    <div className="vb-main">
      <div className={`modebar d-${m.view.display}`}><b>{m.view.display}</b><span>{m.option ? m.option.name : 'No Design Option'}</span><span className="muted grow">{modeCopy[m.view.display]}</span></div>
      <div className="ctx-tools">{tools.filter(x => m.toolOk(x.t)).map(x => <button key={x.t} className={`tool ${m.tool === x.t ? 'on' : ''}`} onClick={() => m.setTool(x.t)}>{x.icon} {x.t}</button>)}
        <span className="muted">{tools.filter(x => !m.toolOk(x.t)).length} tools hidden in this display</span><span className="grow" /><StateFilter m={m} /></div>
      <NeedsOption m={m} /><Warnings m={m} />
      <div className="vb-split"><main className="canvas-wrap"><Canvas m={m} /><Legend /></main><aside className="vb-insp"><Inspector m={m} /><Log m={m} /></aside></div>
    </div>
  </div>
}

/* ---------- Variant C: mode tabs + layer chips ---------- */
function VariantC({ m }: { m: M }) {
  const [menu, setMenu] = useState<string | null>(null)
  return <div className="vc">
    <header className="toolbar"><b className="brand">BuildBox</b><ViewPicker m={m} /><OptionPicker m={m} /><span className="grow" />
      <button onClick={() => m.setModal({ kind: 'paste' })}>Paste…</button><button onClick={() => m.setModal({ kind: 'export' })}>Export…</button><ScenarioMenu m={m} /></header>
    <div className="tabs-row">{displays.map(d => <button key={d} className={`mtab d-${d} ${m.view.display === d ? 'on' : ''}`} onClick={() => m.patchView({ display: d })}>{d}</button>)}</div>
    <div className={`frame d-${m.view.display}`}>
      <div className="chip-row">{[...m.order].reverse().map(id => {
        const p = m.perm(id === UNL ? null : id); const L = m.layers.find(l => l.id === id)
        return <span key={id} className={`lchip ${p.visible ? '' : 'hid'} ${id === UNL ? 'unl' : ''}`}>
          <button className="chipbtn" title="Toggle visibility" onClick={() => m.setPerm(id, { visible: !p.visible })}><i className="sw" style={{ background: m.layerColor(id === UNL ? null : id) }} />{m.layerName(id)}{!p.editable ? ' [RO]' : ''}{!p.selectable ? ' ⊘' : ''}</button>
          <button className="chipmore" onClick={() => setMenu(menu === id ? null : id)}>▾</button>
          {menu === id && <div className="chipmenu" onMouseLeave={() => setMenu(null)}><PermToggles m={m} id={id} /><StyleOverride m={m} id={id} />
            <div><button className="mini" onClick={() => m.moveInOrder(id, 1, 'view')}>◀ front</button><button className="mini" onClick={() => m.moveInOrder(id, -1, 'view')}>back ▶</button></div>
            <label><input type="radio" checked={m.activeLayer === id} onChange={() => m.setActiveLayer(id)} /> Active layer</label>
            {L && <><input className="name" value={L.name} onChange={e => m.renameLayer(id, e.target.value)} /><button className="mini danger-btn" onClick={() => { setMenu(null); m.setModal({ kind: 'deleteLayer', id }) }}>Delete layer…</button></>}</div>}
        </span>
      })}<button className="mini" onClick={() => m.addLayer()}>+ layer</button>
        <label className="mini-l"><input type="checkbox" checked={m.view.snapHidden} onChange={() => m.patchView({ snapHidden: !m.view.snapHidden })} /> snap hidden</label>
        {m.view.order && <button className="mini" onClick={() => m.patchView({ order: null })}>reset order</button>}</div>
      <NeedsOption m={m} /><Warnings m={m} />
      <main className="canvas-wrap">
        <div className="float-tools">{toolButtons(m, true)}<StateFilter m={m} /></div>
        <Canvas m={m} />{m.sel && <div className="float-insp"><button className="mini close" onClick={() => m.setSelected(null)}>×</button><Inspector m={m} /></div>}<Legend /></main>
    </div>
    <Log m={m} />
  </div>
}
function Legend() {
  return <div className="legend"><span><i className="sw sw-Existing" />Existing</span><span><i className="sw sw-Demolition" />Demolition (hatch overlay)</span><span><i className="sw sw-Proposed" />Proposed (halo overlay)</span><span className="muted">Layer colour is kept underneath renovation graphics</span></div>
}

/* ---------- shell + switcher ---------- */
function App() {
  const read = () => (new URLSearchParams(location.search).get('variant') as Variant) || 'A'
  const [variant, setVariant] = useState<Variant>(read)
  const m = useModel()
  const choose = (v: Variant) => { const u = new URL(location.href); u.searchParams.set('variant', v); history.replaceState(null, '', u); setVariant(v) }
  const cyc = (d: number) => { const all: Variant[] = ['A', 'B', 'C']; choose(all[(all.indexOf(variant) + d + 3) % 3]) }
  useEffect(() => {
    const k = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (t.closest('input,textarea,select,[contenteditable]')) return; if (e.key === 'ArrowLeft') cyc(-1); if (e.key === 'ArrowRight') cyc(1); if (e.key === 'Escape') { m.setTool('Select'); m.setSelected(null) } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  })
  return <div className="prototype"><div className="prototype-notice">Throwaway prototype · Renovation Displays & Drawing Layers · in-memory only</div>
    {variant === 'A' && <VariantA m={m} />}{variant === 'B' && <VariantB m={m} />}{variant === 'C' && <VariantC m={m} />}
    <Dialogs m={m} />{m.toast && <div className="toast">{m.toast}</div>}
    <div className="variant-switcher"><button onClick={() => cyc(-1)}>←</button>{(['A', 'B', 'C'] as Variant[]).map(v => <button key={v} className={variant === v ? 'active' : ''} onClick={() => choose(v)}>{v}</button>)}<span>{variant} · {variantNames[variant]}</span><button onClick={() => cyc(1)}>→</button></div>
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
