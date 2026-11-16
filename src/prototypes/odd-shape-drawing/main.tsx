// THROWAWAY PROTOTYPE — odd-shape drawing & editing for Room Outlines and Item Footprints (#30, contract from #16).
// Three structurally different editors, switchable with ?variant=A|B|C (plus ?scenario=<id> to jump to a scenario):
//   A · CAD ribbon + right inspector   B · Floating palette + on-canvas chips   C · Step rail + segment spreadsheet
// Single Floor, local X/Y mm, Floor Datum Z=0. All state is in memory. Nothing here is production geometry.
import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

/* ---------- geometry (floor-local mm) ---------- */
type Pt = { x: number; y: number }
const P = (x: number, y: number): Pt => ({ x, y })
const add = (a: Pt, b: Pt) => P(a.x + b.x, a.y + b.y)
const sub = (a: Pt, b: Pt) => P(a.x - b.x, a.y - b.y)
const mul = (a: Pt, k: number) => P(a.x * k, a.y * k)
const dst = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const mid = (a: Pt, b: Pt) => P((a.x + b.x) / 2, (a.y + b.y) / 2)
const unit = (a: Pt, b: Pt) => { const l = dst(a, b) || 1; const d = sub(b, a); return P(d.x / l, d.y / l) }
const lft = (a: Pt, b: Pt) => { const u = unit(a, b); return P(u.y, -u.x) }
const TAU = Math.PI * 2
const mm = (n: number) => `${Math.round(n).toLocaleString()} mm`
const m2 = (n: number) => `${(Math.abs(n) / 1e6).toFixed(2)} m²`

type Seg =
  | { k: 'l'; a: Pt; b: Pt; ref?: { wall: string; face: 'L' | 'R' } }
  | { k: 'a'; a: Pt; b: Pt; r: number; ccw: boolean }
  | { k: 'e'; a: Pt; b: Pt; rx: number; ry: number; rot: number; ccw: boolean }

