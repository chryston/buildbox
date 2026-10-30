// THROWAWAY PROTOTYPE — Notes panel, Comments, and drawing Annotations.
// Three structurally different workspace variants, switchable with ?variant=A|B|C:
//   A · Docked Notes panel   B · Register tray + Annotate mode   C · Selection-first inspector + Add menu
// All state is in memory. Nothing here is production code.
import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Variant = 'A' | 'B' | 'C'
const variantNames: Record<Variant, string> = { A: 'Docked Notes panel', B: 'Register tray + Annotate mode', C: 'Selection-first + Add menu' }

/* ---------- domain stubs ---------- */
type OptionId = 'existing' | 'optA' | 'optB'
const options: { id: OptionId; name: string }[] = [
  { id: 'existing', name: 'Existing Model' },
  { id: 'optA', name: 'Option A · Open kitchen' },
  { id: 'optB', name: 'Option B · Island' },
]
const floors = [{ id: 'gf', name: 'Ground Floor' }, { id: 'l2', name: 'Level 2' }]
const views = [
  { id: 'gf-plan', name: 'Ground Floor · Plan' },
  { id: 'k-north', name: 'Kitchen · North Elevation' },
  { id: 'base600-detail', name: 'Base 600 · Item Detail' },
]
const layers = ['Notes', 'Revisions', 'Client markup']
const itemDesigns: Record<string, string> = { base600: 'Base 600', island: 'Island 1600', fridge: 'Fridge tall' }

type Entity = { id: string; label: string; kind: 'Room' | 'Wall' | 'Placed Item'; design?: string; floor: string; option: OptionId; x: number; y: number; w: number; h: number; features?: string[] }
const initialEntities: Entity[] = [
  { id: 'kitchen', label: 'Kitchen', kind: 'Room', floor: 'gf', option: 'existing', x: 40, y: 40, w: 380, h: 300 },
  { id: 'living', label: 'Living', kind: 'Room', floor: 'gf', option: 'existing', x: 420, y: 40, w: 340, h: 420 },
  { id: 'w3', label: 'Wall W-3', kind: 'Wall', floor: 'gf', option: 'existing', x: 414, y: 40, w: 12, h: 300, features: ['face-kitchen', 'face-living'] },
  { id: 'b1', label: 'Base 600 #1', kind: 'Placed Item', design: 'base600', floor: 'gf', option: 'existing', x: 60, y: 46, w: 110, h: 56 },
  { id: 'b2', label: 'Base 600 #2', kind: 'Placed Item', design: 'base600', floor: 'gf', option: 'existing', x: 176, y: 46, w: 110, h: 56 },
  { id: 'f1', label: 'Fridge #1', kind: 'Placed Item', design: 'fridge', floor: 'gf', option: 'existing', x: 340, y: 46, w: 66, h: 66 },
  { id: 'i1', label: 'Island #1', kind: 'Placed Item', design: 'island', floor: 'gf', option: 'optB', x: 150, y: 180, w: 170, h: 70 },
]

type Anchor =
  | { kind: 'project' }
  | { kind: 'floor'; floor: string }
  | { kind: 'option'; option: OptionId }
  | { kind: 'design'; design: string }
  | { kind: 'entity'; id: string }
  | { kind: 'feature'; id: string; feature: string; t: number }
  | { kind: 'point'; floor: string; x: number; y: number }
type Scope = 'all' | OptionId
type Priority = 'Low' | 'Normal' | 'High'
type Comment = { id: string; ref: string; title: string; body: string; anchor: Anchor; status: 'Open' | 'Resolved'; priority: Priority; scope: Scope; updated: string; warning?: string }
type AnnType = 'Text' | 'Leader' | 'Arrow' | 'Revision Cloud' | 'Reference Marker'
type Style = { size: 'S' | 'M' | 'L'; color: string; weight: 1 | 2 | 3; dash: boolean; arrow: boolean; fill: boolean; shape: 'circle' | 'hexagon' }
type Annotation = { id: string; ref: string; type: AnnType; view: string; x: number; y: number; endpoint?: { id: string; feature?: string; t?: number; x?: number; y?: number }; text: string; target?: string; layer: string; scope: Scope; style: Style }

const palette = ['#ffb547', '#ff6b6b', '#6eb7ff', '#74d99f', '#d9a6ff']
const defaultStyle: Style = { size: 'M', color: '#ffb547', weight: 2, dash: false, arrow: true, fill: false, shape: 'circle' }

const initialComments: Comment[] = [
  { id: 'c1', ref: 'C-001', title: 'Confirm overall budget cap', body: 'Contractor quote due Friday.', anchor: { kind: 'project' }, status: 'Open', priority: 'Normal', scope: 'all', updated: '28 Oct' },
  { id: 'c2', ref: 'C-002', title: 'Check outlet heights', body: 'Counter outlets at 1100 AFF?', anchor: { kind: 'entity', id: 'kitchen' }, status: 'Open', priority: 'High', scope: 'existing', updated: '29 Oct' },
  { id: 'c3', ref: 'C-003', title: 'Use soft-close hinges', body: 'Applies to every Base 600.', anchor: { kind: 'design', design: 'base600' }, status: 'Open', priority: 'Normal', scope: 'all', updated: '29 Oct' },
  { id: 'c4', ref: 'C-004', title: 'Shift 50 mm for dishwasher', body: 'Only this cabinet.', anchor: { kind: 'entity', id: 'b2' }, status: 'Open', priority: 'High', scope: 'existing', updated: '30 Oct' },
  { id: 'c5', ref: 'C-005', title: 'Plaster crack on wall face', body: 'Photographed at survey.', anchor: { kind: 'feature', id: 'w3', feature: 'face-kitchen', t: 0.62 }, status: 'Resolved', priority: 'Low', scope: 'existing', updated: '20 Oct' },
  { id: 'c6', ref: 'C-006', title: 'Water stain on slab', body: 'Investigate before flooring.', anchor: { kind: 'point', floor: 'gf', x: 600, y: 380 }, status: 'Open', priority: 'Normal', scope: 'all', updated: '25 Oct' },
  { id: 'c7', ref: 'C-007', title: 'Island needs floor power', body: 'Coordinate with electrician.', anchor: { kind: 'entity', id: 'i1' }, status: 'Open', priority: 'Normal', scope: 'optB', updated: '30 Oct' },
  { id: 'c8', ref: 'C-008', title: 'Stair survey on Level 2', body: '', anchor: { kind: 'floor', floor: 'l2' }, status: 'Open', priority: 'Low', scope: 'all', updated: '18 Oct' },
]
const initialAnnotations: Annotation[] = [
  { id: 'a1', ref: 'A-001', type: 'Text', view: 'gf-plan', x: 520, y: 110, text: 'Remove wall to 1100 AFF', layer: 'Notes', scope: 'all', style: { ...defaultStyle, color: '#6eb7ff' } },
  { id: 'a2', ref: 'A-002', type: 'Leader', view: 'gf-plan', x: 520, y: 220, endpoint: { id: 'w3', feature: 'face-living', t: 0.5 }, text: 'Check for services', layer: 'Notes', scope: 'all', style: defaultStyle },
  { id: 'a3', ref: 'A-003', type: 'Revision Cloud', view: 'gf-plan', x: 235, y: 215, text: 'Rev B', layer: 'Revisions', scope: 'optB', style: { ...defaultStyle, color: '#ff6b6b' } },
  { id: 'a4', ref: 'A-004', type: 'Reference Marker', view: 'gf-plan', x: 230, y: 320, text: '1', target: 'k-north', layer: 'Notes', scope: 'all', style: { ...defaultStyle, color: '#74d99f' } },
]

