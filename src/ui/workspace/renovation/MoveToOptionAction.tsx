/**
 * The inspector's `Move to a Design Option…` action (#69 §13, criterion 8).
 *
 * It appears on an Existing entity only while the Project has at least one Option, which is the
 * same condition that makes an unwrapped Existing edit a correction rather than an edit: with no
 * Option there is nothing to move something *to*, and a command that can only be refused is an
 * invitation to be told no.
 *
 * One entity is offered because one entity is what an inspector inspects. The Intent takes a list,
 * so a multi-select gesture #70 draws can hand this the same ids.
 */
import type { ReactNode } from 'react'
import { designOptionsOf } from '../../../domain'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import { useWorkspaceProject, useWorkspaceRoot } from '../WorkspaceRoot'
import { useWorkspace } from '../workspaceStore'

export function MoveToOptionAction(props: { entityId: string }): ReactNode {
  const { session } = useWorkspaceRoot()
  const project = useWorkspaceProject(session)
  const open = useWorkspace((state) => state.openMoveToOptionDialog)
  if (designOptionsOf(project).length === 0) return null
  return (
    <button
      type="button"
      data-testid="move-to-option-action"
      className="bb-workspace-tool-button"
      onClick={() => open([props.entityId])}
    >
      {RENOVATION_STRINGS.moveToOption}
    </button>
  )
}
