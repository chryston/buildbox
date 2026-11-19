/**
 * The Item Detail shape editor (#58 §3): toolbar, rail, canvas, draft bar.
 *
 * It is laid out like the Floor workspace — a fixed-height toolbar, a left rail, a canvas host
 * with a draft bar pinned to its top edge — but it is not `WorkspaceShell`. That shell's slots
 * are Floor slots: a view card and a selection inspector have no meaning for an Item Design on
 * its own, and it renders `data-testid="floor-workspace"`, which would be a lie on a page that
 * is not the Floor. Sharing the tokens and the density is the right amount of reuse; sharing
 * the layout would mean one of them growing the other's exceptions.
 *
 * Everything that could make a bad shape reaches the controller here and nowhere else. This
 * component never calls `dispatch` for a shape it has not been told is acceptable, and it owns
 * no proposal state of its own — the draft lives in the workspace store, so the canvas, the
 * rail and the draft bar are three readings of one value.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { designFootprintSize, footprintAsPath, PRESET_NAMES, rectangleFootprint } from '../../../domain'
import type { ItemDesign, ItemFootprint } from '../../../domain'
import type { PresetKind, Pt, Segment } from '../../../derive'
import {
  SNAP_ACQUISITION_PX,
  designOutline,
  distance,
  midpoints,
  moveVertex,
  pathOrigin,
  pathToSvg,
  resolveSnap,
  snapCandidates,
  vertices,
} from '../../../derive'
import { formatMm, parseToMm } from '../displayUnits'
import { SnapsMenu } from '../SnapsMenu'
import { DRAW_TOOLS } from '../toolbarRegistry'
import { useWorkspaceDispatch, useWorkspaceProject, useWorkspaceRoot } from '../WorkspaceRoot'
import { ToolbarMenu } from '../WorkspaceToolbar'
import { enabledKindsOf, useWorkspace, workspaceStore } from '../workspaceStore'
import type { ShapeTab as ShapeTabName } from '../workspaceStore'
import {
  beginClose,
  chipForSegment,
  clickDraft,
  closeDraft,
  draftEnd,
  draftIsJudgeable,
  draftLoop,
  draftPreviewSegments,
  draftSegments,
  startDraft,
  undoPoint,
  withCursor,
  withTool,
  withTypedLength,
} from './draftPath'
import type { DrawTool, DraftChip, PathDraft } from './draftPath'
import { FootprintCanvas } from './FootprintCanvas'
import type { DraftEdgeView, DraftView, LengthFieldView } from './FootprintCanvas'
import {
  canCommit,
  discard,
  ghostFootprint,
  markerPoint,
  markedField,
  needsPreview,
  openShape,
  propose,
  proposalMessage,
  shownFootprint,
} from './proposal'
import type { ShapeDraft, ShapeGesture } from './proposal'
import { shapeTarget } from './shapeTarget'
import { placementDefaults, placementFootprint } from './placement'
import type { DragBox, PlacementGesture } from './placement'
import type { ShapeFieldId } from './parameters'
import { ShapesGallery } from './ShapesGallery'
import { ShapeTab } from './ShapeTab'
import { EdgesTab } from './EdgesTab'
import { MeasurementsTab } from './MeasurementsTab'
import { ConvertDialog } from './ConvertDialog'
import './shape.css'

/**
 * True when the caret is inside a field, where Enter and Backspace belong to the text and a digit
 * is a keystroke rather than a command (#59 §1).
 */
const isTypingInto = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement
  && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')

export interface ShapeEditorProps {
  readonly itemDesignId: string
  readonly design: ItemDesign
  /**
   * `editor` is the Item Design editor: the tool row, the rail and a canvas of its own.
   * `inspector` is the same three tabs with no canvas, for a host that already owns a drawing
   * and gives this one a column of its own — a cabinet's Item Detail, whose canvas is the
   * cabinet editor. `stacked` is the same tabs again in a host that is already a narrow panel
   * and has a frame of its own to sit inside — the Floor selection inspector. Nothing else about
   * the editor changes, which is the point: one set of tabs, one set of labels, one controller
   * behind all three.
   */
  readonly layout?: 'editor' | 'inspector' | 'stacked'
  /**
   * Show the shape without offering to change it. The Floor selection inspector reads a Placed
   * Item's footprint here; editing it belongs to the Item Design editor, because it would move
   * every other placement (#58 §2).
   */
  readonly readOnly?: boolean
}