/* ---------- derived helpers ---------- */
const optName = (s: Scope) => (s === 'all' ? 'All Options' : options.find(o => o.id === s)!.name)
function featurePoint(e: Entity, feature: string, t: number) {
  const x = feature === 'face-kitchen' ? e.x : e.x + e.w
  return { x, y: e.y + e.h * t }
}
function anchorLabel(a: Anchor, ents: Entity[]) {
  switch (a.kind) {
    case 'project': return 'Project'
    case 'floor': return `Floor · ${floors.find(f => f.id === a.floor)!.name}`
    case 'option': return `Design Option · ${optName(a.option)}`
    case 'design': return `Item Design · ${itemDesigns[a.design]}`
    case 'entity': { const e = ents.find(x => x.id === a.id); return `${e?.kind ?? 'Entity'} · ${e?.label ?? '⚠ missing'}` }
    case 'feature': { const e = ents.find(x => x.id === a.id); return `Feature · ${e?.label} / ${a.feature} @ ${Math.round(a.t * 100)}%` }
    case 'point': return `Floor Point · ${floors.find(f => f.id === a.floor)!.name} (${a.x}, ${a.y})`
  }
}
function anchorPos(a: Anchor, ents: Entity[]): { x: number; y: number } | null {
  if (a.kind === 'point') return a.floor === 'gf' ? { x: a.x, y: a.y } : null
  if (a.kind === 'entity') { const e = ents.find(x => x.id === a.id); return e && e.floor === 'gf' ? { x: e.x + e.w - 6, y: e.y + 8 } : null }
  if (a.kind === 'feature') { const e = ents.find(x => x.id === a.id); return e && e.features?.includes(a.feature) ? featurePoint(e, a.feature, a.t) : null }
  return null
}
function effectiveScope(c: Comment, ents: Entity[]): Scope {
  if (c.anchor.kind === 'entity' || c.anchor.kind === 'feature') { const id = c.anchor.id; return ents.find(e => e.id === id)?.option ?? c.scope }
  return c.scope
}
function scopeVisible(scope: Scope, active: OptionId) { return scope === 'all' || scope === 'existing' || scope === active }
function entityVisible(e: Entity, active: OptionId) { return e.option === 'existing' || e.option === active }
function annEndpoint(a: Annotation, ents: Entity[]) {
  if (!a.endpoint) return null
  if (a.endpoint.x !== undefined) return { x: a.endpoint.x, y: a.endpoint.y! }
  const e = ents.find(x => x.id === a.endpoint!.id)
  if (!e) return null
  return a.endpoint.feature ? featurePoint(e, a.endpoint.feature, a.endpoint.t ?? 0.5) : { x: e.x + e.w / 2, y: e.y + e.h / 2 }
}

/* ---------- model hook (shared by all variants) ---------- */
type Filters = { context: boolean; status: 'Open' | 'Resolved' | 'Any'; priority: Priority | 'Any'; target: string; search: string; annType: AnnType | 'Any'; layer: string }
const initialFilters: Filters = { context: true, status: 'Open', priority: 'Any', target: 'Any', search: '', annType: 'Any', layer: 'Any' }
type Review = { title: string; subject: string; items: { key: string; label: string; choice?: 'point' | 'delete' | 'reanchor'; reanchor?: string }[]; onConfirm: (choices: Record<string, { choice: string; reanchor?: string }>) => void } | null
type Tool = AnnType | 'Comment' | null

