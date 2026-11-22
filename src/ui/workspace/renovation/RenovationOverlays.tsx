/**
 * The renovation dialogs the workspace can be asked to show (#69 §9, §13; #70 §7a, §7b; #71 §5).
 *
 * One mount, every dialog, all dark: `FloorWorkspace` renders this only from a flagged branch, so a
 * flag-off build carries neither the components nor a word of their copy.
 *
 * The rule the whole file exists to hold: a dialog never decides what an edit costs, and never writes
 * to the Project by itself. Each review is read from `services.intent.preview` — the same answer
 * `applyIntent` consults when it writes — and confirming sends the reviewed ids back, so a model that
 * moved after the question was asked makes the write refuse with its own sentence rather than act on
 * an answer nobody agreed to. The refusal is shown where the press happened, because that is the only
 * place it can be read as an answer.
 *
 * §7a's forced choice is the same rule one step earlier: the edit it is asking about was *refused*,
 * so nothing has been committed, and the only thing the dialog can do with the pending Intent is put
 * it inside one of the two commands that are allowed to touch the baseline.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CorrectionReview, DeleteLayerReview, DemolitionReview, Intent, MoveToOptionReview, RestoreReview } from '../../../edit'
import { designOptionsOf } from '../../../domain'
import type { DispatchResult } from '../../../session'
import { useWorkspaceProject, useWorkspaceRoot } from '../WorkspaceRoot'
import { useWorkspace } from '../workspaceStore'
import { CorrectExistingDialog } from './CorrectExistingDialog'
import { DeleteLayerDialog } from './DeleteLayerDialog'
import { DemolishWallDialog } from './DemolishWallDialog'
import { displayLabel } from './displayTheme'
import { ForcedChoiceDialog } from './ForcedChoiceDialog'
import { MoveToOptionDialog } from './MoveToOptionDialog'
import { RestoreDialog } from './RestoreDialog'
import { entityFields, replaceEditOf, successorOf } from './pendingEdit'
import { RENOVATION_STRINGS } from '../../strings/renovation'

/** The one sentence a refusal says: the first problem it came with, or the code that named it. */
function refusalOf(result: DispatchResult): string {
  if (result.ok) return ''
  return result.problems[0]?.message ?? result.code
}

/** The Intents that move a record rather than resize or rename it. */
const MOVEMENT = /\.(drag|move|offset|split)|rotatePlacement|movePlacement/

/** The Intents that bring a record the Project did not have. */
const ARRIVALS = /\.create$|^wall\.createChain$|^plan\.(addObject|addTemplate|placeDesign|copyToFloor)$|^room\.placeShelter$/

/**
 * §7b's `<change>` word, from what the pending Intent does. The four words are the issue's; anything
 * that is neither a removal, an arrival nor a move is a change of some kind, and says so.
 */
function changeWordOf(intentType: string): string {
  if (intentType.endsWith('.delete') || intentType === 'plan.removeObject' || intentType === 'plan.clear')
    return RENOVATION_STRINGS.changeRemoved
  if (ARRIVALS.test(intentType)) return RENOVATION_STRINGS.changeAppear
  if (MOVEMENT.test(intentType)) return RENOVATION_STRINGS.changeMove
  return RENOVATION_STRINGS.changeChange
}