function arcData(s: { a: Pt; b: Pt; r: number; ccw: boolean }) {
  const c = dst(s.a, s.b)
  const r = Math.max(s.r, c / 2 + 1e-6)
  const h = Math.sqrt(Math.max(r * r - (c * c) / 4, 0))
  const ctr = add(mid(s.a, s.b), mul(lft(s.a, s.b), s.ccw ? -h : h))
  const a0 = Math.atan2(s.a.y - ctr.y, s.a.x - ctr.x)
  const a1 = Math.atan2(s.b.y - ctr.y, s.b.x - ctr.x)
  let sweep = a1 - a0
  while (sweep > Math.PI) sweep -= TAU
  while (sweep < -Math.PI) sweep += TAU
  return { ctr, r, a0, sweep }
}
function ellData(s: { a: Pt; b: Pt; rx: number; ry: number; rot: number; ccw: boolean }) {
  const rot = (s.rot * Math.PI) / 180
  const toUnit = (p: Pt): Pt => {
    const d = sub(p, s.a)
    const xr = d.x * Math.cos(rot) + d.y * Math.sin(rot)
    const yr = -d.x * Math.sin(rot) + d.y * Math.cos(rot)
    return P(xr / s.rx, yr / s.ry)
  }
  const T = toUnit(s.b)
  const c = dst(P(0, 0), T)
  const h = Math.sqrt(Math.max(1 - (c * c) / 4, 0))
  const u = unit(P(0, 0), T)
  const n = P(u.y, -u.x)
  const q0 = add(mul(T, 0.5), mul(n, s.ccw ? -h : h))
  const a0 = Math.atan2(-q0.y, -q0.x)
  const a1 = Math.atan2(T.y - q0.y, T.x - q0.x)
  let sweep = a1 - a0
  while (sweep > Math.PI) sweep -= TAU
  while (sweep < -Math.PI) sweep += TAU
  const fromUnit = (q: Pt): Pt => {
    const sx = q.x * s.rx, sy = q.y * s.ry
    return P(s.a.x + sx * Math.cos(rot) - sy * Math.sin(rot), s.a.y + sx * Math.sin(rot) + sy * Math.cos(rot))
  }
  return { a0, sweep, fromUnit }
}
function sampleSeg(s: Seg, n = 20): Pt[] {
  if (s.k === 'l') return [s.a, s.b]
  const out: Pt[] = []
  if (s.k === 'a') {
    const g = arcData(s)
    for (let i = 0; i <= n; i++) { const th = g.a0 + (g.sweep * i) / n; out.push(P(g.ctr.x + g.r * Math.cos(th), g.ctr.y + g.r * Math.sin(th))) }
  } else {
    const g = ellData(s)
    for (let i = 0; i <= n; i++) { const th = g.a0 + (g.sweep * i) / n; out.push(g.fromUnit(P(Math.cos(th), Math.sin(th)))) }
  }
  return out
}
function pathD(segs: Seg[]): string {
  if (!segs.length) return ''
  let d = `M${segs[0].a.x.toFixed(1)} ${segs[0].a.y.toFixed(1)}`
  for (const s of segs) {
    if (s.k === 'l') d += ` L${s.b.x.toFixed(1)} ${s.b.y.toFixed(1)}`
    else if (s.k === 'a') { const g = arcData(s); d += ` A${g.r.toFixed(1)} ${g.r.toFixed(1)} 0 0 ${g.sweep > 0 ? 1 : 0} ${s.b.x.toFixed(1)} ${s.b.y.toFixed(1)}` }
    else { const g = ellData(s); d += ` A${s.rx.toFixed(1)} ${s.ry.toFixed(1)} ${s.rot} 0 ${g.sweep > 0 ? 1 : 0} ${s.b.x.toFixed(1)} ${s.b.y.toFixed(1)}` }
  }
  return d + ' Z'
}
function openD(segs: Pt[], ghost?: Pt | null): string {
  if (!segs.length) return ''
  let d = `M${segs[0].x.toFixed(1)} ${segs[0].y.toFixed(1)}`
  for (let i = 1; i < segs.length; i++) d += ` L${segs[i].x.toFixed(1)} ${segs[i].y.toFixed(1)}`
  if (ghost) d += ` L${ghost.x.toFixed(1)} ${ghost.y.toFixed(1)}`
  return d
}
function polyOf(segs: Seg[]): Pt[] {
  const out: Pt[] = []
  for (const s of segs) { const pts = sampleSeg(s); out.push(...(out.length ? pts.slice(1) : pts)) }
  return out
}
function areaOf(poly: Pt[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y }
  return a / 2
}
function perimOf(poly: Pt[]): number {
  let l = 0
  for (let i = 0; i < poly.length; i++) l += dst(poly[i], poly[(i + 1) % poly.length])
  return l
}
function bboxOf(poly: Pt[]) {
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}
function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
function segInt(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const d1 = sub(p2, p1), d2 = sub(p4, p3)
  const den = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(den) < 1e-9) return null
  const t = ((p3.x - p1.x) * d2.y - (p3.y - p1.y) * d2.x) / den
  const u = ((p3.x - p1.x) * d1.y - (p3.y - p1.y) * d1.x) / den
  if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) return add(p1, mul(d1, t))
  return null
}
function selfX(segs: Seg[], closed: boolean): { i: number; j: number; p: Pt } | null {
  const polys = segs.map(s => sampleSeg(s))
  const n = segs.length
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1) continue
    if (closed && i === 0 && j === n - 1) continue
    for (let a = 0; a < polys[i].length - 1; a++) for (let b = 0; b < polys[j].length - 1; b++) {
      const p = segInt(polys[i][a], polys[i][a + 1], polys[j][b], polys[j][b + 1])
      if (p) return { i, j, p }
    }
  }
  return null
}
function polysOverlap(A: Pt[], B: Pt[]): boolean {
  for (let i = 0; i < A.length; i++) if (pointInPoly(A[i], B)) return true
  for (let i = 0; i < B.length; i++) if (pointInPoly(B[i], A)) return true
  for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++) if (segInt(A[i], A[i + 1], B[j], B[j + 1])) return true
  return false
}
function projToSeg(p: Pt, a: Pt, b: Pt): Pt {
  const ab = sub(b, a)
  const t = Math.max(0, Math.min(1, (sub(p, a).x * ab.x + sub(p, a).y * ab.y) / (ab.x * ab.x + ab.y * ab.y || 1)))
  return add(a, mul(ab, t))
}
const segLen = (s: Seg) => (s.k === 'l' ? dst(s.a, s.b) : perimOf(sampleSeg(s)))
const segAng = (s: Seg) => (((Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI) + 360) % 360

/* ---------- presets (#16 shape catalog) ---------- */
type PresetKind = 'square' | 'rect' | 'rr' | 'circle' | 'ellipse' | 'capsule' | 'triangle' | 'polygon' | 'L' | 'U'
type Params = { x: number; y: number; w: number; d: number; r: number; cr: number[] | null; sides: number; notchW: number; notchD: number; rot: number }
const presetNames: Record<PresetKind, string> = { square: 'Square', rect: 'Rectangle', rr: 'Rounded rect', circle: 'Circle', ellipse: 'Ellipse', capsule: 'Capsule', triangle: 'Triangle', polygon: 'Polygon', L: 'L-shape', U: 'U-shape' }
const presetIcons: Record<PresetKind, string> = { square: '▢', rect: '▭', rr: '▢r', circle: '◯', ellipse: '⬭', capsule: '⌬', triangle: '△', polygon: '⬡', L: '⌐', U: '⊔' }
const presetKinds = Object.keys(presetNames) as PresetKind[]

function presetParams(kind: PresetKind, x: number, y: number): Params {
  return { x, y, w: kind === 'square' ? 1800 : kind === 'circle' ? 1600 : 2600, d: kind === 'square' ? 1800 : kind === 'circle' ? 1600 : 2000, r: 300, cr: null, sides: 6, notchW: 1400, notchD: 1200, rot: 0 }
}
function rotPt(p: Pt, c: Pt, th: number): Pt {
  const d = sub(p, c)
  return P(c.x + d.x * Math.cos(th) - d.y * Math.sin(th), c.y + d.x * Math.sin(th) + d.y * Math.cos(th))
}
function evalPreset(kind: PresetKind, p: Params): Seg[] {
  const o = P(p.x, p.y)
  const L = (a: Pt, b: Pt): Seg => ({ k: 'l', a, b })
  let segs: Seg[] = []
  const ring = (pts: Pt[]) => { for (let i = 0; i < pts.length; i++) segs.push(L(pts[i], pts[(i + 1) % pts.length])) }
  switch (kind) {
    case 'square': case 'rect': ring([o, P(o.x + p.w, o.y), P(o.x + p.w, o.y + p.d), P(o.x, o.y + p.d)]); break
    case 'L': ring([o, P(o.x + p.w, o.y), P(o.x + p.w, o.y + p.d - p.notchD), P(o.x + p.w - p.notchW, o.y + p.d - p.notchD), P(o.x + p.w - p.notchW, o.y + p.d), P(o.x, o.y + p.d)]); break
    case 'U': { const x1 = o.x + (p.w - p.notchW) / 2, x2 = o.x + (p.w + p.notchW) / 2; ring([o, P(x1, o.y), P(x1, o.y + p.notchD), P(x2, o.y + p.notchD), P(x2, o.y), P(o.x + p.w, o.y), P(o.x + p.w, o.y + p.d), P(o.x, o.y + p.d)]); break }
    case 'triangle': ring([P(o.x, o.y + p.d), P(o.x + p.w, o.y + p.d), P(o.x + p.w / 2, o.y)]); break
    case 'polygon': { const cx = o.x + p.w / 2, cy = o.y + p.d / 2, R = Math.min(p.w, p.d) / 2; const pts: Pt[] = []; for (let i = 0; i < p.sides; i++) { const th = -Math.PI / 2 + (TAU * i) / p.sides; pts.push(P(cx + R * Math.cos(th), cy + R * Math.sin(th))) } ring(pts); break }
    case 'circle': { const cx = o.x + p.w / 2, cy = o.y + p.d / 2, r = p.w / 2; segs = [{ k: 'a', a: P(cx - r, cy), b: P(cx + r, cy), r, ccw: true }, { k: 'a', a: P(cx + r, cy), b: P(cx - r, cy), r, ccw: true }]; break }
    case 'ellipse': { const cx = o.x + p.w / 2, cy = o.y + p.d / 2, rx = p.w / 2, ry = p.d / 2; segs = [{ k: 'e', a: P(cx - rx, cy), b: P(cx + rx, cy), rx, ry, rot: 0, ccw: true }, { k: 'e', a: P(cx + rx, cy), b: P(cx - rx, cy), rx, ry, rot: 0, ccw: true }]; break }
    case 'capsule': { const r = p.d / 2, cxL = o.x + r, cxR = o.x + p.w - r; segs = [L(P(cxL, o.y), P(cxR, o.y)), { k: 'a', a: P(cxR, o.y), b: P(cxR, o.y + p.d), r, ccw: true }, L(P(cxR, o.y + p.d), P(cxL, o.y + p.d)), { k: 'a', a: P(cxL, o.y + p.d), b: P(cxL, o.y), r, ccw: true }]; break }
    case 'rr': {
      const rs = [0, 1, 2, 3].map(i => (p.cr ? p.cr[i] : p.r))
      const x0 = o.x, y0 = o.y, x1 = o.x + p.w, y1 = o.y + p.d
      const arc = (a: Pt, b: Pt, r: number): Seg => ({ k: 'a', a, b, r, ccw: false })
      segs = [
        L(P(x0 + rs[0], y0), P(x1 - rs[1], y0)), arc(P(x1 - rs[1], y0), P(x1, y0 + rs[1]), rs[1]),
        L(P(x1, y0 + rs[1]), P(x1, y1 - rs[2])), arc(P(x1, y1 - rs[2]), P(x1 - rs[2], y1), rs[2]),
        L(P(x1 - rs[2], y1), P(x0 + rs[3], y1)), arc(P(x0 + rs[3], y1), P(x0, y1 - rs[3]), rs[3]),
        L(P(x0, y1 - rs[3]), P(x0, y0 + rs[0])), arc(P(x0, y0 + rs[0]), P(x0 + rs[0], y0), rs[0]),
      ].filter(s => s.k !== 'a' || dst(s.a, s.b) > 1)
      break
    }
  }
  if (p.rot) { const c = P(o.x + p.w / 2, o.y + p.d / 2); const th = (p.rot * Math.PI) / 180; segs = segs.map(s => ({ ...s, a: rotPt(s.a, c, th), b: rotPt(s.b, c, th), ...(s.k === 'e' ? { rot: s.rot + p.rot } : {}) }) as Seg) }
  return segs
}
function cornerErrors(kind: PresetKind | null, p: Params | null): string[] {
  if (kind !== 'rr' || !p) return []
  const lim = Math.min(p.w, p.d) / 2
  const rs = p.cr ? p.cr : [p.r, p.r, p.r, p.r]
  const bad = rs.find(r => r > lim)
  return bad ? [`Corner radius ${mm(bad)} exceeds half the shortest side ${mm(lim)} — fillets would overlap`] : []
}

/* ---------- validation (#16 invariants) ---------- */
function validatePath(segs: Seg[], closed: boolean): string[] {
  const errs: string[] = []
  if (closed && segs.length < 3) errs.push('A closed outline needs at least 3 segments')
  segs.forEach((s, i) => {
    if (dst(s.a, s.b) < 1) errs.push(`Segment ${i + 1} has zero length`)
    if (s.k === 'a' && s.r < dst(s.a, s.b) / 2 - 0.01) errs.push(`Segment ${i + 1}: circular radius is smaller than its chord`)
  })
  if (closed && segs.length && dst(segs[segs.length - 1].b, segs[0].a) > 1) errs.push('Adjacent segments must meet at exactly one shared endpoint')
  const x = selfX(segs, closed)
  if (x) errs.push(`Self-intersection between segments ${x.i + 1} and ${x.j + 1} at (${Math.round(x.p.x)}, ${Math.round(x.p.y)})`)
  if (closed && segs.length >= 3 && areaOf(polyOf(segs)) <= 0) errs.push('Outline must enclose positive area')
  return errs
}

/* ---------- scene ---------- */
type Room = { id: string; name: string; preset: PresetKind | null; params: Params | null; segs: Seg[]; custom: boolean }
type Wall = { id: string; a: Pt; b: Pt; t: number }
type Design = { id: string; name: string; w: number; d: number; origin: Pt }
type Placement = { id: string; label: string; design: string; x: number; y: number; rot: number }
type Model = { rooms: Room[]; walls: Wall[]; designs: Design[]; placements: Placement[] }

const designSegs = (d: Design): Seg[] => [{ k: 'l', a: P(0, 0), b: P(d.w, 0) }, { k: 'l', a: P(d.w, 0), b: P(d.w, d.d) }, { k: 'l', a: P(d.w, d.d), b: P(0, d.d) }, { k: 'l', a: P(0, d.d), b: P(0, 0) }]
function xformPt(p: Pt, origin: Pt, rot: number, at: Pt): Pt {
  const th = (rot * Math.PI) / 180, d = sub(p, origin)
  return P(at.x + d.x * Math.cos(th) - d.y * Math.sin(th), at.y + d.x * Math.sin(th) + d.y * Math.cos(th))
}
function worldSegs(design: Design, pl: Placement): Seg[] {
  return designSegs(design).map(s => ({ ...s, a: xformPt(s.a, design.origin, pl.rot, P(pl.x, pl.y)), b: xformPt(s.b, design.origin, pl.rot, P(pl.x, pl.y)) }) as Seg)
}
function baseModel(): Model {
  const kitchenParams = presetParams('L', 1200, 1300)
  kitchenParams.w = 3600; kitchenParams.d = 4300; kitchenParams.notchW = 1500; kitchenParams.notchD = 1600
  const bedroomParams = presetParams('rect', 5300, 4400)
  bedroomParams.w = 3400; bedroomParams.d = 2400
  return {
    rooms: [
      { id: 'kitchen', name: 'Kitchen', preset: null, params: null, segs: evalPreset('L', kitchenParams), custom: true },
      { id: 'bedroom', name: 'Bedroom', preset: 'rect', params: bedroomParams, segs: evalPreset('rect', bedroomParams), custom: false },
    ],
    walls: [
      { id: 'W-1', a: P(1000, 1000), b: P(9000, 1000), t: 200 },
      { id: 'W-2', a: P(9000, 1000), b: P(9000, 7000), t: 200 },
      { id: 'W-3', a: P(1000, 7000), b: P(9000, 7000), t: 200 },
      { id: 'W-4', a: P(1000, 1000), b: P(1000, 7000), t: 200 },
      { id: 'W-5', a: P(5000, 1000), b: P(5000, 4200), t: 100 },
    ],
    designs: [{ id: 'base600', name: 'Base 600', w: 600, d: 400, origin: P(300, 200) }],
    placements: [
      { id: 'p1', label: 'Base 600 #1', design: 'base600', x: 2000, y: 1700, rot: 0 },
      { id: 'p2', label: 'Base 600 #2', design: 'base600', x: 5150, y: 4500, rot: 37 },
    ],
  }
}
/* ---------- snapping ---------- */
type SnapCfg = { grid: boolean; verts: boolean; faces: boolean; angle: boolean }
type SnapHit = { p: Pt; label: string } | null
function snapPoint(p: Pt, from: Pt | null, m: Model, cfg: SnapCfg): SnapHit {
  const TH = 200
  const cands: { p: Pt; label: string; pr: number }[] = []
  if (cfg.verts) {
    for (const w of m.walls) cands.push({ p: w.a, label: `endpoint ${w.id}`, pr: 0 }, { p: w.b, label: `endpoint ${w.id}`, pr: 0 }, { p: mid(w.a, w.b), label: `midpoint ${w.id}`, pr: 1 })
    for (const r of m.rooms) r.segs.forEach((s, i) => cands.push({ p: s.a, label: `vertex ${r.name}·${i + 1}`, pr: 0 }, { p: mid(s.a, s.b), label: `midpoint ${r.name}·${i + 1}`, pr: 1 }))
  }
  if (cfg.faces) for (const w of m.walls) {
    const n = mul(lft(w.a, w.b), w.t / 2)
    for (const sgn of [1, -1]) { const fa = add(w.a, mul(n, sgn)), fb = add(w.b, mul(n, sgn)); cands.push({ p: projToSeg(p, fa, fb), label: `wall face ${w.id} ${sgn > 0 ? 'L' : 'R'}`, pr: 2 }) }
  }
  let best: (typeof cands)[number] & { d: number } | null = null
  for (const c of cands) { const d = dst(p, c.p); if (d < TH && (!best || c.pr < best.pr || (c.pr === best.pr && d < best.d))) best = { ...c, d } }
  if (best) return { p: best.p, label: best.label }
  if (cfg.angle && from && dst(p, from) > 60) {
    const ang = (Math.atan2(p.y - from.y, p.x - from.x) * 180) / Math.PI
    const near = Math.round(ang / 15) * 15
    if (Math.abs(ang - near) < 2.5) { const len = dst(p, from), th = (near * Math.PI) / 180; return { p: P(from.x + len * Math.cos(th), from.y + len * Math.sin(th)), label: `angle ${((near % 360) + 360) % 360}°` } }
  }
  if (cfg.grid) { const g = P(Math.round(p.x / 100) * 100, Math.round(p.y / 100) * 100); if (dst(p, g) < 80) return { p: g, label: 'grid 100 mm' } }
  return null
}

/* ---------- measured warnings (#16: non-blocking, acknowledge = seen) ---------- */
type Warn = { id: string; text: string }
function computeWarnings(m: Model): Warn[] {
  const out: Warn[] = []
  for (const pl of m.placements) {
    const d = m.designs.find(x => x.id === pl.design)!
    const fp = polyOf(worldSegs(d, pl))
    for (const r of m.rooms) {
      const rp = polyOf(r.segs)
      const flags = fp.map(q => pointInPoly(q, rp))
      const nOut = flags.filter(x => !x).length
      if (nOut > 0 && nOut < fp.length) out.push({ id: `${pl.id}~${r.id}`, text: `${pl.label} footprint crosses ${r.name} outline — about ${mm((nOut / fp.length) * perimOf(fp))} of boundary outside (derived, non-blocking)` })
    }
  }
  return out
}

/* ---------- model hook ---------- */
type Sel = { kind: 'room' | 'placement' | 'design' | 'wall'; id: string } | { kind: 'seg'; id: string; i: number } | null
type Draft = { segs: Seg[]; tool: 'l' | 'a' | 'e'; hover: SnapHit; start: Pt | null }
type UI = { sel: Sel; draft: Draft | null; block: string | null; convert: string | null; ack: string[]; snaps: SnapCfg; showState: boolean; step: number; log: string[] }
const ui0 = (): UI => ({ sel: { kind: 'room', id: 'kitchen' }, draft: null, block: null, convert: null, ack: [], snaps: { grid: true, verts: true, faces: true, angle: true }, showState: false, step: 1, log: ['Prototype loaded — one Floor, local mm, in-memory only'] })

function useShapes() {
  const [model, setModel] = useState<Model>(baseModel)
  const [ui, setUi] = useState<UI>(ui0)
  const undoRef = useRef<{ m: Model; u: UI }[]>([])
  const note = (s: string) => setUi(u => ({ ...u, log: [s, ...u.log].slice(0, 8) }))
  const push = () => { undoRef.current.push(JSON.parse(JSON.stringify({ m: model, u: ui }))); if (undoRef.current.length > 40) undoRef.current.shift() }
  const undo = () => { const s = undoRef.current.pop(); if (s) { setModel(s.m); setUi({ ...s.u, log: ['Undo — previous valid state restored', ...s.u.log].slice(0, 8) }) } else setUi(u => ({ ...u, log: ['Nothing to undo', ...u.log].slice(0, 8) })) }

  const warnings = useMemo(() => computeWarnings(model), [model])
  const draftErrors = useMemo(() => (ui.draft ? validatePath(ui.draft.segs, false) : []), [ui.draft])
  const roomErrors = (r: Room) => [...validatePath(r.segs, true), ...cornerErrors(r.preset, r.params)]

  const select = (sel: Sel) => setUi(u => ({ ...u, sel, block: null }))
  const setBlock = (block: string | null) => setUi(u => ({ ...u, block }))

  function mutate(fn: (m: Model) => string | void) {
    push()
    setModel(m => { const msg = fn(m); if (msg) note(msg); return { ...m } })
  }
  function mutateRooms(fn: (rooms: Room[]) => string | void) {
    mutate(m => fn(m.rooms))
  }

  /* presets */
  function pickPreset(kind: PresetKind, at?: Pt) {
    push()
    const id = `room${Date.now() % 100000}`
    const params = presetParams(kind, at?.x ?? 5600, at?.y ?? 1400)
    const room: Room = { id, name: `New ${presetNames[kind]}`, preset: kind, params, segs: evalPreset(kind, params), custom: false }
    setModel(m => ({ ...m, rooms: [...m.rooms, room] }))
    setUi(u => ({ ...u, sel: { kind: 'room', id }, block: null, log: [`Preset ${presetNames[kind]} placed — defining parameters stay editable`, ...u.log].slice(0, 8) }))
  }
  function setParams(id: string, patch: Partial<Params>) {
    push()
    mutateRooms(rooms => { const r = rooms.find(x => x.id === id); if (r?.params) { r.params = { ...r.params, ...patch }; r.segs = evalPreset(r.preset!, r.params) } })
    note(`Parameter edit → same canonical path for validation, snapping, warnings`)
  }
  function requestConvert(id: string) { setUi(u => ({ ...u, convert: id })) }
  const closeConvert = () => setUi(u => ({ ...u, convert: null }))
  function confirmConvert() {
    const id = ui.convert!
    push()
    mutateRooms(rooms => { const r = rooms.find(x => x.id === id)!; r.custom = true; r.preset = null; r.params = null })
    setUi(u => ({ ...u, convert: null, log: [`Converted to Custom Path — defining parameters are gone; only Undo restores them`, ...u.log].slice(0, 8) }))
  }

  /* custom path draft */
  function startDraft(tool: 'l' | 'a' | 'e') { setUi(u => ({ ...u, draft: { segs: [], tool, hover: null, start: null }, block: null, sel: null })) }
  function setTool(tool: 'l' | 'a' | 'e') { setUi(u => (u.draft ? { ...u, draft: { ...u.draft, tool } } : u)) }
  function hoverAt(p: Pt) {
    setUi(u => {
      if (!u.draft) return u
      const from = u.draft.segs.length ? u.draft.segs[u.draft.segs.length - 1].b : u.draft.start
      return { ...u, draft: { ...u.draft, hover: snapPoint(p, from, model, u.snaps) } }
    })
  }
  function draftClick(p: Pt) {
    setUi(u => {
      if (!u.draft) return u
      const from = u.draft.segs.length ? u.draft.segs[u.draft.segs.length - 1].b : u.draft.start
      const hit = snapPoint(p, from, model, u.snaps)
      const q = hit ? hit.p : p
      if (!from) return { ...u, draft: { ...u.draft, start: q, hover: null }, log: [`Draft started at (${Math.round(q.x)}, ${Math.round(q.y)}) — live length/angle chips on every segment`, ...u.log].slice(0, 8) }
      if (u.draft.segs.length >= 3 && dst(q, u.draft.start!) < 220) return closeDraftIn(u)
      const c = dst(from, q)
      const seg: Seg = u.draft.tool === 'l' ? { k: 'l', a: from, b: q } : u.draft.tool === 'a' ? { k: 'a', a: from, b: q, r: Math.max(c * 0.7, c / 2 + 1), ccw: false } : { k: 'e', a: from, b: q, rx: Math.max(c * 0.75, c / 2 + 1), ry: Math.max(c * 0.45, 1), rot: Math.round(segAng({ k: 'l', a: from, b: q })), ccw: false }
      return { ...u, draft: { ...u.draft, segs: [...u.draft.segs, seg], hover: null } }
    })
  }
  function undoPoint() { setUi(u => (u.draft ? { ...u, draft: { ...u.draft, segs: u.draft.segs.length ? u.draft.segs.slice(0, -1) : u.draft.segs, start: u.draft.segs.length ? u.draft.start : null } } : u)) }
  function cancelDraft() { setUi(u => ({ ...u, draft: null, block: null, log: ['Draft cancelled — last valid canonical geometry untouched', ...u.log].slice(0, 8) })) }
  function closeDraftIn(u: UI): UI {
    const chain = u.draft!.segs
    if (chain.length < 3) return { ...u, block: 'A closed outline needs at least 3 segments — keep drawing, or Escape cancels.', log: [...u.log].slice(0, 8) }
    const segs = [...chain, { k: 'l', a: chain[chain.length - 1].b, b: chain[0].a } as Seg]
    const errs = validatePath(segs, true)
    if (errs.length) return { ...u, block: `Invalid draft — ${errs[0]}. Commit disabled; Escape cancels, last valid geometry preserved.`, log: [`Commit blocked: ${errs[0]}`, ...u.log].slice(0, 8) }
    const poly = polyOf(segs)
    const hitRoom = model.rooms.find(r => polysOverlap(poly, polyOf(r.segs)))
    if (hitRoom) return { ...u, block: `Room overlap blocked — the new outline overlaps “${hitRoom.name}” with positive area. Room interiors may share boundary segments but never overlap. Move or resize, then commit.`, log: [`Commit blocked: positive-area overlap with ${hitRoom.name}`, ...u.log].slice(0, 8) }
    const id = `room${Date.now() % 100000}`
    undoRef.current.push(JSON.parse(JSON.stringify({ m: model, u })))
    setModel(m => ({ ...m, rooms: [...m.rooms, { id, name: `Custom ${m.rooms.length + 1}`, preset: null, params: null, segs, custom: true }] }))
    return { ...u, draft: null, sel: { kind: 'room', id }, block: null, log: [`Custom Path committed — closed simple loop, ${segs.length} segments, area ${m2(areaOf(poly))}`, ...u.log].slice(0, 8) }
  }
  function closeDraft() { setUi(u => (u.draft ? closeDraftIn(u) : u)) }

  /* exact numeric segment edits */
  function editSeg(roomId: string, i: number, patch: { len?: number; ang?: number; r?: number; rx?: number; ry?: number; flip?: boolean }) {
    push()
    mutateRooms(rooms => {
      const r = rooms.find(x => x.id === roomId)!
      const s = { ...r.segs[i] } as Seg
      if (s.k === 'l') {
        const len = patch.len ?? dst(s.a, s.b)
        const ang = ((patch.ang ?? segAng(s)) * Math.PI) / 180
        s.b = P(s.a.x + len * Math.cos(ang), s.a.y + len * Math.sin(ang))
      } else if (s.k === 'a') { if (patch.r !== undefined) s.r = patch.r; if (patch.flip) s.ccw = !s.ccw }
      else { if (patch.rx !== undefined) s.rx = patch.rx; if (patch.ry !== undefined) s.ry = patch.ry; if (patch.flip) s.ccw = !s.ccw }
      r.segs[i] = s
      const next = r.segs[(i + 1) % r.segs.length]
      r.segs[(i + 1) % r.segs.length] = { ...next, a: r.segs[i].b } as Seg
    })
    note(`Exact numeric edit — canonical mm, no display rounding`)
  }

  /* rounded corners on a custom path */
  function roundCorners(roomId: string, rad: number) {
    const r0 = model.rooms.find(x => x.id === roomId)!
    const lens = r0.segs.map(s => dst(s.a, s.b))
    const tooBig = r0.segs.findIndex((_, i) => rad * 2 > Math.min(lens[i], lens[(i + 1) % lens.length]))
    if (tooBig >= 0) { setBlock(`Corner radius ${mm(rad)} exceeds half of adjacent segment ${tooBig + 1} (${mm(Math.min(lens[tooBig], lens[(tooBig + 1) % lens.length]))}) — fillets would overlap. Nothing changed.`); return }
    push()
    mutateRooms(rooms => {
      const r = rooms.find(x => x.id === roomId)!
      const n = r.segs.length
      const trimmed = r.segs.map((s, i) => add(s.a, mul(unit(r.segs[(i + n - 1) % n].a, s.a), -rad)))
      const trimmed2 = r.segs.map(s => add(s.a, mul(unit(s.a, s.b), rad)))
      const out: Seg[] = []
      for (let i = 0; i < n; i++) {
        const v = r.segs[i].a, p1 = trimmed[i], p2 = trimmed2[i]
        const cross = sub(p2, p1).x * sub(v, p1).y - sub(p2, p1).y * sub(v, p1).x
        out.push({ k: 'a', a: p1, b: p2, r: circumR(p1, v, p2), ccw: cross < 0 })
        const nxt = trimmed[(i + 1) % n]
        if (dst(p2, nxt) > 1) out.push({ k: 'l', a: p2, b: nxt })
      }
      r.segs = out
    })
    note(`Fillet ${mm(rad)} applied at every corner — tangential arcs, still one simple loop`)
  }
  function circumR(a: Pt, b: Pt, c: Pt): number {
    const A = dst(b, c), B = dst(a, c), C = dst(a, b)
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
    return (A * B * C) / (4 * (area || 1e-6))
  }

  /* placed items, rotation, origin */
  function rotatePlacement(id: string, rot: number) {
    push()
    mutate(m => { const p = m.placements.find(x => x.id === id)!; p.rot = rot })
    note(`Free rotation ${rot}° around Item Origin — Width/Depth stay on Item Design local axes`)
  }
  function movePlacement(id: string, x: number, y: number) { push(); mutate(m => { const p = m.placements.find(i => i.id === id)!; p.x = x; p.y = y }) }
  function setOrigin(designId: string, o: Pt) {
    push()
    mutate(m => { m.designs.find(d => d.id === designId)!.origin = o })
    const n = model.placements.filter(p => p.design === designId).length
    note(`Item Origin moved — previews all ${n} placements; placement never copies or scales the design`)
  }

  /* wall-face references */
  function attachRef(roomId: string, i: number, wallId: string, face: 'L' | 'R') {
    const w = model.walls.find(x => x.id === wallId)!
    const r0 = model.rooms.find(x => x.id === roomId)!
    const s = r0.segs[i]
    const n = mul(lft(w.a, w.b), (w.t / 2) * (face === 'L' ? 1 : -1))
    const fa = add(w.a, n), fb = add(w.b, n)
    const delta = sub(projToSeg(s.a, fa, fb), s.a)
    push()
    mutateRooms(rooms => {
      const r = rooms.find(x => x.id === roomId)!
      translateSeg(r, i, delta)
      const s = r.segs[i]
      if (s.k === 'l') r.segs[i] = { ...s, ref: { wall: wallId, face } }
    })
    note(`Segment ${i + 1} now references ${wallId} face ${face} — the only persistent geometric relationship here`)
  }
  function detachRef(roomId: string, i: number) {
    push()
    mutateRooms(rooms => {
      const r = rooms.find(x => x.id === roomId)!
      const s = r.segs[i]
      if (s.k === 'l') { const { ref: _ref, ...rest } = s; r.segs[i] = rest }
    })
    note(`Segment ${i + 1} detached — traced boundary stays valid and independent`)
  }
  function translateSeg(r: Room, i: number, delta: Pt) {
    const s = r.segs[i]
    const oa = s.a, ob = s.b
    r.segs[i] = { ...s, a: add(s.a, delta), b: add(s.b, delta) } as Seg
    r.segs.forEach((t, j) => {
      if (j === i) return
      if (dst(t.b, oa) < 1) r.segs[j] = { ...t, b: add(t.b, delta) } as Seg
      if (dst(t.a, ob) < 1) r.segs[j] = { ...t, a: add(t.a, delta) } as Seg
    })
  }
  function moveWall(id: string, dx: number) {
    push()
    let blocked: string | null = null
    setModel(m => {
      const next: Model = JSON.parse(JSON.stringify(m))
      const w = next.walls.find(x => x.id === id)!
      w.a.x += dx; w.b.x += dx
      for (const r of next.rooms) r.segs.forEach((s, i) => { if ('ref' in s && s.ref?.wall === id) translateSeg(r, i, P(dx, 0)) })
      for (const r of next.rooms) { const errs = validatePath(r.segs, true); if (errs.length) { blocked = `Host edit blocked — moving ${id} would make “${r.name}” invalid (${errs[0]}). Detach the referenced segment or remove the Room delta first.`; break } }
      if (blocked) { undoRef.current.pop(); return m }
      return next
    })
    setTimeout(() => { if (blocked) setBlock(blocked); else note(`Compatible host edit: ${id} moved ${dx > 0 ? '+' : ''}${dx} mm — referenced segments followed in the same transaction`) }, 0)
  }
  function tryDeleteWall(id: string) {
    const refs = model.rooms.flatMap(r => r.segs.map((s, i) => ('ref' in s && s.ref?.wall === id ? `${r.name} segment ${i + 1}` : null)).filter((x): x is string => !!x))
    if (refs.length) setBlock(`Cannot delete ${id} — referenced by ${refs.join(', ')}. Detach, reattach, or remove the Room delta first.`)
    else { push(); mutate(m => { m.walls = m.walls.filter(w => w.id !== id) }); note(`${id} deleted`) }
  }

  const ack = (id: string) => setUi(u => ({ ...u, ack: [...u.ack, id] }))
  const setSnap = (patch: Partial<SnapCfg>) => setUi(u => ({ ...u, snaps: { ...u.snaps, ...patch } }))
  const setStep = (step: number) => setUi(u => ({ ...u, step }))
  const toggleState = () => setUi(u => ({ ...u, showState: !u.showState }))
  const reset = () => { setModel(baseModel()); setUi(ui0()) }

  return { model, ui, warnings, draftErrors, roomErrors, select, setBlock, undo, pickPreset, setParams, requestConvert, closeConvert, confirmConvert, startDraft, setTool, hoverAt, draftClick, undoPoint, cancelDraft, closeDraft, editSeg, roundCorners, rotatePlacement, movePlacement, setOrigin, attachRef, detachRef, moveWall, tryDeleteWall, ack, setSnap, setStep, toggleState, reset, note }
}
type M = ReturnType<typeof useShapes>
/* ---------- canvas ---------- */
const VW = 10000, VH = 7500
function chainD(segs: Seg[], ghost: Pt | null): string {
  if (!segs.length && !ghost) return ''
  if (!segs.length) return ''
  let d = `M${segs[0].a.x.toFixed(1)} ${segs[0].a.y.toFixed(1)}`
  for (const s of segs) {
    if (s.k === 'l') d += ` L${s.b.x.toFixed(1)} ${s.b.y.toFixed(1)}`
    else if (s.k === 'a') { const g = arcData(s); d += ` A${g.r.toFixed(1)} ${g.r.toFixed(1)} 0 0 ${g.sweep > 0 ? 1 : 0} ${s.b.x.toFixed(1)} ${s.b.y.toFixed(1)}` }
    else { const g = ellData(s); d += ` A${s.rx.toFixed(1)} ${s.ry.toFixed(1)} ${s.rot} 0 ${g.sweep > 0 ? 1 : 0} ${s.b.x.toFixed(1)} ${s.b.y.toFixed(1)}` }
  }
  if (ghost) d += ` L${ghost.x.toFixed(1)} ${ghost.y.toFixed(1)}`
  return d
}
function segChipText(s: Seg): string {
  if (s.k === 'l') return `${Math.round(dst(s.a, s.b))} ∠${Math.round(segAng(s))}°`
  if (s.k === 'a') return `R${Math.round(s.r)} · arc ${Math.round(segLen(s))}`
  return `ell ${Math.round(s.rx)}×${Math.round(s.ry)} · ${Math.round(segLen(s))}`
}
function Chip({ p, text, bad }: { p: Pt; text: string; bad?: boolean }) {
  const w = text.length * 108 + 90
  return <g transform={`translate(${p.x} ${p.y})`} pointerEvents="none">
    <rect x={-w / 2} y={-150} width={w} height={260} rx={70} fill="#101012" stroke={bad ? '#ff5252' : '#46464c'} strokeWidth={16} />
    <text y={45} textAnchor="middle" className={`chip-tx ${bad ? 'bad' : ''}`}>{text}</text>
  </g>
}
function PlanCanvas({ m }: { m: M }) {
  const { model, ui } = m
  const draft = ui.draft
  const bad = m.draftErrors.length > 0
  const selRoomId = ui.sel?.kind === 'room' || ui.sel?.kind === 'seg' ? ui.sel.id : null
  const selPl = ui.sel?.kind === 'placement' ? model.placements.find(p => p.id === ui.sel!.id) : null
  const selDesignId = ui.sel?.kind === 'design' ? ui.sel.id : selPl?.design ?? null
  const toMm = (ev: RMouseEvent<SVGSVGElement>): Pt => {
    const r = ev.currentTarget.getBoundingClientRect()
    return P(((ev.clientX - r.left) / r.width) * VW, ((ev.clientY - r.top) / r.height) * VH)
  }
  const hit = (p: Pt) => {
    for (const pl of [...model.placements].reverse()) {
      const d = model.designs.find(x => x.id === pl.design)!
      if (pointInPoly(p, polyOf(worldSegs(d, pl)))) return { kind: 'placement' as const, id: pl.id }
    }
    if (selRoomId) {
      const r = model.rooms.find(x => x.id === selRoomId)
      const i = r?.segs.findIndex(s => dst(p, projToSeg(p, s.a, s.b)) < 160) ?? -1
      if (r && i >= 0) return { kind: 'seg' as const, id: r.id, i }
    }
    const rooms = model.rooms.filter(r => pointInPoly(p, polyOf(r.segs))).sort((a, b) => Math.abs(areaOf(polyOf(a.segs))) - Math.abs(areaOf(polyOf(b.segs))))
    if (rooms.length) return { kind: 'room' as const, id: rooms[0].id }
    const w = model.walls.find(w => dst(p, projToSeg(p, w.a, w.b)) < w.t)
    if (w) return { kind: 'wall' as const, id: w.id }
    return null
  }
  return <svg className={`plan ${draft ? 'drawing' : ''}`} viewBox={`0 0 ${VW} ${VH}`} data-variant-ready="1"
    onPointerMove={ev => draft && m.hoverAt(toMm(ev))}
    onClick={ev => { const p = toMm(ev); if (draft) m.draftClick(p); else m.select(hit(p)) }}>
    {ui.snaps.grid && <g>{Array.from({ length: VW / 1000 - 1 }, (_, i) => <line key={`v${i}`} className="grid-line" x1={(i + 1) * 1000} y1={0} x2={(i + 1) * 1000} y2={VH} />)}{Array.from({ length: VH / 1000 - 1 }, (_, i) => <line key={`h${i}`} className="grid-line" x1={0} y1={(i + 1) * 1000} x2={VW} y2={(i + 1) * 1000} />)}</g>}
    {model.walls.map(w => <g key={w.id} onClick={ev => { ev.stopPropagation(); m.select({ kind: 'wall', id: w.id }) }}>
      <line className={`wall ${ui.sel?.kind === 'wall' && ui.sel.id === w.id ? 'sel' : ''}`} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} strokeWidth={w.t} />
      <text className="wall-label" x={w.a.x + 160} y={w.a.y + (w.b.y > w.a.y ? 420 : -260)}>{w.id} · {w.t} centre</text>
    </g>)}
    {model.rooms.map(r => {
      const errs = m.roomErrors(r)
      const poly = polyOf(r.segs)
      const bb = bboxOf(poly)
      return <g key={r.id} onClick={ev => { ev.stopPropagation(); m.select({ kind: 'room', id: r.id }) }}>
        <path className={`room ${selRoomId === r.id ? 'sel' : ''} ${errs.length ? 'draft-bad' : ''}`} d={pathD(r.segs)} />
        <text className="room-label" x={bb.x0 + 220} y={bb.y1 - 220}>{r.name}{r.custom ? ' · Custom Path' : ` · ${presetNames[r.preset!]}`} · {m2(areaOf(poly))}{errs.length ? ' · INVALID' : ''}</text>
        {selRoomId === r.id && r.segs.map((s, i) => <g key={i}>
          <circle className={`vtx ${'ref' in s && s.ref ? 'ref' : ''}`} cx={s.a.x} cy={s.a.y} r={90} />
          {'ref' in s && s.ref && <Chip p={mid(s.a, s.b)} text={`⚓ ${s.ref.wall} face ${s.ref.face}`} />}
          {ui.sel?.kind === 'seg' && ui.sel.id === r.id && ui.sel.i === i && <path className="seg-sel" d={chainD([s], null)} />}
        </g>)}
      </g>
    })}
    {draft && <g pointerEvents="none">
      <path className={`draft ${bad ? 'bad' : ''}`} d={chainD(draft.segs, null)} />
      {draft.hover && (draft.segs.length > 0 || draft.start) && <path className={`draft-ghost ${bad ? 'bad' : ''}`} d={chainD([{ k: 'l', a: draft.segs.length ? draft.segs[draft.segs.length - 1].b : draft.start!, b: draft.hover.p }], null)} />}
      {draft.segs.map((s, i) => <Chip key={i} p={mid(s.a, s.b)} text={segChipText(s)} bad={bad} />)}
      {draft.segs.map((s, i) => <circle key={`v${i}`} className="vtx" cx={s.a.x} cy={s.a.y} r={80} />)}
      {!draft.segs.length && draft.start && <circle className="vtx" cx={draft.start.x} cy={draft.start.y} r={80} />}
      {draft.hover && <g>
        <circle className="snap-mark" cx={draft.hover.p.x} cy={draft.hover.p.y} r={150} />
        <line className="snap-mark" x1={draft.hover.p.x - 240} y1={draft.hover.p.y} x2={draft.hover.p.x + 240} y2={draft.hover.p.y} />
        <line className="snap-mark" x1={draft.hover.p.x} y1={draft.hover.p.y - 240} x2={draft.hover.p.x} y2={draft.hover.p.y + 240} />
        <text className="snap-tx" x={draft.hover.p.x + 260} y={draft.hover.p.y - 220}>snap: {draft.hover.label}</text>
      </g>}
      {bad && draft.segs.length >= 2 && <Chip p={draft.segs[draft.segs.length - 1].b} text={`✗ ${m.draftErrors[0]}`} bad />}
    </g>}
    {model.placements.map(pl => {
      const d = model.designs.find(x => x.id === pl.design)!
      const ws = worldSegs(d, pl)
      const bb = bboxOf(polyOf(ws))
      const isSel = selPl?.id === pl.id
      const warn = m.warnings.some(w => w.id.startsWith(`${pl.id}~`))
      return <g key={pl.id} onClick={ev => { ev.stopPropagation(); m.select({ kind: 'placement', id: pl.id }) }}>
        <g transform={`translate(${pl.x} ${pl.y}) rotate(${pl.rot}) translate(${-d.origin.x} ${-d.origin.y})`}>
          <path className={`item ${isSel ? 'sel' : ''}`} d={pathD(designSegs(d))} />
          <text className="item-label" x={-d.origin.x + 40} y={-d.origin.y + d.d / 2 + 60}>{pl.label}</text>
          {(isSel || selDesignId === d.id) && <g>
            <line className="origin-cross" x1={-80} y1={0} x2={80} y2={0} /><line className="origin-cross" x1={0} y1={-80} x2={0} y2={80} />
            <circle className="origin" cx={0} cy={0} r={45} />
          </g>}
          {isSel && <g>
            <line className="dim" x1={-d.origin.x} y1={d.d + 160 - d.origin.y} x2={d.w - d.origin.x} y2={d.d + 160 - d.origin.y} />
            <text className="dim-tx" x={-d.origin.x} y={d.d + 420 - d.origin.y}>W {d.w} (local)</text>
            <line className="dim" x1={d.w + 160 - d.origin.x} y1={-d.origin.y} x2={d.w + 160 - d.origin.x} y2={d.d - d.origin.y} />
            <text className="dim-tx" x={d.w + 260 - d.origin.x} y={-d.origin.y + 120}>D {d.d} (local)</text>
          </g>}
        </g>
        {isSel && <g>
          <rect className="bbox" x={bb.x0} y={bb.y0} width={bb.x1 - bb.x0} height={bb.y1 - bb.y0} />
          <Chip p={P((bb.x0 + bb.x1) / 2, bb.y0)} text={`rot ${pl.rot}° · Floor bbox ${Math.round(bb.x1 - bb.x0)}×${Math.round(bb.y1 - bb.y0)} mm`} />
        </g>}
        {warn && <g transform={`translate(${bb.x1 - 100} ${bb.y0 - 100})`}><circle className="warn-badge" r={170} /><text className="warn-badge-tx" y={65} textAnchor="middle">!</text></g>}
      </g>
    })}
  </svg>
}