function useNotesModel() {
  const [entities, setEntities] = useState(initialEntities)
  const [comments, setComments] = useState(initialComments)
  const [annotations, setAnnotations] = useState(initialAnnotations)
  const [activeOption, setActiveOption] = useState<OptionId>('existing')
  const [overlay, setOverlay] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedNote, setSelectedNote] = useState<string | null>(null)
  const [filters, setFilters] = useState(initialFilters)
  const [tool, setTool] = useState<Tool>(null)
  const [review, setReview] = useState<Review>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [warningAck, setWarningAck] = useState(false)
  const [nextC, setNextC] = useState(9)
  const [nextA, setNextA] = useState(5)
  const [log, setLog] = useState<string[]>(['Prototype loaded — overlay off by default'])
  const note = (s: string) => setLog(l => [s, ...l].slice(0, 6))

  const visibleComments = useMemo(() => comments.filter(c => {
    const scope = effectiveScope(c, entities)
    if (filters.status !== 'Any' && c.status !== filters.status) return false
    if (filters.priority !== 'Any' && c.priority !== filters.priority) return false
    if (filters.target !== 'Any' && c.anchor.kind !== filters.target) return false
    if (filters.search && !`${c.ref} ${c.title} ${c.body}`.toLowerCase().includes(filters.search.toLowerCase())) return false
    if (filters.context) {
      if (!scopeVisible(scope, activeOption)) return false
      if (c.anchor.kind === 'floor' && c.anchor.floor !== 'gf') return false
      if (c.anchor.kind === 'point' && c.anchor.floor !== 'gf') return false
      if (c.anchor.kind === 'option' && c.anchor.option !== activeOption) return false
      if (c.anchor.kind === 'entity') { const id = c.anchor.id; const e = entities.find(x => x.id === id); if (e && !entityVisible(e, activeOption)) return false }
    }
    return true
  }), [comments, entities, filters, activeOption])
  const visibleAnnotations = useMemo(() => annotations.filter(a => {
    if (filters.annType !== 'Any' && a.type !== filters.annType) return false
    if (filters.layer !== 'Any' && a.layer !== filters.layer) return false
    if (filters.search && !`${a.ref} ${a.text}`.toLowerCase().includes(filters.search.toLowerCase())) return false
    if (filters.context && !scopeVisible(a.scope, activeOption)) return false
    return true
  }), [annotations, filters, activeOption])

  function dependentsOf(id: string, feature?: string) {
    const cs = comments.filter(c => (c.anchor.kind === 'entity' || c.anchor.kind === 'feature') && c.anchor.id === id && (!feature || (c.anchor.kind === 'feature' && c.anchor.feature === feature)))
    const as = annotations.filter(a => a.endpoint?.id === id && (!feature || a.endpoint.feature === feature))
    return { cs, as }
  }
  function applyChoices(cs: Comment[], as: Annotation[], choices: Record<string, { choice: string; reanchor?: string }>) {
    setComments(all => all.flatMap(c => {
      const ch = choices[c.id]; if (!ch || !cs.includes(c)) return [c]
      if (ch.choice === 'delete') return []
      if (ch.choice === 'point') { const p = anchorPos(c.anchor, entities) ?? { x: 400, y: 250 }; return [{ ...c, anchor: { kind: 'point', floor: 'gf', x: Math.round(p.x), y: Math.round(p.y) } as Anchor, updated: 'now' }] }
      return [{ ...c, anchor: { kind: 'entity', id: ch.reanchor! } as Anchor, updated: 'now' }]
    }))
    setAnnotations(all => all.flatMap(a => {
      const ch = choices[a.id]; if (!ch || !as.includes(a)) return [a]
      if (ch.choice === 'delete') return []
      if (ch.choice === 'point') { const p = annEndpoint(a, entities)!; return [{ ...a, endpoint: { id: '', x: p.x, y: p.y } }] }
      return [{ ...a, endpoint: { id: ch.reanchor! } }]
    }))
  }
  function requestDelete(id: string) {
    const e = entities.find(x => x.id === id)!
    const { cs, as } = dependentsOf(id)
    const remove = () => { setEntities(all => all.filter(x => x.id !== id)); setSelected(null); note(`Deleted ${e.label}`) }
    if (!cs.length && !as.length) return remove()
    setReview({
      title: `Delete ${e.label}?`, subject: `${cs.length + as.length} anchored record(s) block deletion. Choose for each — nothing is detached or guessed.`,
      items: [...cs.map(c => ({ key: c.id, label: `${c.ref} ${c.title} (${c.status})` })), ...as.map(a => ({ key: a.id, label: `${a.ref} ${a.type} · “${a.text}”` }))],
      onConfirm: ch => { applyChoices(cs, as, ch); remove() },
    })
  }
  function moveWall() { setEntities(all => all.map(e => e.id === 'w3' ? { ...e, x: e.x + 30 } : e.id === 'kitchen' ? { ...e, w: e.w + 30 } : e.id === 'living' ? { ...e, x: e.x + 30, w: e.w - 30 } : e)); note('Compatible edit: moved W-3 +30 — feature anchors follow') }
  function splitWall() {
    const { cs, as } = dependentsOf('w3', 'face-kitchen')
    const split = () => { setEntities(all => all.map(e => e.id === 'w3' ? { ...e, features: ['face-living'] } : e)); note('Replaced W-3 kitchen face') }
    if (!cs.length && !as.length) return split()
    setReview({ title: 'Replace W-3 kitchen face?', subject: 'This removes feature “face-kitchen”. Its anchors need an explicit decision; BuildBox will not pick the nearest new face.', items: [...cs.map(c => ({ key: c.id, label: `${c.ref} ${c.title} (${c.status})` })), ...as.map(a => ({ key: a.id, label: `${a.ref} ${a.type}` }))], onConfirm: ch => { applyChoices(cs, as, ch); split() } })
  }
  function requestDeleteOption(opt: OptionId) {
    const cs = comments.filter(c => effectiveScope(c, entities) === opt || (c.anchor.kind === 'option' && c.anchor.option === opt))
    const as = annotations.filter(a => a.scope === opt)
    setReview({ title: `Delete ${optName(opt)}?`, subject: 'Owned and anchored notes are listed. Deletion includes them deliberately; switch any to “move to All Options” to keep it.', items: [...cs.map(c => ({ key: c.id, label: `${c.ref} ${c.title}`, choice: 'delete' as const })), ...as.map(a => ({ key: a.id, label: `${a.ref} ${a.type}`, choice: 'delete' as const }))], onConfirm: ch => {
      setComments(all => all.flatMap(c => !cs.includes(c) ? [c] : ch[c.id]?.choice === 'delete' ? [] : [{ ...c, scope: 'all' as Scope, anchor: c.anchor.kind === 'entity' ? { kind: 'point', floor: 'gf', ...anchorPos(c.anchor, entities)! } as Anchor : c.anchor }]))
      setAnnotations(all => all.flatMap(a => !as.includes(a) ? [a] : ch[a.id]?.choice === 'delete' ? [] : [{ ...a, scope: 'all' as Scope }]))
      setEntities(all => all.filter(e => e.option !== opt)); setActiveOption('existing'); note(`Deleted ${optName(opt)} with reviewed notes`)
    } })
  }
  function addComment(anchor: Anchor, title = 'New comment', extra: Partial<Comment> = {}) {
    const ref = `C-${String(nextC).padStart(3, '0')}`
    const id = `c${nextC}`
    setNextC(n => n + 1)
    setComments(all => [...all, { id, ref, title, body: '', anchor, status: 'Open', priority: 'Normal', scope: anchor.kind === 'entity' || anchor.kind === 'feature' ? 'existing' : 'all', updated: 'now', ...extra }])
    setSelectedNote(id); note(`Created ${ref} on ${anchorLabel(anchor, entities)}`)
    return id
  }
  function placeAt(x: number, y: number, hit: Entity | null) {
    if (!tool) { setSelected(hit?.id ?? null); setFocus(null); return }
    if (tool === 'Comment') { addComment(hit ? { kind: 'entity', id: hit.id } : { kind: 'point', floor: 'gf', x: Math.round(x), y: Math.round(y) }); setTool(null); return }
    const ref = `A-${String(nextA).padStart(3, '0')}`
    const id = `a${nextA}`
    setNextA(n => n + 1)
    const base: Annotation = { id, ref, type: tool, view: 'gf-plan', x: Math.round(x), y: Math.round(y), text: tool === 'Reference Marker' ? String(nextA) : tool, layer: tool === 'Revision Cloud' ? 'Revisions' : 'Notes', scope: 'all', style: defaultStyle }
    if (tool === 'Leader' || tool === 'Arrow') { base.x += 90; base.y -= 60; base.endpoint = hit ? { id: hit.id } : { id: '', x: Math.round(x), y: Math.round(y) } }
    if (tool === 'Reference Marker') base.target = 'k-north'
    setAnnotations(all => [...all, base]); setSelectedNote(id); setTool(null); note(`Placed ${ref} ${tool}${hit ? ` anchored to ${hit.label}` : ''}`)
  }
  const updateComment = (id: string, patch: Partial<Comment>) => setComments(all => all.map(c => c.id === id ? { ...c, ...patch, updated: 'now' } : c))
  const updateAnnotation = (id: string, patch: Partial<Annotation>) => setAnnotations(all => all.map(a => a.id === id ? { ...a, ...patch } : a))
  const toggleStatus = (id: string) => { const c = comments.find(x => x.id === id)!; updateComment(id, { status: c.status === 'Open' ? 'Resolved' : 'Open' }); note(`${c.ref} ${c.status === 'Open' ? 'resolved' : 'reopened'}`) }
  const deleteComment = (id: string) => { setComments(all => all.filter(c => c.id !== id)); setSelectedNote(null); note('Comment deleted (undoable via history)') }
  const deleteAnnotation = (id: string) => { setAnnotations(all => all.filter(a => a.id !== id)); setSelectedNote(null) }
  const focusNote = (id: string) => { setSelectedNote(id); setFocus(id); if (!overlay) note('Temporary focus: revealing one note with overlay off') }
  const commentFromWarning = () => addComment({ kind: 'entity', id: 'i1' }, 'Follow up: island clearance 820 mm', { warning: 'W-clearance', priority: 'High', scope: 'optB' })
  const tryDeleteView = () => { const n = annotations.filter(a => a.target === 'k-north').length; note(n ? `Blocked: “Kitchen · North Elevation” has ${n} incoming Reference Marker(s)` : 'View deleted') }

  return { entities, comments, annotations, activeOption, setActiveOption, overlay, setOverlay, focus, setFocus, selected, setSelected, selectedNote, setSelectedNote, filters, setFilters, tool, setTool, review, setReview, exportOpen, setExportOpen, warningAck, setWarningAck, log, visibleComments, visibleAnnotations, requestDelete, moveWall, splitWall, requestDeleteOption, addComment, placeAt, updateComment, updateAnnotation, toggleStatus, deleteComment, deleteAnnotation, focusNote, commentFromWarning, tryDeleteView }
}
type M = ReturnType<typeof useNotesModel>

