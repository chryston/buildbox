/**
 * The one thing that stops a Drawing export from being made (#73 §3, export contract §11).
 *
 * A Demolition, Proposed or Combined Display is a statement about a Design Option: it draws what an
 * Option demolishes or proposes. With no Option active there is nothing to draw and no honest sheet
 * to draw — the alternative is a page that looks like a renovation drawing and shows only the
 * Existing Model, which is worse than refusing. A Lists export from the same view is fine and stays
 * enabled, because its scope is chosen explicitly and never inherited from the view.
 *
 * Only the predicate is here; the sentence the dialog shows is `ui/strings`' copy, in the same table
 * as the banner the workspace shows for the same missing Option.
 */
import type { SavedView } from '../domain'
import { viewDesignOptionId, viewRenovationDisplay } from '../domain'


/**
 * Whether this view's Display cannot be exported because it has no Design Option to display.
 *
 * An Elevation View is a saved view with the same two settings, so it is blocked by exactly the same
 * rule: a sheet that showed the Existing Model while the view claimed to show a Design Option would
 * be a different drawing from the one on the screen.
 */
export function needsActiveOption(view: SavedView): boolean {
  return viewDesignOptionId(view) === null && viewRenovationDisplay(view) !== 'existing'
}
