/**
 * The anchored-endpoint half of the deletion rule (#81 §8.1).
 *
 * The same promise the Comment guard makes (#80 §14), one record type wider: no Annotation may
 * outlive the entity or feature its endpoint is anchored to. The delete is refused with the
 * references named, and nothing changes — the user moves or deletes the Annotation first, and
 * #82's retarget flow is what will one day soften that.
 *
 * It runs on every Edit Transaction, beside {@link guardAnchoredComments}, and shares that guard's
 * machinery: the same anchor resolution, the same way of reading the target's name out of the
 * Project as it was before the edit.
 */
import type { Annotation, Project } from '../domain'
import { compareAnnotationReferences } from '../domain'
import { anchorResolves, targetLabel } from './anchoredComments'
import { refuse } from './handlers/support'

/**
 * Refuse an edit that leaves an Annotation anchored to nothing (#81 §8.1).
 *
 * Only Annotations that were already in the Project are judged: a fresh one is its own handler's
 * business, and a Project that arrived broken is the validator's. A free endpoint is nobody's
 * dependant — it names no entity, so no delete can strand it.
 */
export function guardAnchoredAnnotations(before: Project, after: Project): void {
  if (before.annotations.length === 0) return
  const beforeIds = new Set(before.annotations.map((annotation) => annotation.id))
  const groups = new Map<string, Annotation[]>()
  for (const annotation of after.annotations) {
    if (!beforeIds.has(annotation.id)) continue
    if (annotation.endpoint === undefined || !('anchor' in annotation.endpoint)) continue
    if (anchorResolves(after, annotation.endpoint.anchor)) continue
    // Read the name out of the Project the edit started from: the target is exactly the thing that
    // has gone missing, so the only place it still has one is the record as it was.
    const label = targetLabel(before, annotation.endpoint.anchor)
    const group = groups.get(label)
    if (group === undefined) groups.set(label, [annotation])
    else group.push(annotation)
  }
  if (groups.size === 0) return

  // One target per refusal, the first in the Project's own order — the same rule the Comment guard
  // follows, for the same reason: five refusals would read as a wall of text.
  for (const [label, list] of groups) {
    const references = list.map((annotation) => annotation.reference).sort(compareAnnotationReferences)
    refuse(
      'has-dependants',
      `annotations[${list[0]!.id}]`,
      `${list.length} ${list.length === 1 ? 'Annotation is' : 'Annotations are'} anchored to ${label}: ${references.join(', ')}. Delete or move them first.`,
    )
  }
}