/* ---------- canvas ---------- */
function PlanCanvas({ m, exportFlags }: { m: M; exportFlags?: { anns: boolean; pins: boolean; resolved: boolean } }) {
  const ents = m.entities.filter(e => e.floor === 'gf' && entityVisible(e, m.activeOption))
  const showAll = exportFlags ? false : m.overlay
  const pinOn = (c: Comment) => exportFlags ? exportFlags.pins && (exportFlags.resolved || c.status === 'Open') : showAll || m.focus === c.id
  const annOn = (a: Annotation) => exportFlags ? exportFlags.anns : showAll || m.focus === a.id
  const pins = m.comments.filter(c => scopeVisible(effectiveScope(c, m.entities), m.activeOption) && (exportFlags || showAll ? c.status === 'Open' || m.focus === c.id || !!exportFlags : true) && pinOn(c))
  const designCount = (d?: string) => d ? m.comments.filter(c => c.anchor.kind === 'design' && c.anchor.design === d && c.status === 'Open').length : 0
  const hitAt = (x: number, y: number) => [...ents].reverse().find(e => e.kind !== 'Room' && x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h) ?? ents.find(e => e.kind === 'Room' && x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h) ?? null
  return <svg className={`plan ${m.tool ? 'placing' : ''}`} viewBox="0 0 800 500" onClick={ev => {
    if (exportFlags) return
    const r = (ev.currentTarget as SVGSVGElement).getBoundingClientRect()
    const x = ((ev.clientX - r.left) / r.width) * 800, y = ((ev.clientY - r.top) / r.height) * 500
    m.placeAt(x, y, hitAt(x, y))
  }}>
    <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke" /></marker></defs>
    {ents.filter(e => e.kind === 'Room').map(e => <g key={e.id}><rect x={e.x} y={e.y} width={e.w} height={e.h} className={`room ${m.selected === e.id ? 'sel' : ''}`} /><text x={e.x + 14} y={e.y + e.h - 14} className="room-label">{e.label}</text></g>)}
    {ents.filter(e => e.kind === 'Wall').map(e => <g key={e.id}><rect x={e.x} y={e.y} width={e.w} height={e.h} className={`wall ${m.selected === e.id ? 'sel' : ''}`} />{!e.features?.includes('face-kitchen') && <line x1={e.x} y1={e.y} x2={e.x} y2={e.y + e.h} className="replaced-face" />}</g>)}
    {ents.filter(e => e.kind === 'Placed Item').map(e => { const n = designCount(e.design); return <g key={e.id}><rect x={e.x} y={e.y} width={e.w} height={e.h} rx="3" className={`item ${e.option !== 'existing' ? 'proposed' : ''} ${m.selected === e.id ? 'sel' : ''}`} /><text x={e.x + 6} y={e.y + e.h / 2 + 4} className="item-label">{e.label}</text>{n > 0 && (showAll || exportFlags?.pins) && <g className="badge"><rect x={e.x + 4} y={e.y + e.h - 18} width="34" height="14" rx="7" /><text x={e.x + 21} y={e.y + e.h - 8}>✎{n}</text></g>}</g> })}
    {m.annotations.filter(a => a.view === 'gf-plan' && scopeVisible(a.scope, m.activeOption) && annOn(a)).map(a => <AnnotationGlyph key={a.id} a={a} ents={m.entities} focused={m.focus === a.id || m.selectedNote === a.id} />)}
    {pins.map(c => { const p = anchorPos(c.anchor, m.entities); if (!p) return null; return <g key={c.id} className={`pin ${c.status === 'Resolved' ? 'resolved' : ''} ${c.priority === 'High' ? 'high' : ''} ${m.focus === c.id || m.selectedNote === c.id ? 'focused' : ''}`} onClick={ev => { ev.stopPropagation(); m.setSelectedNote(c.id) }}><line x1={p.x} y1={p.y} x2={p.x + 16} y2={p.y - 22} /><rect x={p.x + 14} y={p.y - 34} width={exportFlags ? 150 : 46} height="18" rx="9" /><text x={p.x + 22} y={p.y - 21}>{c.ref}{exportFlags ? ` ${c.title.slice(0, 16)} · ${c.status}` : ''}</text><circle cx={p.x} cy={p.y} r="4" /></g> })}
  </svg>
}
function AnnotationGlyph({ a, ents, focused }: { a: Annotation; ents: Entity[]; focused: boolean }) {
  const fs = { S: 11, M: 14, L: 18 }[a.style.size]
  const common = { stroke: a.style.color, strokeWidth: a.style.weight, strokeDasharray: a.style.dash ? '6 4' : undefined, fill: 'none' }
  const end = annEndpoint(a, ents)
  return <g className={`ann ${focused ? 'focused' : ''}`}>
    {a.type === 'Text' && <text x={a.x} y={a.y} fill={a.style.color} fontSize={fs}>{a.text}</text>}
    {(a.type === 'Leader' || a.type === 'Arrow') && end && <><line x1={a.x} y1={a.y} x2={end.x} y2={end.y} {...common} markerEnd={a.style.arrow ? 'url(#ah)' : undefined} />{a.type === 'Leader' && <text x={a.x + 4} y={a.y - 6} fill={a.style.color} fontSize={fs}>{a.text}</text>}</>}
    {a.type === 'Revision Cloud' && <><path d={cloud(a.x, a.y, 120, 60)} {...common} fill={a.style.fill ? a.style.color + '22' : 'none'} /><text x={a.x + 100} y={a.y - 50} fill={a.style.color} fontSize={fs}>△ {a.text}</text></>}
    {a.type === 'Reference Marker' && <g>{a.style.shape === 'circle' ? <circle cx={a.x} cy={a.y} r="16" {...common} /> : <path d={`M${a.x - 16} ${a.y}l8 -14h16l8 14l-8 14h-16z`} {...common} />}<text x={a.x} y={a.y + 5} textAnchor="middle" fill={a.style.color} fontSize={fs}>{a.text}</text><text x={a.x + 22} y={a.y + 5} fill={a.style.color} fontSize="11">→ {views.find(v => v.id === a.target)?.name}</text></g>}
  </g>
}
function cloud(cx: number, cy: number, w: number, h: number) {
  const x0 = cx - w / 2, y0 = cy - h / 2, r = 12
  let d = `M${x0} ${y0}`
  for (let x = x0; x < x0 + w; x += r * 2) d += ` a${r} ${r} 0 0 1 ${r * 2} 0`
  for (let y = y0; y < y0 + h; y += r * 2) d += ` a${r} ${r} 0 0 1 0 ${r * 2}`
  for (let x = x0 + w; x > x0; x -= r * 2) d += ` a${r} ${r} 0 0 1 ${-r * 2} 0`
  for (let y = y0 + h; y > y0; y -= r * 2) d += ` a${r} ${r} 0 0 1 0 ${-r * 2}`
  return d
}

