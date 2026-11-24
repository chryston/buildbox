/**
 * The Beams of one Floor, drawn (#77 §1, §4).
 *
 * A Beam stores a reference line, a width and a justification; the two faces and the outline the
 * plan paints come from `geometry.linearElement` — the same primitive a Wall's body is built from,
 * which is the whole of the issue's "one line-element vocabulary". Nothing here is stored: a Beam
 * that has been widened has always been that wide, and a record with faces in it would be a second
 * answer to the same question.
 *
 * A Beam joins nothing (#77 §1 criterion 2). There is no clean-up pass over this list, no corner
 * where two of them meet, and no trim of one by the other: two Beams that cross simply both exist,
 * and their outlines overlap without either knowing. That is why this module is a map and a list
 * rather than a `joinWalls`.
 *
 * The Design Option is part of the answer: a Beam this Option drew is proposed work and stands in
 * the same list as surveyed work, because a Beam is documentation and there is no half-standing
 * state for it to be in (#77 §2 criterion 3).
 */
import type { Beam, EntityId, Project } from '../domain'
import { beamLabel, beamTop } from '../domain'
import type { ClosedPath, Pt, Segment, WallSide } from '../geometry'
import { linearElement, refLength } from '../geometry'
import type { WallFaceSource } from './snapCandidates'
import { effectiveModel } from './effectiveModel'

/** One face of a Beam, with the key that names it. */
export interface DerivedBeamFace {
  /** `(beamId, side)`, stable while the face itself is not moved. */
  readonly key: string
  readonly beamId: EntityId
  readonly side: WallSide
  readonly from: Pt
  readonly to: Pt
  readonly segment: Segment
}

/** One Beam of the Floor, with the geometry the plan paints. */
export interface DerivedBeam {
  readonly id: EntityId
  /** `Beam B-3`, or `Beam` where nobody named it — the wording every label of this Beam uses. */
  readonly label: string
  readonly outline: ClosedPath
  /** `[left, right]`, in the reference line's own direction. */
  readonly faces: readonly [DerivedBeamFace, DerivedBeamFace]
  /** Length along the reference line, in millimetres — never along a face. */
  readonly length: number
  readonly underside: number
  readonly top: number
}

/** Everything derived for one Floor's Beams. */
export interface FloorBeams {
  readonly beams: readonly DerivedBeam[]
  readonly byId: ReadonlyMap<EntityId, DerivedBeam>
  /** Every face of the Floor, both of each Beam. */
  readonly faces: readonly DerivedBeamFace[]
  /** The same faces and ends in the shape the shared snap engine takes (#59 §5). */
  readonly snapSources: readonly WallFaceSource[]
}

/** The four corners of a Beam's body, walked off the outline `linearElement` returns. */
function body(line: { start: Pt; end: Pt }, width: number, justification: Beam['justification']): [Pt, Pt, Pt, Pt] {
  const { outline } = linearElement({ kind: 'line', to: line.end }, line.start, width, justification)
  const [face0, cap, face1Back] = outline.segments
  // start → face 0 → the far cap → back along face 1 → closed. The walk gives the four corners in
  // the order the faces need, and keeps this module honest by reading the primitive's own answer.
  return [outline.start, face0.to, cap.to, face1Back.to]
}

/**
 * The Beams one Floor draws, with their faces (#77 §4).
 *
 * Pure: the same Project, Floor and Design Option always give a byte-identical answer, and a Floor
 * with no Beams gives an empty result rather than `undefined`.
 */
export const deriveBeams = (project: Project, floorId: EntityId, optionId: EntityId | null = null): FloorBeams => {
  const model = effectiveModel(project, floorId, optionId)
  const beams = model.beams
    .filter(({ entity }) => entity.floorId === floorId)
    .map(({ entity }): DerivedBeam => {
      const [a, b, c, d] = body(entity.line, entity.width, entity.justification)
      const face = (side: WallSide, from: Pt, to: Pt): DerivedBeamFace => ({
        key: `${entity.id}/${side}`,
        beamId: entity.id,
        side,
        from,
        to,
        segment: { kind: 'line', to },
      })
      const name = beamLabel(entity)
      return {
        id: entity.id,
        label: name,
        outline: { start: a, segments: [{ kind: 'line', to: b }, { kind: 'line', to: c }, { kind: 'line', to: d }, { kind: 'line', to: a }] },
        faces: [face('left', a, b), face('right', d, c)],
        length: refLength({ kind: 'line', start: entity.line.start, end: entity.line.end }),
        underside: entity.underside,
        top: beamTop(entity),
      }
    })
  const faces = beams.flatMap((beam) => [...beam.faces])
  return {
    beams,
    byId: new Map(beams.map((beam) => [beam.id, beam])),
    faces,
    // A Beam's ends are snap targets the same way a free Wall end is; its centreline is not, which
    // is the `A-snap` rule of #59 and applies to a reference line whatever element it belongs to.
    snapSources: beams.map((beam) => ({
      id: beam.id,
      label: `${beam.label} · face`,
      corners: [
        { point: beam.faces[0].from, label: `End of ${beam.label}` },
        { point: beam.faces[0].to, label: `End of ${beam.label}` },
        { point: beam.faces[1].from, label: `End of ${beam.label}` },
        { point: beam.faces[1].to, label: `End of ${beam.label}` },
      ],
      faces: beam.faces.map((one) => ({ from: one.from, to: one.to, segment: one.segment })),
    })),
  }
}
