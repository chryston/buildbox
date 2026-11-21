/**
 * The Room-side face picker (#67 §10–§11, D8).
 *
 * A Room Edge claims a Wall face when the person says so — snapping never creates a reference — and
 * the claim is made here, one Edge at a time. The list holds only faces parallel to that Edge and
 * within a screen's worth of reach, each named by the Room it borders, because `W-5 · left` is not
 * a thing anyone can point at in a flat. Choosing one previews the move it makes — the Edge onto
 * the face, its neighbours extended or trimmed along their own lines — and the preview is the same
 * proposal the canvas paints and the Intent re-checks: red and unconfirmable when it would take
 * floor from another Room.
 */
import type { ReactNode } from 'react'
import type { DisplayUnit, EntityId, Room, WallFaceSide } from '../../../domain'
import { roomSegments } from '../../../domain'
import type { FloorWalls, RoomFaceCandidate } from '../../../derive'
import { lengthOf, roomFaceLabel } from '../../../derive'
import { STRINGS } from '../../strings'
import { readoutMm } from '../displayUnits'

/** One Edge of the Room, as the picker lists it. */
export interface RoomEdgeRow {
  readonly segmentId: EntityId
  /** The display ordinal: `Kitchen edge 2`, the same number the block messages use. */
  readonly edge: number
  readonly lengthMm: number
  /** Only a line Edge can lie on a face (#67 §2). */
  readonly straight: boolean
  /** The face this Edge already claims, or `null`. */
  readonly attached: { readonly wallId: EntityId; readonly side: WallFaceSide; readonly label: string } | null
}

/** Every Edge of the Room, in Outline order, with whatever face it claims. */
export function roomEdgeRows(room: Room, walls: FloorWalls | null, rooms: readonly Room[]): RoomEdgeRow[] {
  return roomSegments(room.outline).map((segment) => {
    const row = {
      segmentId: segment.id,
      edge: segment.edge,
      lengthMm: lengthOf(segment.segment, segment.from),
      straight: segment.segment.kind === 'line',
    }
    const claim = room.wallFaceRefs.find((reference) => reference.segmentId === segment.id)
    if (claim === undefined || walls === null) return { ...row, attached: null }
    const face = walls.faces.find((each) => each.wallId === claim.wallId && each.side === claim.side)
    return {
      ...row,
      attached: face === undefined
        ? null
        : { wallId: claim.wallId, side: claim.side, label: roomFaceLabel(room, face, walls, rooms) },
    }
  })
}

/** The one key a candidate is known by inside the picker. */
export const faceKey = (candidate: { wallId: EntityId; side: WallFaceSide }): string => `${candidate.wallId}|${candidate.side}`

export interface RoomFacePickerProps {
  readonly edges: readonly RoomEdgeRow[]
  /** The Edge whose list of faces is open, or `null`. */
  readonly openEdge: EntityId | null
  /** The faces offered for that Edge, nearest first. */
  readonly candidates: readonly RoomFaceCandidate[]
  /** The candidate being previewed, as `faceKey`, or `null`. */
  readonly previewKey: string | null
  /** Why the preview cannot be confirmed — the overlap sentence — or `null` when it can. */
  readonly blocked: string | null
  readonly onOpen: (segmentId: EntityId | null) => void
  readonly onPreview: (candidate: RoomFaceCandidate | null) => void
  readonly onAttach: (candidate: RoomFaceCandidate) => void
  readonly onDetach: (segmentId: EntityId) => void
  readonly unit: DisplayUnit
  readonly precision: number
}

export function RoomFacePicker(props: RoomFacePickerProps): ReactNode {
  const { edges, openEdge, candidates, previewKey, blocked, onOpen, onPreview, onAttach, onDetach, unit, precision } = props
  const read = (mm: number): string => readoutMm(mm, unit, precision)

  return (
    <div className="bb-room-edges" data-testid="room-face-picker">
      <h4 className="bb-workspace-card-title">{STRINGS.tabEdges}</h4>
      <ul className="bb-room-edge-list">
        {edges.map((row) => {
          const open = openEdge === row.segmentId
          return (
            <li className="bb-room-edge" data-testid={`room-edge-${row.segmentId}`} key={row.segmentId}>
              <span className="bb-room-edge-name">
                {STRINGS.edgeOfKind(row.edge, row.straight ? STRINGS.line : STRINGS.arc)}
              </span>
              <span className="bb-room-edge-length">{read(row.lengthMm)}</span>
              {row.attached !== null && (
                <span className="bb-room-edge-anchor" data-testid={`room-edge-anchor-${row.segmentId}`}>
                  {STRINGS.attachedTo(row.attached.label)}
                </span>
              )}
              {row.attached !== null ? (
                <button
                  className="bb-workspace-button"
                  data-testid={`room-edge-detach-${row.segmentId}`}
                  onClick={() => {
                    onDetach(row.segmentId)
                  }}
                >
                  {STRINGS.detach}
                </button>
              ) : row.straight ? (
                <button
                  className="bb-workspace-button"
                  data-testid={`room-edge-attach-${row.segmentId}`}
                  onClick={() => {
                    onOpen(open ? null : row.segmentId)
                  }}
                >
                  {STRINGS.attachToFace}
                </button>
              ) : null}
              {open && (
                <ul className="bb-room-face-list" data-testid={`room-face-list-${row.segmentId}`}>
                  {candidates.length === 0 && (
                    <li className="bb-shape-hint" data-testid="room-face-none">{STRINGS.noFaceInReach}</li>
                  )}
                  {candidates.map((candidate) => {
                    const key = faceKey(candidate)
                    const picked = previewKey === key
                    return (
                      <li className="bb-room-face" data-testid={`room-face-${key}`} key={key}>
                        <button
                          className="bb-workspace-button"
                          data-testid={`room-face-pick-${key}`}
                          onClick={() => {
                            onPreview(picked ? null : candidate)
                          }}
                        >
                          {candidate.label}
                        </button>
                        {picked && (
                          <>
                            <span
                              className={candidate.outline === null ? 'bb-shape-problem' : 'bb-room-face-move'}
                              data-testid={`room-face-move-${key}`}
                            >
                              {candidate.outline === null
                                ? STRINGS.convertToAttach
                                : candidate.onFace
                                  ? STRINGS.noMove
                                  : STRINGS.movesEdge(read(candidate.distanceMm))}
                            </span>
                            {blocked !== null && (
                              <span className="bb-shape-problem" role="status" data-testid={`room-face-blocked-${key}`}>
                                {blocked}
                              </span>
                            )}
                            <button
                              className="bb-workspace-button"
                              data-testid={`room-face-attach-${key}`}
                              disabled={candidate.outline === null || blocked !== null}
                              onClick={() => {
                                onAttach(candidate)
                              }}
                            >
                              {STRINGS.attach}
                            </button>
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