/* ---------- shared panels ---------- */
function Num({ label, value, on, step = 50 }: { label: string; value: number; on: (n: number) => void; step?: number }) {
  return <div className="kv"><span>{label}</span><input className="num" type="number" value={Math.round(value)} step={step} onChange={e => on(Number(e.target.value))} /></div>
}
function ParamFields({ m, room }: { m: M; room: Room }) {
  if (!room.params || !room.preset) return <>
    <p className="helper">Custom Path — individual segments are exposed; defining parameters are gone (Undo restores them).</p>
    <div className="kv"><span>Round all</span><RoundCorners m={m} room={room} /></div>
  </>
  const p = room.params
  const set = (patch: Partial<Params>) => m.setParams(room.id, patch)
  return <div>
    <div className="kv"><span>Preset</span><b>{presetNames[room.preset]}</b></div>
    {room.preset !== 'circle' && <Num label="Width" value={p.w} on={w => set({ w })} />}
    {room.preset === 'circle' && <Num label="Diameter" value={p.w} on={w => set({ w, d: w })} />}
    {!['square', 'circle'].includes(room.preset) && <Num label="Depth" value={p.d} on={d => set({ d })} />}
    {room.preset === 'square' && <Num label="Side" value={p.w} on={w => set({ w, d: w })} />}
    {room.preset === 'polygon' && <Num label="Sides" value={p.sides} step={1} on={sides => set({ sides: Math.max(3, Math.round(sides)) })} />}
    {(room.preset === 'L' || room.preset === 'U') && <><Num label="Notch W" value={p.notchW} on={notchW => set({ notchW })} /><Num label="Notch D" value={p.notchD} on={notchD => set({ notchD })} /></>}
    {room.preset === 'rr' && <>
      <Num label="Radius" value={p.r} on={r => set({ r, cr: null })} />
      <label className="kv"><span>Per-corner</span><input type="checkbox" checked={!!p.cr} onChange={e => set({ cr: e.target.checked ? [p.r, p.r, p.r, p.r] : null })} /></label>
      {p.cr && p.cr.map((r, i) => <Num key={i} label={['TL', 'TR', 'BR', 'BL'][i]} value={r} on={v => set({ cr: p.cr!.map((x, j) => (j === i ? v : x)) })} />)}
      {cornerErrors(room.preset, p).map(e => <p key={e} className="helper" style={{ color: '#ff8a8a' }}>✗ {e}</p>)}
    </>}
    <Num label="Orientation" value={p.rot} step={5} on={rot => set({ rot })} />
    <Num label="X" value={p.x} on={x => set({ x })} /><Num label="Y" value={p.y} on={y => set({ y })} />
    <div className="row-actions"><button onClick={() => m.requestConvert(room.id)}>Convert to Custom Path…</button></div>
    <p className="helper">Presets keep defining parameters while evaluating to the same canonical path used for validation, snapping, warnings, and export.</p>
  </div>
}
function RoundCorners({ m, room }: { m: M; room: Room }) {
  const [r, setR] = useState(250)
  return <span className="tool-group"><input className="num" type="number" value={r} step={50} onChange={e => setR(Number(e.target.value))} /><button onClick={() => m.roundCorners(room.id, r)}>Apply fillet</button></span>
}
function SegEditor({ m, room, i }: { m: M; room: Room; i: number }) {
  const s = room.segs[i]
  const wallFaces = m.model.walls.flatMap(w => [{ id: w.id, face: 'L' as const }, { id: w.id, face: 'R' as const }])
  const ref = 'ref' in s ? s.ref : undefined
  return <div>
    <p className="eyebrow">Segment {i + 1} · {s.k === 'l' ? 'line' : s.k === 'a' ? 'circular arc' : 'elliptical arc'}</p>
    {s.k === 'l' && <><Num label="Length" value={dst(s.a, s.b)} on={len => m.editSeg(room.id, i, { len })} /><Num label="Angle °" value={segAng(s)} step={1} on={ang => m.editSeg(room.id, i, { ang })} /></>}
    {s.k === 'a' && <><Num label="Radius" value={s.r} on={r => m.editSeg(room.id, i, { r })} /><button onClick={() => m.editSeg(room.id, i, { flip: true })}>Flip bulge</button><p className="helper">arc length {mm(segLen(s))}</p></>}
    {s.k === 'e' && <><Num label="rx" value={s.rx} on={rx => m.editSeg(room.id, i, { rx })} /><Num label="ry" value={s.ry} on={ry => m.editSeg(room.id, i, { ry })} /><button onClick={() => m.editSeg(room.id, i, { flip: true })}>Flip bulge</button></>}
    {s.k === 'l' && <div className="kv"><span>Wall face</span>{ref
      ? <><b>⚓ {ref.wall} · {ref.face}</b><button className="mini" onClick={() => m.detachRef(room.id, i)}>Detach</button></>
      : <select value="" onChange={e => { const [wall, face] = e.target.value.split('/'); if (wall) m.attachRef(room.id, i, wall, face as 'L' | 'R') }}><option value="">Attach (optional)…</option>{wallFaces.map(w => <option key={w.id + w.face} value={`${w.id}/${w.face}`}>{w.id} face {w.face}</option>)}</select>}</div>}
    {ref && <p className="helper">Compatible host edits move this segment in the same atomic transaction — only while the Room stays valid and non-overlapping.</p>}
  </div>
}
function SegList({ m, room }: { m: M; room: Room }) {
  return <table className="seg-table"><thead><tr><th>#</th><th>Kind</th><th>Length</th><th>Angle</th><th>Ref</th></tr></thead><tbody>
    {room.segs.map((s, i) => <tr key={i} className={ui2sel(m, room.id, i)} onClick={() => m.select({ kind: 'seg', id: room.id, i })}>
      <td>{i + 1}</td><td>{s.k === 'l' ? '╱ line' : s.k === 'a' ? '◠ arc' : '⬬ ell'}</td><td>{mm(segLen(s))}</td><td>{s.k === 'l' ? `${Math.round(segAng(s))}°` : s.k === 'a' ? `R ${Math.round(s.r)}` : `${Math.round(s.rx)}×${Math.round(s.ry)}`}</td><td>{'ref' in s && s.ref ? `⚓ ${s.ref.wall}·${s.ref.face}` : '—'}</td>
    </tr>)}
  </tbody></table>
}
const ui2sel = (m: M, roomId: string, i: number) => (m.ui.sel?.kind === 'seg' && m.ui.sel.id === roomId && m.ui.sel.i === i ? 'sel' : '')
function DerivedPanel({ m, room }: { m: M; room: Room }) {
  const errs = m.roomErrors(room)
  const poly = polyOf(room.segs)
  const bb = bboxOf(poly)
  return <div>
    <div className="kv"><span>Area</span><b>{m2(areaOf(poly))} · derived</b></div>
    <div className="kv"><span>Perimeter</span><b>{mm(perimOf(poly))} · derived</b></div>
    <div className="kv"><span>Floor bounds</span><b>{Math.round(bb.x1 - bb.x0)} × {Math.round(bb.y1 - bb.y0)} mm</b></div>
    {errs.length
      ? <p className="helper" style={{ color: '#ff8a8a' }}>✗ {errs[0]} — last valid geometry preserved; commit disabled.</p>
      : <p className="helper">✓ closed simple loop · {room.segs.length} segments · positive area · no self-crossing</p>}
    <p className="helper">Derived values are read-only — editing area directly has an ambiguous deformation rule.</p>
  </div>
}
function PlacementPanel({ m, pl }: { m: M; pl: Placement }) {
  const d = m.model.designs.find(x => x.id === pl.design)!
  const bb = bboxOf(polyOf(worldSegs(d, pl)))
  const warns = m.warnings.filter(w => w.id.startsWith(`${pl.id}~`))
  return <div>
    <p className="eyebrow">Placed Item</p><h3>{pl.label}</h3>
    <div className="kv"><span>Design</span><b>{d.name}</b></div>
    <div className="kv"><span>Rotation</span><input type="range" min={0} max={359} value={pl.rot} onChange={e => m.rotatePlacement(pl.id, Number(e.target.value))} /><input className="num" type="number" value={pl.rot} onChange={e => m.rotatePlacement(pl.id, Number(e.target.value))} /></div>
    <Num label="Origin X" value={pl.x} on={x => m.movePlacement(pl.id, x, pl.y)} /><Num label="Origin Y" value={pl.y} on={y => m.movePlacement(pl.id, pl.x, y)} />
    <div className="kv"><span>Local W × D</span><b>{d.w} × {d.d} mm — never swaps under rotation</b></div>
    <div className="kv"><span>Floor bbox</span><b>{Math.round(bb.x1 - bb.x0)} × {Math.round(bb.y1 - bb.y0)} mm · derived</b></div>
    <div className="row-actions"><button onClick={() => m.select({ kind: 'design', id: d.id })}>Edit Item Design →</button></div>
    {warns.map(w => <WarnRow key={w.id} m={m} w={w} />)}
  </div>
}
function DesignPanel({ m, design }: { m: M; design: Design }) {
  const n = m.model.placements.filter(p => p.design === design.id).length
  return <div>
    <p className="eyebrow">Item Design</p><h3>{design.name}</h3>
    <div className="kv"><span>Footprint</span><b>{design.w} × {design.d} mm local</b></div>
    <Num label="Origin X" value={design.origin.x} step={10} on={x => m.setOrigin(design.id, P(x, design.origin.y))} />
    <Num label="Origin Y" value={design.origin.y} step={10} on={y => m.setOrigin(design.id, P(design.origin.x, y))} />
    <div className="row-actions"><button onClick={() => m.setOrigin(design.id, P(design.w / 2, design.d / 2))}>Geometric center</button><button onClick={() => m.setOrigin(design.id, P(0, design.d))}>Bottom-left</button></div>
    <p className="helper" style={{ color: '#ffe9a5' }}>Origin change previews all {n} placements — placement never copies, scales, mirrors, or swaps the design.</p>
  </div>
}
function WallPanel({ m, wall }: { m: M; wall: Wall }) {
  return <div>
    <p className="eyebrow">Wall</p><h3>{wall.id}</h3>
    <div className="kv"><span>Thickness</span><b>{wall.t} mm · centre justification</b></div>
    <div className="row-actions"><button onClick={() => m.moveWall(wall.id, -100)}>Move −100</button><button onClick={() => m.moveWall(wall.id, 100)}>Move +100</button><button className="danger-text" onClick={() => m.tryDeleteWall(wall.id)}>Delete</button></div>
    <p className="helper">Room segments may optionally reference this wall's faces; compatible edits follow, incompatible ones block.</p>
  </div>
}
function WarnRow({ m, w }: { m: M; w: Warn }) {
  const acked = m.ui.ack.includes(w.id)
  return <div className={`warn-row ${acked ? 'ack' : ''}`}><b>⚠</b><span>{w.text}</span>{!acked && <button className="mini" style={{ marginLeft: 'auto' }} onClick={() => m.ack(w.id)}>Acknowledge</button>}</div>
}
function WarningsPanel({ m }: { m: M }) {
  return <div>{m.warnings.length ? m.warnings.map(w => <WarnRow key={w.id} m={m} w={w} />) : <p className="helper">No measured spatial warnings.</p>}
    <p className="helper">Non-blocking: items may intentionally span Rooms. Acknowledge = “seen”; geometry changes reopen.</p></div>
}
function StatePanel({ m }: { m: M }) {
  const dump = {
    floor: 'Level 5 · local mm · Datum Z=0',
    rooms: m.model.rooms.map(r => ({ name: r.name, kind: r.custom ? 'Custom Path' : presetNames[r.preset!], segs: r.segs.length, area: m2(areaOf(polyOf(r.segs))), valid: m.roomErrors(r).length === 0, refs: r.segs.map((s, i) => ('ref' in s && s.ref ? `${i + 1}→${s.ref.wall}${s.ref.face}` : null)).filter(Boolean) })),
    placements: m.model.placements.map(p => ({ ...p })),
    draft: m.ui.draft ? { segs: m.ui.draft.segs.length, tool: m.ui.draft.tool, errors: m.draftErrors } : null,
    snaps: m.ui.snaps, warnings: m.warnings.length, acked: m.ui.ack.length,
  }
  return <div><pre className="state-json">{JSON.stringify(dump, null, 1)}</pre>
    <div className="state-log">{m.ui.log.map((l, i) => <span key={i} className={i ? 'old' : ''}>· {l}</span>)}</div></div>
}
function SnapToggles({ m }: { m: M }) {
  const s = m.ui.snaps
  return <span className="tool-group">
    <label className="kv"><span>grid</span><input type="checkbox" checked={s.grid} onChange={e => m.setSnap({ grid: e.target.checked })} /></label>
    <label className="kv"><span>vertices</span><input type="checkbox" checked={s.verts} onChange={e => m.setSnap({ verts: e.target.checked })} /></label>
    <label className="kv"><span>wall faces</span><input type="checkbox" checked={s.faces} onChange={e => m.setSnap({ faces: e.target.checked })} /></label>
    <label className="kv"><span>angle 15°</span><input type="checkbox" checked={s.angle} onChange={e => m.setSnap({ angle: e.target.checked })} /></label>
  </span>
}
function DrawTools({ m }: { m: M }) {
  const d = m.ui.draft
  return <span className="tool-group">
    <button className={d?.tool === 'l' ? 'on' : ''} onClick={() => (d ? m.setTool('l') : m.startDraft('l'))}>╱ Line</button>
    <button className={d?.tool === 'a' ? 'on' : ''} onClick={() => (d ? m.setTool('a') : m.startDraft('a'))}>◠ Circular arc</button>
    <button className={d?.tool === 'e' ? 'on' : ''} onClick={() => (d ? m.setTool('e') : m.startDraft('e'))}>⬬ Elliptical arc</button>
    {d && <><button className="mini" onClick={m.undoPoint}>⌫ point</button><button onClick={m.closeDraft}>Close path</button><button className="danger-text" onClick={m.cancelDraft}>Cancel (Esc)</button></>}
  </span>
}
function PresetButtons({ m, compact }: { m: M; compact?: boolean }) {
  return <span className="tool-group">{presetKinds.map(k => <button key={k} className="preset-btn" title={presetNames[k]} onClick={() => m.pickPreset(k)}>{compact ? presetIcons[k] : `${presetIcons[k]} ${presetNames[k]}`}</button>)}</span>
}
function BlockStrip({ m }: { m: M }) {
  if (!m.ui.block) return null
  return <div className="block-strip"><b>⛔</b><span>{m.ui.block}</span><button className="mini" onClick={() => m.setBlock(null)}>Dismiss</button></div>
}
function ConvertDialog({ m }: { m: M }) {
  if (!m.ui.convert) return null
  const room = m.model.rooms.find(r => r.id === m.ui.convert)!
  return <div className="modal-backdrop"><section className="modal">
    <p className="eyebrow danger">Convert to Custom Path</p><h2>{room.name}</h2>
    <p>Individual segments become editable. <b>Defining parameters ({room.preset ? presetNames[room.preset] : 'custom'}) are lost</b> — width, depth, radius, and orientation fields disappear. This is reversible only through Undo.</p>
    <div className="modal-actions"><button onClick={m.closeConvert}>Cancel — keep parameters</button><button className="danger" onClick={m.confirmConvert}>Convert anyway</button></div>
  </section></div>
}
/* ---------- scenarios (scripted, for screenshots + demo) ---------- */
const scenarios: Record<string, string> = {
  preset: 'Preset gallery → rounded rect with live parameters',
  custom: 'Custom Path draft: line + circular + elliptical arcs, live chips',
  snap: 'Snapping: endpoint of wall W-3 while drawing',
  invalid: 'Self-crossing draft → named invariant, commit disabled',
  overlap: 'Room overlap → commit blocked with named Room',
  corners: 'Fillet all corners of a Custom Path',
  convert: 'Preset → Custom conversion warning',
  rotate: 'Free rotation: local W/D vs Floor bbox',
  origin: 'Item Origin change previews all placements',
  wallref: 'Wall-face reference + compatible host edit',
  numeric: 'Exact numeric segment edit (length)',
  warning: 'Item crosses Room → measured non-blocking warning',
}
function runScenario(m: M, id: string) {
  m.reset()
  const step: Record<string, number> = { preset: 2, custom: 1, snap: 1, invalid: 1, overlap: 4, corners: 2, convert: 2, rotate: 2, origin: 2, wallref: 3, numeric: 3, warning: 4 }
  if (step[id]) m.setStep(step[id])
  const go = () => {
    switch (id) {
      case 'preset': m.pickPreset('rr'); break
      case 'custom':
        m.startDraft('l'); m.draftClick(P(5400, 1500)); m.setTool('a'); m.draftClick(P(6900, 1500)); m.setTool('e'); m.draftClick(P(6900, 2900)); m.setTool('l'); m.draftClick(P(5700, 3100)); m.hoverAt(P(5400, 1500)); break
      case 'snap': m.startDraft('l'); m.draftClick(P(2000, 6000)); m.hoverAt(P(1010, 6990)); break
      case 'invalid': m.startDraft('l'); m.draftClick(P(5400, 1500)); m.draftClick(P(6900, 2900)); m.draftClick(P(6900, 1500)); m.draftClick(P(5400, 2900)); m.hoverAt(P(6150, 2200)); break
      case 'overlap': m.startDraft('l'); m.draftClick(P(6000, 5000)); m.draftClick(P(7500, 5000)); m.draftClick(P(7500, 6000)); m.draftClick(P(6000, 6000)); m.closeDraft(); break
      case 'corners': m.select({ kind: 'room', id: 'kitchen' }); m.roundCorners('kitchen', 250); break
      case 'convert': m.select({ kind: 'room', id: 'bedroom' }); m.requestConvert('bedroom'); break
      case 'rotate': m.select({ kind: 'placement', id: 'p2' }); m.rotatePlacement('p2', 52); break
      case 'origin': m.select({ kind: 'design', id: 'base600' }); m.setOrigin('base600', P(0, 400)); break
      case 'wallref': m.select({ kind: 'seg', id: 'kitchen', i: 1 }); m.attachRef('kitchen', 1, 'W-5', 'L'); m.moveWall('W-5', 200); break
      case 'numeric': m.select({ kind: 'seg', id: 'kitchen', i: 1 }); m.editSeg('kitchen', 1, { len: 3200 }); break
      case 'warning': m.select({ kind: 'placement', id: 'p2' }); break
    }
  }
  go()
}
function ScenarioSelect({ m }: { m: M }) {
  return <select value="" onChange={e => { if (e.target.value) runScenario(m, e.target.value) }}>
    <option value="">Scenario…</option>
    {Object.entries(scenarios).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
  </select>
}

/* ---------- variant A: CAD ribbon + right inspector ---------- */
function VariantA({ m }: { m: M }) {
  const [tab, setTab] = useState<'params' | 'path' | 'derived'>('params')
  useEffect(() => { if (m.ui.sel?.kind === 'seg') setTab('path') }, [m.ui.sel])
  const room = (m.ui.sel?.kind === 'room' || m.ui.sel?.kind === 'seg') ? m.model.rooms.find(r => r.id === m.ui.sel!.id) : null
  const pl = m.ui.sel?.kind === 'placement' ? m.model.placements.find(p => p.id === m.ui.sel!.id) : null
  const design = m.ui.sel?.kind === 'design' ? m.model.designs.find(d => d.id === m.ui.sel!.id) : null
  const wall = m.ui.sel?.kind === 'wall' ? m.model.walls.find(w => w.id === m.ui.sel!.id) : null
  const segI = m.ui.sel?.kind === 'seg' ? m.ui.sel.i : null
  return <div className="va">
    <div className="toolbar">
      <span className="brand">⬡ Odd Shapes</span><span className="eyebrow">A · CAD ribbon</span><i className="sep" />
      <PresetButtons m={m} /><i className="sep" /><DrawTools m={m} /><i className="sep" /><SnapToggles m={m} />
      <span className="grow" /><ScenarioSelect m={m} /><button onClick={m.undo}>↩ Undo</button><button className={m.ui.showState ? 'on' : ''} onClick={m.toggleState}>State</button>
    </div>
    <BlockStrip m={m} />
    <div className="va-body">
      <div className="canvas-wrap"><div className="plan-stage"><PlanCanvas m={m} />
        {m.ui.draft && <div className={`hint ${m.draftErrors.length ? 'bad' : ''}`}>{m.draftErrors.length ? `✗ ${m.draftErrors[0]}` : `${m.ui.draft.tool === 'l' ? 'Line' : m.ui.draft.tool === 'a' ? 'Arc' : 'Elliptical arc'} · click to place · click start to close · Esc cancels`}</div>}
      </div></div>
      <aside className="inspector">
        <div className="tabs">{(['params', 'path', 'derived'] as const).map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ params: 'Parameters', path: 'Path', derived: 'Derived' }[t]}</button>)}</div>
        {room && <>
          {tab === 'params' && <div className="sect"><ParamFields m={m} room={room} /></div>}
          {tab === 'path' && <div className="sect">{segI !== null ? <SegEditor m={m} room={room} i={segI} /> : <p className="helper">Click a vertex/segment on canvas to edit exactly.</p>}<SegList m={m} room={room} /></div>}
          {tab === 'derived' && <div className="sect"><DerivedPanel m={m} room={room} /></div>}
        </>}
        {pl && <div className="sect"><PlacementPanel m={m} pl={pl} /></div>}
        {design && <div className="sect"><DesignPanel m={m} design={design} /></div>}
        {wall && <div className="sect"><WallPanel m={m} wall={wall} /></div>}
        <div className="sect"><h4>Spatial warnings</h4><WarningsPanel m={m} /></div>
        {m.ui.showState && <div className="sect"><h4>Canonical state</h4><StatePanel m={m} /></div>}
      </aside>
    </div>
    <ConvertDialog m={m} />
  </div>
}

