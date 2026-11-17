# Renovation States are derived; Drawing Layers are orthogonal presentation

Tagging entities with a renovation phase duplicates information the Project already holds and drifts the moment the Existing Model is corrected.

1. Existing, Demolition and Proposed are derived from Existing Model ownership plus the active Design Option's deltas. Users never tag entities with a phase, and no arbitrary phases are modelled.
2. A replacement creates a successor with a new ID and leaves the baseline untouched. Every saved view uses exactly one of four Renovation Displays: Existing, Demolition, Proposed or Combined.
3. Drawing Layers are fully mutable, single-membership presentation groups with per-view visibility, selectability and editability. Neither a layer nor a phase substitutes for a Design Option.

## Consequences

- Renovation State is computed in `derive`, never stored, so it cannot disagree with the Existing Model.
- Presentation and renovation alternatives stay independent: a saved view changes what you see, not which alternative you are in.

**Owning resolution:** [#18 resolution on Renovation States and Drawing Layers](https://github.com/chryston/buildbox/issues/18#issuecomment-6076049149).