/* ---------- shared pieces (rows, editors, dialogs) ---------- */
function CommentRow({ m, c, dense }: { m: M; c: Comment; dense?: boolean }) {
  const scope = effectiveScope(c, m.entities)
  return <div className={`note-row ${m.selectedNote === c.id ? 'sel' : ''} ${c.status === 'Resolved' ? 'resolved' : ''}`} onClick={() => m.focusNote(c.id)}>
    <span className={`prio ${c.priority}`} title={c.priority} />
    <div><strong>{c.ref} · {c.title}</strong>{!dense && <small>{anchorLabel(c.anchor, m.entities)} · {optName(scope)}{c.warning ? ' · linked Warning' : ''}</small>}</div>
    <button className="mini" onClick={ev => { ev.stopPropagation(); m.toggleStatus(c.id) }}>{c.status === 'Open' ? 'Resolve' : 'Reopen'}</button>
  </div>
}
function AnnotationRow({ m, a }: { m: M; a: Annotation }) {
  return <div className={`note-row ${m.selectedNote === a.id ? 'sel' : ''}`} onClick={() => m.focusNote(a.id)}>
    <span className="ann-swatch" style={{ background: a.style.color }} />
    <div><strong>{a.ref} · {a.type}</strong><small>“{a.text}” · {a.layer} layer · {optName(a.scope)}{a.endpoint?.id ? ` · anchored ${m.entities.find(e => e.id === a.endpoint!.id)?.label}` : ''}</small></div>
  </div>
}
function FilterBar({ m, compact }: { m: M; compact?: boolean }) {
  const f = m.filters, set = (p: Partial<Filters>) => m.setFilters({ ...f, ...p })
  return <div className={`filters ${compact ? 'compact' : ''}`}>
    <input placeholder="Search all notes…" value={f.search} onChange={e => set({ search: e.target.value })} />
    <label className="chip"><input type="checkbox" checked={f.context} onChange={e => set({ context: e.target.checked })} /> Current context</label>
    <select value={f.status} onChange={e => set({ status: e.target.value as Filters['status'] })}><option>Open</option><option>Resolved</option><option>Any</option></select>
    <select value={f.priority} onChange={e => set({ priority: e.target.value as Filters['priority'] })}><option value="Any">Any priority</option><option>High</option><option>Normal</option><option>Low</option></select>
    <select value={f.target} onChange={e => set({ target: e.target.value })}><option value="Any">Any target</option>{['project', 'floor', 'option', 'design', 'entity', 'feature', 'point'].map(t => <option key={t}>{t}</option>)}</select>
    <select value={f.annType} onChange={e => set({ annType: e.target.value as Filters['annType'] })}><option value="Any">Any annotation</option>{(['Text', 'Leader', 'Arrow', 'Revision Cloud', 'Reference Marker'] as AnnType[]).map(t => <option key={t}>{t}</option>)}</select>
    <select value={f.layer} onChange={e => set({ layer: e.target.value })}><option value="Any">Any layer</option>{layers.map(l => <option key={l}>{l}</option>)}</select>
  </div>
}
function NoteEditor({ m }: { m: M }) {
  const c = m.comments.find(x => x.id === m.selectedNote)
  const a = m.annotations.find(x => x.id === m.selectedNote)
  if (c) {
    const inherits = c.anchor.kind === 'entity' || c.anchor.kind === 'feature'
    return <div className="editor"><p className="eyebrow">Comment {c.ref}</p>
      <input value={c.title} onChange={e => m.updateComment(c.id, { title: e.target.value })} />
      <textarea value={c.body} placeholder="Plain-text body" onChange={e => m.updateComment(c.id, { body: e.target.value })} />
      <div className="kv"><span>Anchor</span><b>{anchorLabel(c.anchor, m.entities)}</b></div>
      <div className="kv"><span>Scope</span>{inherits ? <b>{optName(effectiveScope(c, m.entities))} (inherited)</b> : <select value={c.scope} onChange={e => m.updateComment(c.id, { scope: e.target.value as Scope })}><option value="all">All Options</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}</div>
      <div className="kv"><span>Priority</span><select value={c.priority} onChange={e => m.updateComment(c.id, { priority: e.target.value as Priority })}><option>Low</option><option>Normal</option><option>High</option></select></div>
      <div className="kv"><span>Status</span><b>{c.status} · updated {c.updated}</b></div>
      {c.warning && <p className="helper">Linked from Warning “Island clearance”. Resolving this does not acknowledge the Warning.</p>}
      <div className="row-actions"><button onClick={() => m.toggleStatus(c.id)}>{c.status === 'Open' ? 'Resolve' : 'Reopen'}</button><button className="danger-text" onClick={() => m.deleteComment(c.id)}>Delete</button></div>
    </div>
  }
  if (a) {
    const s = a.style, st = (p: Partial<Style>) => m.updateAnnotation(a.id, { style: { ...s, ...p } })
    return <div className="editor"><p className="eyebrow">Annotation {a.ref} · {a.type}</p>
      <input value={a.text} onChange={e => m.updateAnnotation(a.id, { text: e.target.value })} />
      <div className="kv"><span>View</span><b>{views.find(v => v.id === a.view)?.name}</b></div>
      <div className="kv"><span>Layer</span><select value={a.layer} onChange={e => m.updateAnnotation(a.id, { layer: e.target.value })}>{layers.map(l => <option key={l}>{l}</option>)}</select></div>
      <div className="kv"><span>Scope</span><select value={a.scope} onChange={e => m.updateAnnotation(a.id, { scope: e.target.value as Scope })}><option value="all">All Options</option><option value={m.activeOption}>{optName(m.activeOption)} (active)</option></select></div>
      {a.type === 'Reference Marker' && <div className="kv"><span>Target view</span><select value={a.target} onChange={e => m.updateAnnotation(a.id, { target: e.target.value })}>{views.filter(v => v.id !== a.view).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>}
      <div className="kv"><span>Size</span><Seg value={s.size} opts={['S', 'M', 'L']} on={v => st({ size: v as Style['size'] })} /></div>
      <div className="kv"><span>Color</span><span className="swatches">{palette.map(p => <button key={p} className={p === s.color ? 'on' : ''} style={{ background: p }} onClick={() => st({ color: p })} />)}</span></div>
      <div className="kv"><span>Line</span><Seg value={String(s.weight)} opts={['1', '2', '3']} on={v => st({ weight: Number(v) as Style['weight'] })} /><label className="chip"><input type="checkbox" checked={s.dash} onChange={e => st({ dash: e.target.checked })} />dashed</label></div>
      {(a.type === 'Leader' || a.type === 'Arrow') && <div className="kv"><span>Arrowhead</span><label className="chip"><input type="checkbox" checked={s.arrow} onChange={e => st({ arrow: e.target.checked })} />on</label></div>}
      {a.type === 'Revision Cloud' && <div className="kv"><span>Fill</span><label className="chip"><input type="checkbox" checked={s.fill} onChange={e => st({ fill: e.target.checked })} />tint</label></div>}
      {a.type === 'Reference Marker' && <div className="kv"><span>Shape</span><Seg value={s.shape} opts={['circle', 'hexagon']} on={v => st({ shape: v as Style['shape'] })} /></div>}
      <p className="helper">Bounded styles only — no fonts, rich text, freehand, or attachments.</p>
      <div className="row-actions"><button className="danger-text" onClick={() => m.deleteAnnotation(a.id)}>Delete</button></div>
    </div>
  }
  return <p className="helper pad">Select a note to edit it.</p>
}
function Seg({ value, opts, on }: { value: string; opts: string[]; on: (v: string) => void }) {
  return <span className="seg">{opts.map(o => <button key={o} className={o === value ? 'on' : ''} onClick={() => on(o)}>{o}</button>)}</span>
}
function SelectionNotes({ m }: { m: M }) {
  const e = m.entities.find(x => x.id === m.selected)
  if (!e) return <p className="helper pad">Select a Room, Wall, or Placed Item.</p>
  const own = m.comments.filter(c => (c.anchor.kind === 'entity' || c.anchor.kind === 'feature') && c.anchor.id === e.id)
  const design = e.design ? m.comments.filter(c => c.anchor.kind === 'design' && c.anchor.design === e.design) : []
  return <div className="selection-notes">
    <p className="eyebrow">{e.kind}</p><h3>{e.label}</h3>
    <div className="kv"><span>Owner</span><b>{optName(e.option)}</b></div>
    <h4>On this {e.kind === 'Placed Item' ? 'placement' : e.kind.toLowerCase()} ({own.length})</h4>
    {own.map(c => <CommentRow key={c.id} m={m} c={c} dense />)}
    {e.design && <><h4>On Item Design “{itemDesigns[e.design]}” — shared by every placement ({design.length})</h4>{design.map(c => <CommentRow key={c.id} m={m} c={c} dense />)}</>}
    <div className="row-actions wrap">
      <button onClick={() => m.addComment({ kind: 'entity', id: e.id })}>+ Comment on this {e.kind === 'Placed Item' ? 'placement' : e.kind.toLowerCase()}</button>
      {e.design && <button onClick={() => m.addComment({ kind: 'design', design: e.design! })}>+ Comment on Item Design</button>}
      {e.features && e.features.map(f => <button key={f} onClick={() => m.addComment({ kind: 'feature', id: e.id, feature: f, t: 0.3 })}>+ Comment on {f}</button>)}
    </div>
    <div className="row-actions wrap">
      {e.id === 'w3' && <><button onClick={m.moveWall}>Move wall +30 (compatible edit)</button><button onClick={m.splitWall}>Replace kitchen face</button></>}
      <button className="danger-text" onClick={() => m.requestDelete(e.id)}>Delete {e.label}</button>
    </div>
  </div>
}
function WarningStrip({ m }: { m: M }) {
  if (m.activeOption !== 'optB') return null
  return <div className={`warning-strip ${m.warningAck ? 'ack' : ''}`}><b>⚠ Warning</b> Island clearance 820 mm is below the 900 mm explicit clearance.
    <button onClick={m.commentFromWarning}>Create linked Comment</button>
    <button onClick={() => m.setWarningAck(!m.warningAck)}>{m.warningAck ? 'Un-acknowledge' : 'Acknowledge'}</button></div>
}
function OptionPicker({ m }: { m: M }) {
  return <span className="option-picker"><select value={m.activeOption} onChange={e => m.setActiveOption(e.target.value as OptionId)}>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>{m.activeOption !== 'existing' && <button className="mini danger-text" onClick={() => m.requestDeleteOption(m.activeOption)}>Delete option…</button>}</span>
}
const toolList: AnnType[] = ['Text', 'Leader', 'Arrow', 'Revision Cloud', 'Reference Marker']
const toolIcon: Record<string, string> = { Comment: '✎', Text: 'T', Leader: '↖T', Arrow: '↗', 'Revision Cloud': '☁', 'Reference Marker': '◎' }
function OverlayToggle({ m }: { m: M }) {
  return <label className={`overlay-toggle ${m.overlay ? 'on' : ''}`}><input type="checkbox" checked={m.overlay} onChange={e => { m.setOverlay(e.target.checked); m.setFocus(null) }} /> Notes overlay {m.overlay ? 'on' : 'off'}</label>
}
function ReviewDialog({ m }: { m: M }) {
  const r = m.review
  const [ch, setCh] = useState<Record<string, { choice: string; reanchor?: string }>>({})
  useEffect(() => setCh(Object.fromEntries((r?.items ?? []).filter(i => i.choice).map(i => [i.key, { choice: i.choice! }]))), [r])
  if (!r) return null
  const others = m.entities.filter(e => e.kind !== 'Room' || true).filter(e => !r.title.includes(e.label))
  const ready = r.items.every(i => ch[i.key] && (ch[i.key].choice !== 'reanchor' || ch[i.key].reanchor))
  const optionReview = r.items.every(i => i.choice)
  return <div className="modal-backdrop"><section className="modal"><p className="eyebrow danger">Dependency review</p><h2>{r.title}</h2><p>{r.subject}</p>
    {r.items.map(i => <div key={i.key} className="dep-row"><span>{i.label}</span>{optionReview
      ? <Seg value={ch[i.key]?.choice ?? 'delete'} opts={['delete', 'keep']} on={v => setCh({ ...ch, [i.key]: { choice: v } })} />
      : <span className="dep-choices"><Seg value={ch[i.key]?.choice ?? ''} opts={['point', 'reanchor', 'delete']} on={v => setCh({ ...ch, [i.key]: { choice: v } })} />{ch[i.key]?.choice === 'reanchor' && <select value={ch[i.key].reanchor ?? ''} onChange={e => setCh({ ...ch, [i.key]: { choice: 'reanchor', reanchor: e.target.value } })}><option value="">Choose target…</option>{others.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}</span>}</div>)}
    <p className="helper">point = convert to fixed Floor Point · reanchor = choose a new target explicitly · delete = remove the note</p>
    <div className="modal-actions"><button onClick={() => m.setReview(null)}>Cancel — change nothing</button><button className="button danger-button" disabled={!ready} onClick={() => { r.onConfirm(ch); m.setReview(null) }}>Apply and continue</button></div>
  </section></div>
}
function ExportDialog({ m }: { m: M }) {
  const [flags, setFlags] = useState({ anns: true, pins: false, resolved: false })
  if (!m.exportOpen) return null
  const register = [...m.comments].sort((a, b) => a.ref.localeCompare(b.ref))
  const csv = ['reference,title,status,priority,scope,target', ...register.map(c => [c.ref, c.title, c.status, c.priority, optName(effectiveScope(c, m.entities)), anchorLabel(c.anchor, m.entities)].map(v => `"${v}"`).join(','))].join('\n')
  return <div className="modal-backdrop" onMouseDown={() => m.setExportOpen(false)}><section className="modal wide" onMouseDown={e => e.stopPropagation()}><p className="eyebrow">Drawing export · SVG / PDF / PNG</p><h2>Ground Floor · Plan</h2>
    <div className="row-actions"><label className="chip"><input type="checkbox" checked={flags.anns} onChange={e => setFlags({ ...flags, anns: e.target.checked })} />View Annotations</label><label className="chip"><input type="checkbox" checked={flags.pins} onChange={e => setFlags({ ...flags, pins: e.target.checked })} />Comment Pins</label><label className="chip"><input type="checkbox" disabled={!flags.pins} checked={flags.resolved} onChange={e => setFlags({ ...flags, resolved: e.target.checked })} />include Resolved pins</label></div>
    <div className="export-preview"><PlanCanvas m={m} exportFlags={flags} /></div>
    <h3>Comment Register (CSV / PDF) — deterministic, no author column</h3><pre>{csv}</pre>
    <div className="modal-actions"><button onClick={() => m.tryDeleteView()}>Try deleting “Kitchen · North Elevation”</button><button className="button primary" onClick={() => m.setExportOpen(false)}>Done</button></div>
  </section></div>
}
function Log({ m }: { m: M }) {
  return <div className="state-log"><b>State</b> option={m.activeOption} · overlay={String(m.overlay)} · focus={m.focus ?? '–'} · tool={m.tool ?? '–'} · comments={m.comments.length} ({m.comments.filter(c => c.status === 'Open').length} open) · annotations={m.annotations.length}<br />{m.log.map((l, i) => <span key={i} className={i ? 'old' : ''}>{l}</span>)}</div>
}

/* ---------- Variant A: docked right Notes panel with tabs ---------- */
function VariantA({ m }: { m: M }) {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<'Comments' | 'Annotations'>('Comments')
  return <div className="va">
    <header className="toolbar"><b className="brand">BuildBox</b><span>Ground Floor ▾</span><OptionPicker m={m} /><span className="sep" />
      <button className={m.tool === 'Comment' ? 'on' : ''} onClick={() => m.setTool(m.tool === 'Comment' ? null : 'Comment')}>✎ Comment</button>
      <span className="tool-group" title={m.overlay ? '' : 'Turn on the Notes overlay to draw Annotations'}>{toolList.map(t => <button key={t} disabled={!m.overlay} className={m.tool === t ? 'on' : ''} onClick={() => m.setTool(m.tool === t ? null : t)}>{toolIcon[t]} {t}</button>)}</span>
      <span className="grow" /><OverlayToggle m={m} /><button onClick={() => m.setExportOpen(true)}>Export…</button><button onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} Notes</button></header>
    <WarningStrip m={m} />
    <div className={`va-body ${open ? '' : 'closed'}`}>
      <aside className="inspector"><SelectionNotes m={m} /></aside>
      <main className="canvas-wrap">{m.tool && <div className="hint">Click to place {m.tool}. Click an entity to anchor it.</div>}<PlanCanvas m={m} /></main>
      {open && <aside className="notes-panel"><div className="tabs">{(['Comments', 'Annotations'] as const).map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t} <em>{t === 'Comments' ? m.visibleComments.length : m.visibleAnnotations.length}</em></button>)}</div>
        <FilterBar m={m} compact />
        <div className="list">{tab === 'Comments' ? m.visibleComments.map(c => <CommentRow key={c.id} m={m} c={c} />) : m.visibleAnnotations.map(a => <AnnotationRow key={a.id} m={m} a={a} />)}</div>
        <NoteEditor m={m} /></aside>}
    </div><Log m={m} /></div>
}

