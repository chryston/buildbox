/**
 * The scope of a list, in the three forms it is needed in: as a default, as a sentence and as the
 * count of what the view was hiding (#62 §7, #73 §2).
 *
 * The dialog's summary is generated from the scope the user has actually selected — never from
 * what the export happened to write — because a summary that describes the last file instead of
 * the next one is how an export comes as a surprise. It is a pure function of the scope and the
 * Project, so the dialog can render it on every keystroke and a test can assert the exact words.
 *
 * The words themselves are in `strings.ts`; this file only decides which of them apply.
 */
import type { PlanView, Project } from '../domain'
import { designOptionsOf, drawingLayerById } from '../domain'
import { RENOVATION_STATES, type QuantityScope, type RenovationState } from '../derive'
import { FF_RENOVATION } from '../lib'
import { viewDesignOptionId } from '../domain'
import { SCOPE } from './strings'

/**
 * Which Renovation States the Cut List checkbox starts ticked at (export contract §9).
 *
 * A Cut List is what someone builds from, and what someone builds from is what is being built:
 * `proposed`. The Item List counts everything, so it starts with all three states and does not
 * ask this question. With no Design Option in scope there is nothing proposed to build yet, so
 * the Cut List starts on the Existing Model instead — which is also the only state v1.0 content
 * can hold, and so the only answer a S6 Project can be given.
 */
export function defaultCutListStates(scope: Pick<QuantityScope, 'designOptionIds'>): RenovationState[] {
  const options = scope.designOptionIds
  return options === 'existing-only' || options.length === 0 ? ['existing'] : ['proposed']
}

/**
 * The Lists scope the dialog opens with for one view (#73 §2).
 *
 * Every Floor, every Renovation State and every Drawing Layer: the widest scope is the one that
 * cannot silently leave something out, and a person narrows it deliberately rather than discovering
 * it was narrow. The Design Option is the view's own, because someone who has been working in
 * Option A and asks for a list means Option A — and a view with no Option, or a build with no
 * Design Options at all, is the Existing Model.
 */
export function defaultListsScope(project: Project, view: PlanView | null): QuantityScope {
  const optionId = FF_RENOVATION && view !== null ? viewDesignOptionId(view) : null
  return {
    floorIds: project.floors.map((floor) => floor.id),
    designOptionIds: optionId === null ? 'existing-only' : [optionId],
    renovationStates: [...RENOVATION_STATES],
    drawingLayers: 'all',
  }
}

/**
 * The scope as one line, in the four controls' own order: Floors · Design Option · Renovation
 * States · Drawing Layers.
 *
 * `Ground Floor · Option B · Existing, Demolition, Proposed · all layers incl. Unlayered`, or
 * `All Floors · Existing Model only · Existing · Structure, Furniture` once the scope is narrowed.
 * A scope that names every Floor says so rather than listing them, because the sentence is there to
 * catch someone about to export more than they meant; a Layers control that left layers out names
 * the ones it kept, `Unlayered` among them when it kept that, because "selected layers" is not a
 * fact about the file.
 */
export function describeScope(scope: QuantityScope, project: Project): string {
  const names = scope.floorIds
    .map((floorId) => project.floors.find((floor) => floor.id === floorId)?.name)
    .filter((name): name is string => name !== undefined)
  const floors =
    project.floors.length > 0 && names.length >= project.floors.length
      ? SCOPE.allFloors
      : names.join(SCOPE.join)
  const options = scope.designOptionIds === 'existing-only'
    ? SCOPE.existingModelOnly
    : scope.designOptionIds
      .map((optionId) => designOptionsOf(project).find((option) => option.id === optionId)?.name ?? optionId)
      .join(SCOPE.join) +
      // More than one Option is a comparison, and the sentence has to say so: every Existing row
      // appears once per Option, which is the one way a comparison can be misread as double-counting.
      (scope.designOptionIds.length > 1 ? SCOPE.compared : '')
  const states = scope.renovationStates.map((state) => SCOPE.states[state]).join(SCOPE.join)
  const layers = scope.drawingLayers === 'all'
    ? SCOPE.allLayers
    : [
      ...scope.drawingLayers.layerIds.map((layerId) => drawingLayerById(project, layerId)?.name ?? layerId),
      ...(scope.drawingLayers.includeUnlayered ? [SCOPE.unlayered] : []),
    ].join(SCOPE.join)
  return [floors, options, states, layers].join(SCOPE.separator)
}
