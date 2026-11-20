/**
 * The scope of a list, in the two forms it is needed in: as a default and as a sentence (#62 §7).
 *
 * The dialog's summary is generated from the scope the user has actually selected — never from
 * what the export happened to write — because a summary that describes the last file instead of
 * the next one is how an export comes as a surprise. It is a pure function of the scope and the
 * Project, so the dialog can render it on every keystroke and a test can assert the exact words.
 *
 * The words themselves are in `strings.ts`; this file only decides which of them apply.
 */
import type { Project } from '../domain'
import type { QuantityScope, RenovationState } from '../derive'
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
 * The scope as one line, in the four controls' own order: Floors · Design Option · Renovation
 * States · Drawing Layers.
 *
 * `All Floors · Existing only · Existing · all layers incl. Unlayered`, or `Ground Floor · …` once
 * a Floor is picked out of a multi-Floor Project. A scope that names every Floor says so rather
 * than listing them, because the sentence is there to catch someone about to export more than
 * they meant.
 */
export function describeScope(scope: QuantityScope, project: Project): string {
  const names = scope.floorIds
    .map((floorId) => project.floors.find((floor) => floor.id === floorId)?.name)
    .filter((name): name is string => name !== undefined)
  const floors =
    project.floors.length > 0 && names.length >= project.floors.length
      ? SCOPE.allFloors
      : names.join(SCOPE.join)
  const options =
    scope.designOptionIds === 'existing-only'
      ? SCOPE.existingOnly
      : // A Design Option's name is not in the domain schema yet (#32), so an option in scope is
        // named by the only thing there is to name it with.
        scope.designOptionIds.join(SCOPE.join)
  const states = scope.renovationStates.map((state) => SCOPE.states[state]).join(SCOPE.join)
  const layers =
    scope.drawingLayers === 'all'
      ? SCOPE.allLayers
      : `${SCOPE.selectedLayers}${scope.drawingLayers.includeUnlayered ? SCOPE.inclUnlayered : ''}`
  return [floors, options, states, layers].join(SCOPE.separator)
}