/* ---------- Variant B: bottom register tray, explicit Annotate mode ---------- */
function VariantB({ m }: { m: M }) {
  const [annotate, setAnnotate] = useState(false)
  const [tray, setTray] = useState<'min' | 'open'>('open')
  const rows = [...m.visibleComments.map(c => ({ kind: 'C' as const, c })), ...m.visibleAnnotations.map(a => ({ kind: 'A' as const, a }))]
  return <div className="vb">
    <header className="toolbar"><b className="brand">BuildBox</b><span>Ground Floor ▾</span><OptionPicker m={m} /><span className="grow" />
      <button className={annotate ? 'primary' : ''} onClick={() => { const n = !annotate; setAnnotate(n); m.setOverlay(n); m.setTool(null) }}>{annotate ? 'Exit Annotate mode' : 'Annotate mode'}</button>
      {!annotate && <OverlayToggle m={m} />}<button onClick={() => m.setExportOpen(true)}>Export…</button></header>
    <WarningStrip m={m} />
    <div className="vb-body">
      <main className={`canvas-wrap ${annotate ? 'annotating' : ''}`}>
        {annotate && <div className="float-palette">{(['Comment', ...toolList] as Tool[]).map(t => <button key={t!} title={t!} className={m.tool === t ? 'on' : ''} onClick={() => m.setTool(m.tool === t ? null : t)}>{toolIcon[t!]}</button>)}<span>{m.tool ?? 'pick a tool'}</span></div>}
        {annotate && <div className="mode-banner">ANNOTATE MODE · model geometry locked</div>}
        <PlanCanvas m={m} /></main>
      <aside className="inspector right">{m.selectedNote ? <NoteEditor m={m} /> : <SelectionNotes m={m} />}</aside>
    </div>
    <section className={`tray ${tray}`}><div className="tray-head"><button onClick={() => setTray(tray === 'open' ? 'min' : 'open')}>{tray === 'open' ? '▾' : '▸'} Notes register</button><span>{m.visibleComments.length} comments · {m.visibleAnnotations.length} annotations</span>{tray === 'open' && <FilterBar m={m} />}</div>
      {tray === 'open' && <table><thead><tr><th>Ref</th><th>Kind</th><th>Title / text</th><th>Target / view</th><th>Scope</th><th>Layer</th><th>Priority</th><th>Status</th><th /></tr></thead><tbody>{rows.map(r => r.kind === 'C'
        ? <tr key={r.c.id} className={`${m.selectedNote === r.c.id ? 'sel' : ''} ${r.c.status === 'Resolved' ? 'resolved' : ''}`} onClick={() => m.focusNote(r.c.id)}><td>{r.c.ref}</td><td>Comment</td><td>{r.c.title}</td><td>{anchorLabel(r.c.anchor, m.entities)}</td><td>{optName(effectiveScope(r.c, m.entities))}</td><td>—</td><td><span className={`prio ${r.c.priority}`} />{r.c.priority}</td><td>{r.c.status}</td><td><button className="mini" onClick={e => { e.stopPropagation(); m.toggleStatus(r.c.id) }}>{r.c.status === 'Open' ? 'Resolve' : 'Reopen'}</button></td></tr>
        : <tr key={r.a.id} className={m.selectedNote === r.a.id ? 'sel' : ''} onClick={() => m.focusNote(r.a.id)}><td>{r.a.ref}</td><td>{r.a.type}</td><td>{r.a.text}</td><td>{views.find(v => v.id === r.a.view)?.name}</td><td>{optName(r.a.scope)}</td><td>{r.a.layer}</td><td>—</td><td>—</td><td /></tr>)}</tbody></table>}
    </section><Log m={m} /></div>
}

