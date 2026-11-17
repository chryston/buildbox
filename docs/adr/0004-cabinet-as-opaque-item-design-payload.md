# Cabinet construction is an opaque Item Design payload

The cabinet editor predates the Project model, and its node tree is meaningful to nothing else; modelling it as first-class domain vocabulary would spread cabinet specifics through every module.

1. A cabinet is an Item Design of `kind: 'cabinet'` whose `construction: {settings, root}` is interpreted only by the `cabinet` module. `layoutEngine`, `treeMutations`, `accessories` and `cutList` move there unchanged.
2. Cabinet node IDs are feature IDs scoped to their Item Design and are addressed as `(itemDesignId, nodeId)`. The legacy `GlobalSettings.unit` (`mm`/`cm`/`in`) stays inside the payload for the cabinet editor only; that conflict is settled in [#20 §15.3](https://github.com/chryston/buildbox/issues/20#issuecomment-6911090101).
3. Legacy cabinet `Design` records become cabinet Item Designs plus Placed Items in the Existing Model of one Project each. No `Design` alias survives the cutover.

## Consequences

- Other modules treat the payload as opaque bytes with a `kind`, so a non-cabinet Item Design needs no cabinet knowledge.
- The cutover is a one-time data migration with no compatibility alias to maintain afterwards.

**Owning resolution:** [#20 target architecture and migration seams](https://github.com/chryston/buildbox/issues/20#issuecomment-6911090101) (§1, §3).