export function RenovationOverlays(): ReactNode {
  const { session, services } = useWorkspaceRoot()
  const project = useWorkspaceProject(session)
  const dialog = useWorkspace((state) => state.renovationDialog)
  const close = useWorkspace((state) => state.closeRenovationDialog)
  const askCorrection = useWorkspace((state) => state.openCorrectExistingDialog)
  const selectWall = useWorkspace((state) => state.selectWall)
  const selectOpening = useWorkspace((state) => state.selectOpening)
  const selectRoom = useWorkspace((state) => state.selectRoom)
  const selectItem = useWorkspace((state) => state.select)
  const [targetOptionId, setTargetOptionId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  /** A Replace that landed: the successor it wrote takes the inspector as soon as the Project does. */
  const [awaitingSuccessor, setAwaitingSuccessor] = useState<{ predecessorId: string; optionId: string } | null>(
    null,
  )

  /** The open dialog's review and the Options to move to, both read from the live Project. */
  const shown = useMemo(() => {
    if (dialog === null) return null
    const options = designOptionsOf(project)
    if (dialog.kind === 'demolish')
      return {
        review: services.intent.preview(
          project,
          services.intent.build('renovation.demolish', {
            entityId: dialog.entityId,
            target: { designOptionId: dialog.designOptionId },
          }),
        ).review,
        options,
      }
    if (dialog.kind === 'move')
      return {
        review: services.intent.preview(
          project,
          services.intent.build('renovation.moveToDesignOption', {
            entityIds: [...dialog.entityIds],
            targetOptionId: targetOptionId ?? options[0]?.id ?? '',
          }),
        ).review,
        options,
      }
    // §7b asks the correction's own question: the pending edit wrapped, so the rows are the effects
    // the write will have. §7a needs no review — it is asking which question to ask.
    if (dialog.kind === 'correct-existing')
      return {
        review: services.intent.preview(
          project,
          services.intent.build('renovation.correctExistingModel', { inner: dialog.intent }),
        ).review,
        options,
      }
    // §7d asks the restoration's own question: which of the Option's successors stand on the record
    // that is about to be taken away.
    if (dialog.kind === 'restore')
      return {
        review: services.intent.preview(
          project,
          services.intent.build('renovation.restore', {
            entityId: dialog.entityId,
            target: { designOptionId: dialog.designOptionId },
          }),
        ).review,
        options,
      }
    // #71 §5 asks the deletion's own question: what is on the layer, and how many views have an
    // opinion of it that the delete drops. The view the row stands in answers one further question —
    // whether Unlayered is drawn here — and changes nothing about the write.
    if (dialog.kind === 'delete-layer')
      return {
        review: services.intent.preview(
          project,
          services.intent.build('layer.delete', { layerId: dialog.layerId, viewId: dialog.viewId }),
        ).review,
        options,
      }
    return { review: null, options }
  }, [dialog, targetOptionId, project, services])

  useEffect(() => {
    if (awaitingSuccessor === null) return
    const proposed = designOptionsOf(project).find((option) => option.id === awaitingSuccessor.optionId)?.proposed
    const hit = proposed === undefined ? null : successorOf(proposed, awaitingSuccessor.predecessorId)
    if (hit !== null) {
      if (hit.kind === 'wall') selectWall(hit.id)
      else if (hit.kind === 'opening') selectOpening(hit.id)
      else if (hit.kind === 'room') selectRoom(hit.id)
      else selectItem(hit.id)
    }
    setAwaitingSuccessor(null)
  }, [awaitingSuccessor, project, selectWall, selectOpening, selectRoom, selectItem])

  const dismiss = (): void => {
    setProblem(null)
    close()
  }

  if (shown === null || dialog === null) return null

  if (dialog.kind === 'demolish' && shown.review?.kind === 'demolish') {
    const review: DemolitionReview = shown.review
    const confirm = (): void => {
      setProblem(null)
      const result = session.dispatch(
        services.intent.build('renovation.demolish', {
          entityId: review.entityId,
          // The ids the review listed, in the order it listed them: an Opening added since then
          // makes this stale, and the Intent is refused rather than guessing.
          dependants: review.willDemolish.map((dependency) => dependency.id),
          target: { designOptionId: dialog.designOptionId },
        }),
      )
      if (!result.ok) {
        setProblem(refusalOf(result))
        return
      }
      close()
    }
    return (
      <DemolishWallDialog review={review} problem={problem ?? undefined} onConfirm={confirm} onCancel={dismiss} />
    )
  }

  if (dialog.kind === 'move' && shown.review?.kind === 'move-to-design-option') {
    const review: MoveToOptionReview = shown.review
    const confirm = (): void => {
      setProblem(null)
      const result = session.dispatch(
        services.intent.build('renovation.moveToDesignOption', {
          entityIds: [...dialog.entityIds],
          targetOptionId: review.targetOptionId,
        }),
      )
      if (!result.ok) {
        setProblem(refusalOf(result))
        return
      }
      close()
    }
    return (
      <MoveToOptionDialog
        review={review}
        options={shown.options}
        problem={problem ?? undefined}
        onTargetChange={(optionId) => {
          setProblem(null)
          setTargetOptionId(optionId)
        }}
        onConfirm={confirm}
        onCancel={dismiss}
      />
    )
  }

  if (dialog.kind === 'forced-choice') {
    const subject = entityFields(project, dialog.entityId)
    const option = shown.options.find((each) => each.id === dialog.optionId)
    // The entity or the Option has gone away since the edit was refused: there is no choice left to
    // offer, and nothing was written, so the dialog simply does not ask.
    if (subject === null || option === undefined) return null
    const replace = (): void => {
      setProblem(null)
      // The geometry the person was dragging toward, as the field values a successor carries: `edit`
      // is what the refused Intent would have written to the record, with identity left out (#69 §7).
      const evaluated = services.intent.evaluate(project, dialog.intent)
      const moved = evaluated === null ? null : entityFields(evaluated, dialog.entityId)
      const edit = moved === null ? {} : replaceEditOf(subject, moved)
      const result = session.dispatch(
        services.intent.build('renovation.replace', {
          entityId: dialog.entityId,
          edit,
          target: { designOptionId: option.id },
        }),
      )
      if (!result.ok) {
        setProblem(refusalOf(result))
        return
      }
      setAwaitingSuccessor({ predecessorId: dialog.entityId, optionId: option.id })
      close()
    }
    const correct = (): void => {
      setProblem(null)
      askCorrection(dialog.intent, dialog.entityId)
    }
    return (
      <ForcedChoiceDialog
        entityRef={subject.ref}
        display={displayLabel(dialog.display)}
        optionName={option.name}
        onReplace={replace}
        onCorrect={correct}
        onCancel={dismiss}
      />
    )
  }

  if (dialog.kind === 'correct-existing' && shown.review?.kind === 'correct-existing-model') {
    const review: CorrectionReview = shown.review
    const inner: Intent = dialog.intent
    const confirm = (): void => {
      setProblem(null)
      const result = session.dispatch(
        // The label the review names — `Correct Existing Model: W-2` — so the undo tooltip says which
        // baseline entity moved, not just that something did (#70 §7b).
        services.intent.build('renovation.correctExistingModel', { inner }, review.message),
      )
      if (!result.ok) {
        setProblem(refusalOf(result))
        return
      }
      close()
    }
    return (
      <CorrectExistingDialog
        review={review}
        change={changeWordOf(inner.type)}
        problem={problem ?? undefined}
        onConfirm={confirm}
        onCancel={dismiss}
      />
    )
  }

  if (dialog.kind === 'restore' && shown.review?.kind === 'restore') {
    const review: RestoreReview = shown.review
    const option = shown.options.find((each) => each.id === dialog.designOptionId)
    // The Option has gone away since the press: there is no record left to take out of it, and
    // nothing was written, so the dialog does not ask.
    if (option === undefined) return null
    const confirm = (): void => {
      setProblem(null)
      const result = session.dispatch(
        services.intent.build('renovation.restore', {
          entityId: review.entityId,
          target: { designOptionId: dialog.designOptionId },
        }),
      )
      if (!result.ok) {
        setProblem(refusalOf(result))
        return
      }
      close()
    }
    return (
      <RestoreDialog
        review={review}
        optionName={option.name}
        problem={problem ?? undefined}
        onConfirm={confirm}
        onCancel={dismiss}
      />
    )
  }

  // #71 §5. The layer went away while the question was open — deleted from another view of the same
  // Project, or undone out from under the dialog — then there is nothing to ask about, and the
  // write would be refused anyway.
  if (dialog.kind === 'delete-layer' && shown.review?.kind === 'delete-layer') {
    const review: DeleteLayerReview = shown.review
    const confirm = (): void => {
      setProblem(null)
      const result = session.dispatch(
        services.intent.build('layer.delete', { layerId: review.layerId, viewId: dialog.viewId }, RENOVATION_STRINGS.layerDeleteLabel(review.layerName)),
      )
      if (!result.ok) {
        setProblem(refusalOf(result))
        return
      }
      close()
    }
    return <DeleteLayerDialog review={review} problem={problem ?? undefined} onConfirm={confirm} onCancel={dismiss} />
  }

  // Nothing to review: the entity the dialog was asked about is gone, or the Project has no
  // Option to move to. Either way there is no question to ask, so none is asked.
  return null
}