/* ---------- Variant C: selection-first inspector, Add menu, Notes as left sheet ---------- */
function VariantC({ m }: { m: M }) {
  const [sheet, setSheet] = useState(false)
  const [menu, setMenu] = useState(false)
  const sel = m.entities.find(e => e.id === m.selected)
  const group = (fl: string) => m.visibleComments.filter(c => fl === 'project' ? ['project', 'option', 'design'].includes(c.anchor.kind) : !['project', 'option', 'design'].includes(c.anchor.kind))
  return <div className="vc">
    <nav className="rail"><button title="Floors">▦</button><button title="Layers">≣</button><button className={sheet ? 'on' : ''} title="Notes" onClick={() => setSheet(!sheet)}>✎<em>{m.comments.filter(c => c.status === 'Open').length}</em></button><button title="Export" onClick={() => m.setExportOpen(true)}>⇪</button></nav>
    <div className="vc-main">
      <header className="toolbar"><b className="brand">BuildBox</b><span>Ground Floor ▾</span><OptionPicker m={m} /><span className="grow" />
        <span className="add-menu"><button className="primary" onClick={() => setMenu(!menu)}>+ Add note ▾</button>{menu && <div className="menu">{(['Comment', ...toolList] as Tool[]).map(t => <button key={t!} onClick={() => { m.setTool(t); if (t !== 'Comment') m.setOverlay(true); setMenu(false) }}>{toolIcon[t!]} {t}</button>)}</div>}</span></header>
      <WarningStrip m={m} />
      <main className="canvas-wrap">{m.tool && <div className="hint">Placing {m.tool} — click canvas · <button className="mini" onClick={() => m.setTool(null)}>cancel</button></div>}<PlanCanvas m={m} />
        {sel && <div className="popover"><SelectionNotes m={m} /></div>}
        {m.selectedNote && !sheet && <div className="popover note-pop"><button className="mini close" onClick={() => { m.setSelectedNote(null); m.setFocus(null) }}>×</button><NoteEditor m={m} /></div>}
      </main>
      <footer className="statusbar"><OverlayToggle m={m} /><span>{m.focus ? `Focused ${m.focus} · ` : ''}{m.visibleComments.length} open in this context</span><Log m={m} /></footer>
    </div>
    {sheet && <aside className="sheet"><h2>Notes</h2><FilterBar m={m} />
      <h4>Project, option & Item Design</h4>{group('project').map(c => <CommentRow key={c.id} m={m} c={c} />)}
      <h4>On Ground Floor</h4>{group('gf').map(c => <CommentRow key={c.id} m={m} c={c} />)}
      <h4>Annotations · Ground Floor · Plan</h4>{m.visibleAnnotations.map(a => <AnnotationRow key={a.id} m={m} a={a} />)}
      <NoteEditor m={m} /></aside>}
  </div>
}