/* ---------- variant B: floating palette + on-canvas chips ---------- */
function VariantB({ m }: { m: M }) {
  const [drawer, setDrawer] = useState(true)
  const { ui, model } = m
  const room = (ui.sel?.kind === 'room') ? model.rooms.find(r => r.id === ui.sel!.id) : null
  const seg = ui.sel?.kind === 'seg' ? { r: model.rooms.find(r => r.id === ui.sel!.id)!, i: ui.sel.i } : null
  const pl = ui.sel?.kind === 'placement' ? model.placements.find(p => p.id === ui.sel!.id) : null
  const at = (p: Pt) => ({ left: `${(p.x / VW) * 100}%`, top: `${(p.y / VH) * 100}%` })
  return <div className="vb">
    <div className="toolbar"><span className="brand">⬡ Odd Shapes</span><span className="eyebrow">B · On-canvas chips</span>
      <span className="grow" /><ScenarioSelect m={m} /><button onClick={m.undo}>↩ Undo</button><SnapToggles m={m} /></div>
    <BlockStrip m={m} />
    <div className="canvas-wrap"><div className="plan-stage">
      <PlanCanvas m={m} />
      <nav className="float-palette">
        <span className="grp">Presets</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>{presetKinds.map(k => <button key={k} title={presetNames[k]} onClick={() => m.pickPreset(k)}>{presetIcons[k]}</button>)}</div>
        <span className="grp">Draw</span><DrawTools m={m} />
      </nav>
      {room && <div className="chip-pop" style={at(P((bboxOf(polyOf(room.segs)).x0 + bboxOf(polyOf(room.segs)).x1) / 2, (bboxOf(polyOf(room.segs)).y0 + bboxOf(polyOf(room.segs)).y1) / 2))}>
        <b>{room.name}</b>
        {room.params && <>
          <span className="lbl">W</span><input className="num" type="number" value={Math.round(room.params.w)} onChange={e => m.setParams(room.id, { w: Number(e.target.value) })} />
          <span className="lbl">D</span><input className="num" type="number" value={Math.round(room.params.d)} onChange={e => m.setParams(room.id, { d: Number(e.target.value) })} />
          {room.preset === 'rr' && <><span className="lbl">r</span><input className="num" type="number" value={Math.round(room.params.r)} onChange={e => m.setParams(room.id, { r: Number(e.target.value), cr: null })} /></>}
        </>}
        <span className="lbl">{m2(areaOf(polyOf(room.segs)))}</span>
        <button className="mini" onClick={() => m.select({ kind: 'seg', id: room.id, i: 0 })}>Segments →</button>
      </div>}
      {seg && <div className="chip-pop" style={at(mid(seg.r.segs[seg.i].a, seg.r.segs[seg.i].b))}>
        <b>#{seg.i + 1}</b><span className="lbl">len</span><input className="num" type="number" value={Math.round(segLen(seg.r.segs[seg.i]))} onChange={e => m.editSeg(seg.r.id, seg.i, seg.r.segs[seg.i].k === 'l' ? { len: Number(e.target.value) } : seg.r.segs[seg.i].k === 'a' ? { r: Number(e.target.value) } : { rx: Number(e.target.value) })} />
        {seg.r.segs[seg.i].k === 'l' && <><span className="lbl">∠</span><input className="num" type="number" value={Math.round(segAng(seg.r.segs[seg.i]))} onChange={e => m.editSeg(seg.r.id, seg.i, { ang: Number(e.target.value) })} /></>}
        <button className="mini" onClick={() => m.select({ kind: 'room', id: seg.r.id })}>Room</button>
      </div>}
      {pl && <div className="chip-pop" style={at(P(pl.x, pl.y))}>
        <b>{pl.label}</b><span className="lbl">rot</span><input className="num" type="number" value={pl.rot} onChange={e => m.rotatePlacement(pl.id, Number(e.target.value))} />
        <button className="mini" onClick={() => m.select({ kind: 'design', id: pl.design })}>Design…</button>
      </div>}
      {ui.draft && <div className={`hint ${m.draftErrors.length ? 'bad' : ''}`}>{m.draftErrors.length ? `✗ ${m.draftErrors[0]}` : 'Chips show length/angle live · click start to close · Esc cancels'}</div>}
    </div></div>
    <div className="vb-drawer">
      <div className="head" onClick={() => setDrawer(!drawer)}><b>{drawer ? '▾' : '▸'} Warnings & state</b><span className="helper">{m.warnings.length} warning(s) · {ui.log[0]}</span></div>
      {drawer && <div className="body"><WarningsPanel m={m} /><StatePanel m={m} /></div>}
    </div>
    <ConvertDialog m={m} />
  </div>
}
/* ---------- variant C: step rail + segment spreadsheet ---------- */
function VariantC({ m }: { m: M }) {
  const { ui, model } = m
  const room = (ui.sel?.kind === 'room' || ui.sel?.kind === 'seg') ? model.rooms.find(r => r.id === ui.sel!.id) : null
  const pl = ui.sel?.kind === 'placement' ? model.placements.find(p => p.id === ui.sel!.id) : null
  const design = ui.sel?.kind === 'design' ? model.designs.find(d => d.id === ui.sel!.id) : null
  const wall = ui.sel?.kind === 'wall' ? model.walls.find(w => w.id === ui.sel!.id) : null
  const segI = ui.sel?.kind === 'seg' ? ui.sel.i : null
  const step = ui.step
  const S = (n: number, title: string, body: ReactNode) => <div className={`step ${step === n ? 'open' : ''}`}>
    <div className="head" onClick={() => m.setStep(n)}><em>{n}</em>{title}</div>
    {step === n && <div className="body">{body}</div>}
  </div>
  return <div className="vc">
    <aside className="vc-rail">
      <div className="pad"><p className="eyebrow">C · Guided steps</p><p className="helper">Shape → Parameters → Refine → Commit</p></div>
      {S(1, 'Shape', <>
        <PresetButtons m={m} compact />
        <div style={{ marginTop: 6 }}><DrawTools m={m} /></div>
        <p className="helper">Presets keep defining parameters; Custom Path exposes segments. Both evaluate to the same canonical path.</p>
      </>)}
      {S(2, 'Parameters', room ? <ParamFields m={m} room={room} /> : pl ? <PlacementPanel m={m} pl={pl} /> : design ? <DesignPanel m={m} design={design} /> : wall ? <WallPanel m={m} wall={wall} /> : <p className="helper">Select a Room, Item, or Wall.</p>)}
      {S(3, 'Refine', room ? <>{segI !== null ? <SegEditor m={m} room={room} i={segI} /> : <p className="helper">Pick a row below to edit exactly.</p>}<SnapToggles m={m} /></> : <p className="helper">Select a Room first.</p>)}
      {S(4, 'Commit', <>{room && <DerivedPanel m={m} room={room} />}<WarningsPanel m={m} />{room && <div className="row-actions"><button className="primary" onClick={m.closeDraft} disabled={!!m.ui.draft && m.draftErrors.length > 0}>Commit draft</button><button onClick={m.undo}>Undo</button></div>}</>)}
      <div className="pad"><ScenarioSelect m={m} /><div style={{ marginTop: 6 }} className="row-actions"><button className={ui.showState ? 'on' : ''} onClick={m.toggleState}>State</button></div></div>
      {ui.showState && <div className="pad"><StatePanel m={m} /></div>}
    </aside>
    <div className="vc-main">
      <BlockStrip m={m} />
      <div className="canvas-wrap"><div className="plan-stage"><PlanCanvas m={m} />
        {ui.draft && <div className={`hint ${m.draftErrors.length ? 'bad' : ''}`}>{m.draftErrors.length ? `✗ ${m.draftErrors[0]}` : 'Draft open — Step 4 commits only while valid'}</div>}
      </div></div>
      <div className="vc-table">{room ? <><div className="pad" style={{ paddingBottom: 0 }}><h4>{room.name} — segment spreadsheet (exact mm)</h4></div><SegList m={m} room={room} /></> : <div className="pad helper">Select a Room to inspect its canonical segment list.</div>}</div>
    </div>
    <ConvertDialog m={m} />
  </div>
}