const TABS: readonly { id: ShapeTabName; label: string }[] = [
  { id: 'shape', label: 'Shape' },
  { id: 'edges', label: 'Edges' },
  { id: 'measurements', label: 'Measurements' },
]

/** What Item Detail says about a cabinet's size, in the one place both readings of it live. */
export const CABINET_SHAPE_NOTE = 'Size comes from the cabinet construction'

const IDLE = (footprint: ItemFootprint): ShapeDraft => ({ proposal: { state: 'idle' }, lastValid: footprint })

export function ShapeEditor(props: ShapeEditorProps): ReactNode {
  const { itemDesignId, design, layout = 'editor', readOnly = false } = props
  const { session, services } = useWorkspaceRoot()
  const project = useWorkspaceProject(session)
  const dispatch = useWorkspaceDispatch()
  const tab = useWorkspace((state) => state.shapeTab)
  const draftState = useWorkspace((state) => state.shapeDraft)
  const [convertOpen, setConvertOpen] = useState(false)

  // A cabinet's Item Footprint, height and Item Origin are derived from its construction
  // (#42 §2), so there is nothing to edit and no target to propose against. The tab still
  // renders, read-only, with the derived size in it — the size is real, only the editing is
  // not available.
  const isCabinet = design.kind === 'cabinet'
  const derived = isCabinet ? designFootprintSize(design) : null
  const committed: ItemFootprint = design.kind === 'generic'
    ? design.footprint
    : rectangleFootprint(derived?.width ?? 0, derived?.depth ?? 0)
  const target = isCabinet ? null : shapeTarget(project, itemDesignId)
  const draft: ShapeDraft | null = target === null
    ? null
    : draftState?.itemDesignId === itemDesignId
      ? draftState.draft
      : openShape(target)

  const shown = shownFootprint(draft ?? IDLE(committed), committed)
  const invalid = draft !== null && draft.proposal.state === 'invalid'
  const message = draft === null ? null : proposalMessage(draft)
  const field = draft === null ? null : markedField(draft)
  const marker = draft === null ? null : markerPoint(draft)
  const ghost = draft === null ? null : ghostFootprint(draft)
  const format = { unit: project.preferences.displayUnit, precision: project.preferences.displayPrecision }

  /** Write the footprint. Only ever reached with a proposal the controller accepted. */
  const commit = (footprint: ItemFootprint): void => {
    dispatch(services.intent.build('design.setFootprint', { itemDesignId, footprint }))
    workspaceStore.getState().setShapeDraft(itemDesignId, null)
  }

  /**
   * Put a footprint on screen. `final` is what separates a keystroke from an Enter or a blur:
   * only a final gesture on a design with one placement is allowed to reach the model, and
   * only when the controller says the shape is acceptable.
   */
  const gesture = (footprint: ItemFootprint, touched: ShapeFieldId | null, final: boolean): void => {
    if (target === null || draft === null) return
    const from: ShapeGesture = touched === null ? { via: 'canvas' } : { via: 'field', field: touched }
    const next = propose(target, draft, from, footprint)
    if (final && next.proposal.state === 'valid' && !needsPreview(target)) {
      commit(footprint)
      return
    }
    workspaceStore.getState().setShapeDraft(itemDesignId, next)
  }

  const dropDraft = (): void => {
    if (draft !== null) workspaceStore.getState().setShapeDraft(itemDesignId, discard(draft))
  }

  /**
   * The preset waiting to be placed, and the box being dragged for it.
   *
   * Both are local, and both are gone the moment the gesture ends: a shape that has been picked
   * out of the gallery but not drawn yet is not a proposal, and putting it in the workspace
   * store would mean a reload could find a half-placed Rectangle on screen.
   */
  const [placing, setPlacing] = useState<PresetKind | null>(null)
  const [drag, setDrag] = useState<DragBox | null>(null)

  const stopPlacing = (): void => {
    setPlacing(null)
    setDrag(null)
  }

  /** A number in the Project's display unit, for the chips and for the status line. */
  const num = (mm: number): string => formatMm(mm, format.unit, format.precision)

  /**
   * The draw tool that is armed, the draft it is drawing, and the length being typed (#59 §1).
   *
   * All three are local, like `placing`: a half-drawn path is not a proposal, and putting it in
   * the workspace store would let a reload find a shape on screen that was never committed. What
   * *is* proposed is the loop the draft would close to, and only from three Edges up — a draft of
   * two Edges cannot close without crossing itself, and calling that invalid would put a red
   * sentence on screen while the person is still drawing.
   */
  const [drawTool, setDrawTool] = useState<DrawTool | null>(null)
  const [pathDraft, setPathDraft] = useState<PathDraft | null>(null)
  const [typedLength, setTypedLength] = useState<string | null>(null)
  /** Millimetres per screen pixel, reported by the canvas: 12 px of acquisition is a length. */
  const [scale, setScale] = useState(1)
  const snapSettings = useWorkspace((state) => state.snapSettings)
  const shapeSelection = useWorkspace((state) => state.shapeSelection)
  const snapKinds = useMemo(() => enabledKindsOf(snapSettings), [snapSettings])
  /** The shape the draft snaps to, in the shape's own millimetres. */
  const snapGeometry = useMemo(() => [{ path: designOutline(design), name: design.name }], [design])

  /**
   * The snap in force for a cursor position (#59 §5), or `null` when nothing is within reach.
   *
   * The draft's own Edges go in newest-first, chained back from the last placed vertex, so a snap
   * can see where the draft crosses the shape it is being drawn on.
   */
  const snapAt = (cursor: Pt): { readonly at: Pt; readonly label: string } | null => {
    const placed = pathDraft === null ? [] : draftSegments(pathDraft)
    const from = placed.length === 0 ? (pathDraft?.start ?? null) : placed[placed.length - 1].to
    const snap = resolveSnap(
      snapCandidates({
        geometry: snapGeometry,
        cursor,
        from,
        draft: [...placed].reverse(),
        gridSpacingMm: snapSettings.gridSpacingMm,
        angleIncrementDeg: snapSettings.angle.incrementDeg,
        enabled: snapKinds,
      }),
      cursor,
      scale,
      snapKinds,
    )
    return snap === null ? null : { at: snap.point, label: snap.target.label }
  }

  /**
   * The proposal the controller holds for a draft. Read fresh from the store rather than from the
   * render's `draft`, so a pointer move proposes against what the last move left and never queues
   * a stale state behind itself.
   */
  const proposeLoop = (footprint: ItemFootprint): void => {
    if (target === null) return
    const held = workspaceStore.getState().shapeDraft
    const state = held?.itemDesignId === itemDesignId ? held.draft : openShape(target)
    workspaceStore.getState().setShapeDraft(itemDesignId, propose(target, state, { via: 'canvas' }, footprint))
  }

  /** Every draft change goes through here, so what is on screen is always what was proposed. */
  const updateDraft = (next: PathDraft | null): void => {
    setPathDraft(next)
    setTypedLength(null)
    if (next === null || !draftIsJudgeable(next)) dropDraft()
    else proposeLoop({ kind: 'path', path: draftLoop(next) })
  }

  const stopDraft = (): void => {
    setPathDraft(null)
    setDrawTool(null)
    setTypedLength(null)
    dropDraft()
  }

  /**
   * The `Close` marker is live from three points up — fewer would not be a loop — and never while
   * the draft is invalid, because pressing it would commit a crossing (#59 §1).
   */
  const closeLive = pathDraft !== null && pathDraft.placed.length >= 2 && !invalid

  /**
   * Close the draft and put the result through the controller (#59 §1, behaviour 12).
   *
   * Closing commits only when the proposal is valid *and* the target needs no preview; otherwise
   * the proposal stays up and the draft bar's `Apply` is what commits it, which is the same
   * "Affects N placements" rule every other edit follows.
   */
  const closePath = (kind: DrawTool, bulge?: Pt | null): void => {
    if (pathDraft === null || target === null) return
    const path = closeDraft(pathDraft, kind, bulge)
    const footprint: ItemFootprint = { kind: 'path', path }
    const held = workspaceStore.getState().shapeDraft
    const state = held?.itemDesignId === itemDesignId ? held.draft : openShape(target)
    const next = propose(target, state, { via: 'canvas' }, footprint)
    setPathDraft(null)
    setDrawTool(null)
    setTypedLength(null)
    if (next.proposal.state !== 'valid' || needsPreview(target)) {
      workspaceStore.getState().setShapeDraft(itemDesignId, next)
      return
    }
    commit(footprint)
    // D4: a drawn Custom Path gets its Item Origin at the centre of its local bounds. Only a shape
    // that was not already a Custom Path gets one — moving the origin of a path that has
    // placements on it moves every one of them — and only when it actually moves, because
    // `design.setOrigin` refuses a no-change.
    if (committed.kind !== 'path' && design.kind === 'generic') {
      const at = pathOrigin(path)
      if (at.x !== design.origin.x || at.y !== design.origin.y) {
        dispatch(services.intent.build('design.setOrigin', { itemDesignId, origin: at }))
      }
    }
  }

  /** A press on the canvas while a tool is armed: start, place, or close on the start vertex. */
  const draftPoint = (at: Pt): void => {
    if (drawTool === null) return
    if (pathDraft === null) {
      updateDraft(startDraft(drawTool, at))
      return
    }
    if (closeLive && !pathDraft.pendingClose && distance(at, pathDraft.start) <= SNAP_ACQUISITION_PX * scale) {
      // The draft bar's `Close` closes straight; the marker closes with the active tool's kind,
      // which for an arc means one more click for the bulge.
      if (drawTool === 'line') closePath('line')
      else updateDraft(beginClose(pathDraft))
      return
    }
    const next = clickDraft(pathDraft, at)
    if (next.pendingClose && next.bulge !== null) closePath(next.tool, next.bulge)
    else updateDraft(next)
  }

  /** The rubber band follows the cursor, snapped when a candidate is within reach. */
  const draftMove = (raw: Pt): void => {
    if (pathDraft === null) return
    const snap = snapAt(raw)
    setPathDraft(withCursor(pathDraft, snap === null ? raw : snap.at))
  }

  /**
   * The words on an Edge's chip (#59 §1): `2,000 mm · 90°` for a line, `R 1,050 mm · 3,170 mm`
   * for an arc, `Radii 1,050 × 630 mm · 2,850 mm` for an elliptical one. The prototype's `ell `
   * and `∠` are the two pieces of jargon the issue names by name, and neither is a word.
   */
  const chipLabel = (chip: DraftChip): string => {
    if (chip.kind === 'line') return `${num(chip.lengthMm)} ${format.unit} · ${Math.round(chip.directionDeg)}°`
    if (chip.kind === 'arc') return `R ${num(chip.radiusMm ?? 0)} ${format.unit} · ${num(chip.arcLengthMm ?? 0)} ${format.unit}`
    return `Radii ${num(chip.rx ?? 0)} × ${num(chip.ry ?? 0)} ${format.unit} · ${num(chip.arcLengthMm ?? 0)} ${format.unit}`
  }

  /**
   * The draft as the canvas draws it.
   *
   * Each Edge is its own path rather than one long `d`, because the rubber band is dashed and the
   * placed Edges are not, and one path cannot be both.
   */
  const draftView: DraftView | null = useMemo(() => {
    if (pathDraft === null) return null
    const placed = draftSegments(pathDraft)
    const preview = draftPreviewSegments(pathDraft)
    const view = (segment: Segment, from: Pt): DraftEdgeView => ({
      d: pathToSvg({ start: from, segments: [segment] }),
      label: chipLabel(chipForSegment(segment, from)),
      at: midpoints({ start: from, segments: [segment] })[0],
    })
    const edges: DraftEdgeView[] = []
    let from = pathDraft.start
    for (const segment of placed) {
      edges.push(view(segment, from))
      from = segment.to
    }
    const band = preview.length > placed.length ? view(preview[preview.length - 1], from) : null
    const snap = pathDraft.cursor === null ? null : snapAt(pathDraft.cursor)
    return {
      edges,
      band,
      vertices: [pathDraft.start, ...placed.map((segment) => segment.to)],
      close: { at: pathDraft.start, live: closeLive },
      snap: snap === null ? null : { at: snap.at, label: snap.label },
      // The frame fits the whole draft including the band, so drawing outside the committed shape
      // keeps everything on screen without the canvas box changing size.
      extent: preview.length === 0
        ? [pathDraft.start]
        : [pathDraft.start, ...preview.map((segment) => segment.to)],
    }
  }, [pathDraft, closeLive, snapGeometry, snapKinds, scale, format.unit, format.precision])

  /** The committed shape as a chain, or `null` when it is a preset with no Edges to edit. */
  const committedPath = committed.kind === 'path' ? committed.path : null

  /**
   * A vertex handle moved (#59 §2, behaviour 8).
   *
   * Every move proposes and only the release commits, so a drag is one undo step and a drag that
   * ends on a self-crossing commits nothing — the controller refuses to let an invalid proposal
   * through, and the shape on screen goes red while the handle is still down.
   */
  const handleDrag = (index: number, at: Pt | null): void => {
    if (committedPath === null || target === null) return
    if (at === null) {
      const held = workspaceStore.getState().shapeDraft
      if (
        held?.itemDesignId === itemDesignId
        && held.draft.proposal.state === 'valid'
        && !needsPreview(target)
      ) commit(held.draft.proposal.footprint)
      return
    }
    workspaceStore.getState().setShapeSelection({ vertex: index })
    proposeLoop({ kind: 'path', path: moveVertex(committedPath, index, at).path })
  }

  /**
   * Enter in the length field: the end point lands exactly that many millimetres along the
   * direction the pointer is pointing (#59 §1, behaviour 9). An entry that does not parse just
   * closes the field — a person who typed nonsense meant to abandon it, not to be corrected.
   */
  const commitTypedLength = (): void => {
    if (pathDraft === null) return
    const typed = typedLength === null ? Number.NaN : Number(typedLength)
    const mm = Number.isFinite(typed) ? parseToMm(typed, format.unit) : null
    setTypedLength(null)
    if (mm === null || !(mm > 0)) {
      setPathDraft(withTypedLength(pathDraft, null))
      return
    }
    const aimed = withTypedLength(pathDraft, mm)
    const end = draftEnd(aimed)
    if (end !== null) updateDraft(clickDraft(aimed, end))
  }

  /** The length field sits on the rubber band's chip, which is where the number already is. */
  const lengthField: LengthFieldView | null =
    typedLength === null || pathDraft === null
      ? null
      : {
        at: draftView?.band?.at ?? draftView?.vertices[draftView.vertices.length - 1] ?? pathDraft.start,
        value: typedLength,
        onChange: setTypedLength,
        onCommit: commitTypedLength,
        onCancel: () => setTypedLength(null),
      }

  /**
   * The draft bar's hint (#59 §1): what the tool is, what the next click does, and how to get out.
   * One line, always the same height, because the bar must never resize the canvas.
   */
  const draftHint = (): string => {
    const label = DRAW_TOOLS.find((each) => each.id === (pathDraft?.tool ?? drawTool))?.label ?? 'Line'
    if (pathDraft === null) return `${label} · click to set the first point · Esc cancels`
    const last = pathDraft.placed[pathDraft.placed.length - 1]
    if (pathDraft.pendingClose || (last !== undefined && last.kind !== 'line' && pathDraft.bulge === null))
      return `${label} · click the bulge point · Esc cancels`
    return `${label} · click to place · click start to close · Esc cancels`
  }

  const defaults = placementDefaults(design.kind === 'generic' ? design.footprint : null)

  const place = (gestureFromCanvas: PlacementGesture): void => {
    if (placing === null) return
    stopPlacing()
    gesture(placementFootprint(placing, gestureFromCanvas, defaults), null, true)
  }

  /**
   * The keyboard, wherever the focus is: Esc, Enter, Backspace and a bare digit (#59 §1).
   *
   * Esc answers the same question at three depths — close the length field, else cancel the draft,
   * else discard the proposal — and always means "put back what was there". Enter, Backspace and a
   * digit only mean something while a draft is open, and never while the caret is in a field:
   * typing a `2` into `Length` must not place a vertex, and Backspace there must not eat a point.
   *
   * Criterion 9's "selecting something else" is the same transition from the other end, and lives
   * in the workspace store's selection, not here.
   */
  useEffect(() => {
    const proposalUp = draft !== null && draft.proposal.state !== 'idle'
    if (placing === null && pathDraft === null && !proposalUp) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (typedLength !== null) {
          setTypedLength(null)
          return
        }
        stopPlacing()
        if (pathDraft !== null) stopDraft()
        else dropDraft()
        return
      }
      if (isTypingInto(event.target) || pathDraft === null) return
      if (event.key === 'Enter') {
        event.preventDefault()
        if (pathDraft.pendingClose && pathDraft.bulge !== null) closePath(pathDraft.tool, pathDraft.bulge)
        else closePath(pathDraft.tool)
        return
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        const back = undoPoint(pathDraft)
        if (back === null) stopDraft()
        else updateDraft(back)
        return
      }
      // A digit opens the length field at the chip with the digit already in it.
      if (/^[0-9.]$/.test(event.key) && draftEnd(pathDraft) !== null) {
        event.preventDefault()
        setTypedLength(event.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  })

  const applyDraft = (): void => {
    if (draft === null || draft.proposal.state !== 'valid') return
    commit(draft.proposal.footprint)
  }

  const convert = (): void => {
    setConvertOpen(false)
    commit(footprintAsPath(shown))
  }

  const inspector = layout !== 'editor'

  return (
    <div className="bb-shape-editor" data-testid="shape-editor" data-layout={layout}>
      {!inspector && (
        <div className="bb-shape-toolbar" data-testid="shape-toolbar">
          <div className="bb-workspace-toolbar-group">
            <ToolbarMenu label="Shapes" testId="shapes-menu" disabled={isCabinet}>
              <ShapesGallery
                current={shown.kind === 'preset' ? shown.preset.kind : null}
                onPick={(kind: PresetKind) => setPlacing(kind)}
              />
            </ToolbarMenu>
          </div>
          {placing !== null && (
            <p className="bb-shape-placing" data-testid="shape-placing">
              {`Placing ${PRESET_NAMES[placing]} — drag a box, or click for ${num(defaults.size.width)} × ${num(defaults.size.depth)} ${format.unit}`}
              <button
                type="button"
                data-testid="shape-placing-cancel"
                className="bb-workspace-secondary-button"
                onClick={stopPlacing}
              >
                Cancel
              </button>
            </p>
          )}
          {/* One fixed-height row (#59 §1, the `A-custom` regression): the three draw tools and
              the Snaps panel sit beside the Shapes menu rather than under it, so arming a tool
              cannot reflow the toolbar into the three rows the prototype had. */}
          <div className="bb-workspace-toolbar-group bb-shape-draw-tools" data-testid="shape-draw-tools">
            {DRAW_TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                data-testid={tool.testId}
                className="bb-workspace-tool-button"
                aria-pressed={drawTool === tool.id ? 'true' : 'false'}
                disabled={isCabinet}
                onClick={() => {
                  stopPlacing()
                  if (drawTool === tool.id) stopDraft()
                  else {
                    // The tool can be switched mid-draft; each new segment uses the active tool.
                    setDrawTool(tool.id)
                    if (pathDraft !== null) setPathDraft(withTool(pathDraft, tool.id))
                  }
                }}
              >
                <svg className="bb-shape-tool-icon" viewBox="0 0 20 20" aria-hidden="true">
                  <path d={tool.icon} />
                </svg>
                {tool.label}
              </button>
            ))}
          </div>
          <div className="bb-workspace-toolbar-group" data-testid="toolbar-group-snaps">
            <SnapsMenu />
          </div>
        </div>
      )}

      <div className="bb-shape-body">
        <div className="bb-shape-rail" data-testid="shape-rail">
          {isCabinet && (
            <p className="bb-shape-rail-note" data-testid="shape-editor-note">{CABINET_SHAPE_NOTE}</p>
          )}
          <div className="bb-shape-tabs" role="tablist" aria-label="Item Footprint">
            {TABS.map((each) => (
              <button
                key={each.id}
                type="button"
                role="tab"
                id={`shape-tab-${each.id}`}
                aria-controls="shape-panel"
                aria-selected={tab === each.id ? 'true' : 'false'}
                data-testid={`shape-tab-${each.id}`}
                data-active={tab === each.id ? 'true' : 'false'}
                className="bb-shape-tab-button"
                onClick={() => workspaceStore.getState().setShapeTab(each.id)}
              >
                {each.label}
              </button>
            ))}
          </div>

          <div className="bb-shape-panel" id="shape-panel" role="tabpanel" aria-labelledby={`shape-tab-${tab}`}>
            {tab === 'shape' && (
              <ShapeTab
                footprint={shown}
                format={format}
                invalidField={field}
                invalidMessage={field === null ? null : message}
                readOnly={isCabinet || readOnly}
                onGesture={gesture}
                onDiscard={dropDraft}
                onConvert={() => setConvertOpen(true)}
              />
            )}
            {tab === 'edges' && <EdgesTab path={designOutline(design)} format={format} />}
            {tab === 'measurements' && (
              <MeasurementsTab footprint={shown} format={format} boundsLabel="Bounds" />
            )}
          </div>
        </div>

        {!inspector && (
          <div className="bb-shape-canvas-host" data-testid="shape-canvas-host">
            <FootprintCanvas
              // While a draft is open the committed shape is drawn plain and the draft is drawn on
              // top of it: the proposal the draft holds is the *closed* loop, and drawing that
              // would put a closing Edge on screen that the person has not drawn yet.
              footprint={pathDraft === null ? shown : committed}
              ghost={pathDraft === null ? ghost : null}
              marker={marker}
              origin={design.kind === 'cabinet' ? { x: 0, y: 0 } : design.origin}
              invalid={invalid}
              placing={placing}
              drag={drag}
              frameShape={committed}
              draft={draftView}
              handles={pathDraft === null && committedPath !== null && !readOnly ? vertices(committedPath) : []}
              selectedVertex={shapeSelection === null || !('vertex' in shapeSelection) ? null : shapeSelection.vertex}
              lengthField={lengthField}
              chipLabels={drag === null
                ? { width: '', depth: '' }
                : { width: `W ${num(drag.maxX - drag.minX)}`, depth: `D ${num(drag.maxY - drag.minY)}` }}
              onDrag={setDrag}
              onGesture={place}
              onScale={setScale}
              onDraftPoint={draftPoint}
              onDraftMove={draftMove}
              onHandleDrag={handleDrag}
            />
            {(pathDraft !== null || (draft !== null && draft.proposal.state !== 'idle')) && (
              <div
                className="bb-shape-draft-bar"
                data-invalid={invalid ? 'true' : 'false'}
                data-testid="shape-draft-bar"
                role="status"
              >
                {pathDraft === null ? (
                  <>
                    {/* One message only: a field edit shows its sentence under the field, so the
                        bar stays quiet for it and speaks only for a gesture that has no field. */}
                    {invalid
                      ? field === null && <span data-testid="shape-problem-message">{message}</span>
                      : <span data-testid="shape-draft-affects">Affects {target?.placementCount ?? 0} placements</span>}
                    <button
                      type="button"
                      data-testid="shape-apply"
                      className="bb-workspace-primary-button"
                      disabled={draft === null || !canCommit(draft)}
                      onClick={applyDraft}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      data-testid="shape-cancel"
                      className="bb-workspace-secondary-button"
                      onClick={dropDraft}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {/* While the draft is invalid the hint gives way to the one sentence, which is
                        the only thing that explains why `Close` has stopped working (#59 §1). */}
                    {invalid ? (
                      <span className="bb-shape-problem" data-testid="shape-problem-message">{message}</span>
                    ) : (
                      <span className="bb-shape-hint" data-testid="shape-draft-hint">{draftHint()}</span>
                    )}
                    <button
                      type="button"
                      data-testid="shape-undo-point"
                      className="bb-workspace-secondary-button"
                      onClick={() => {
                        const back = undoPoint(pathDraft)
                        if (back === null) stopDraft()
                        else updateDraft(back)
                      }}
                    >
                      Undo point
                    </button>
                    <button
                      type="button"
                      data-testid="shape-close-path"
                      className="bb-workspace-primary-button"
                      disabled={!closeLive}
                      onClick={() => closePath('line')}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      data-testid="shape-draft-cancel"
                      className="bb-workspace-secondary-button"
                      onClick={stopDraft}
                    >
                      Cancel (Esc)
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {convertOpen && shown.kind === 'preset' && (
        <ConvertDialog
          designName={design.name}
          preset={shown.preset}
          onConvert={convert}
          onCancel={() => setConvertOpen(false)}
        />
      )}
    </div>
  )
}