/* ---------- shell + switcher ---------- */
function App() {
  const read = () => (new URLSearchParams(location.search).get('variant') as Variant) || 'A'
  const [variant, setVariant] = useState<Variant>(read)
  const m = useNotesModel()
  const choose = (v: Variant) => { const u = new URL(location.href); u.searchParams.set('variant', v); history.replaceState(null, '', u); setVariant(v) }
  const cycle = (d: number) => { const all: Variant[] = ['A', 'B', 'C']; choose(all[(all.indexOf(variant) + d + 3) % 3]) }
  useEffect(() => {
    const k = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (t.closest('input,textarea,select,[contenteditable]')) return; if (e.key === 'ArrowLeft') cycle(-1); if (e.key === 'ArrowRight') cycle(1); if (e.key === 'Escape') { m.setTool(null); m.setFocus(null) } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  })
  return <div className="prototype"><div className="prototype-notice">Throwaway prototype · Notes panel & annotations · in-memory only</div>
    {variant === 'A' && <VariantA m={m} />}{variant === 'B' && <VariantB m={m} />}{variant === 'C' && <VariantC m={m} />}
    <ReviewDialog m={m} /><ExportDialog m={m} />
    <div className="variant-switcher"><button onClick={() => cycle(-1)}>←</button>{(['A', 'B', 'C'] as Variant[]).map(v => <button key={v} className={variant === v ? 'active' : ''} onClick={() => choose(v)}>{v}</button>)}<span>{variant} · {variantNames[variant]}</span><button onClick={() => cycle(1)}>→</button></div>
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