/* ---------- shell ---------- */
const variantNames: Record<string, string> = { A: 'CAD ribbon', B: 'On-canvas chips', C: 'Step rail' }
function App() {
  const m = useShapes()
  const [variant, setVariant] = useState(() => (new URLSearchParams(location.search).get('variant') ?? 'A').toUpperCase().slice(0, 1))
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current) return
    applied.current = true
    const sc = new URLSearchParams(location.search).get('scenario')
    if (sc && scenarios[sc]) runScenario(m, sc)
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'ArrowRight') setVariant(v => (v === 'A' ? 'B' : v === 'B' ? 'C' : 'A'))
      if (e.key === 'ArrowLeft') setVariant(v => (v === 'A' ? 'C' : v === 'C' ? 'B' : 'A'))
      if (e.key === 'Escape') { if (m.ui.draft) m.cancelDraft(); else if (m.ui.convert) m.closeConvert(); else if (m.ui.block) m.setBlock(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [m.ui.draft, m.ui.convert, m.ui.block])
  return <>
    <div className="prototype-notice">Throwaway prototype — in-memory only · single Floor, local mm · answers #30 (contract from #16)</div>
    <div className="prototype">{variant === 'A' ? <VariantA m={m} /> : variant === 'B' ? <VariantB m={m} /> : <VariantC m={m} />}</div>
    <nav className="variant-switcher">
      <button onClick={() => setVariant(v => (v === 'A' ? 'C' : v === 'C' ? 'B' : 'A'))}>←</button>
      {Object.keys(variantNames).map(v => <button key={v} className={variant === v ? 'active' : ''} onClick={() => setVariant(v)}>{v} · {variantNames[v]}</button>)}
      <button onClick={() => setVariant(v => (v === 'A' ? 'B' : v === 'B' ? 'C' : 'A'))}>→</button>
    </nav>
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
