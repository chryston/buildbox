/**
 * The renovation dialogs the workspace can be asked to show (#69 §9, §13).
 *
 * One mount, two dialogs, both dark: `FloorWorkspace` renders this only from a flagged branch, so
 * a flag-off build carries neither the components nor a word of their copy.
 *
 * The rule the whole file exists to hold: a dialog never decides what an edit costs. Each review
 * is read from `services.intent.preview` — the same answer `applyIntent` consults when it writes —
 * and confirming sends the reviewed ids back, so a model that moved after the question was asked
 * makes the write refuse with its own sentence rather than act on an answer nobody agreed to. The
 * refusal is shown where the press happened, because that is the only place it can be read as an
 * answer.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { DemolitionReview, MoveToOptionReview } from '../../../edit'
import { designOptionsOf } from '../../../domain'
import type { DispatchResult } from '../../../session'
import { useWorkspaceProject, useWorkspaceRoot } from '../WorkspaceRoot'
import { useWorkspace } from '../workspaceStore'
import { DemolishWallDialog } from './DemolishWallDialog'
import { MoveToOptionDialog } from './MoveToOptionDialog'

/** The one sentence a refusal says: the first problem it came with, or the code that named it. */
function refusalOf(result: DispatchResult): string {
  if (result.ok) return ''
  return result.problems[0]?.message ?? result.code
}

export function RenovationOverlays(): ReactNode {
  const { session, services } = useWorkspaceRoot()
  const project = useWorkspaceProject(session)
  const dialog = useWorkspace((state) => state.renovationDialog)
  const close = useWorkspace((state) => state.closeRenovationDialog)
  const [targetOptionId, setTargetOptionId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  /** The open dialog's review and the Options to move to, both read from the live Project. */
  const shown = useMemo(() => {
    if (dialog === null) return null
    const options = designOptionsOf(project)
    const intent = dialog.kind === 'demolish'
      ? services.intent.build('renovation.demolish', {
        entityId: dialog.entityId,
        target: { designOptionId: dialog.designOptionId },
      })
      : services.intent.build('renovation.moveToDesignOption', {
        entityIds: [...dialog.entityIds],
        targetOptionId: targetOptionId ?? options[0]?.id ?? '',
      })
    return { review: services.intent.preview(project, intent).review, options }
  }, [dialog, targetOptionId, project, services])

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

  // Nothing to review: the entity the dialog was asked about is gone, or the Project has no
  // Option to move to. Either way there is no question to ask, so none is asked.
  return null
}
