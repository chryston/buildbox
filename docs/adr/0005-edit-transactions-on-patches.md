# Edit Transactions as Intents on patches with one 200-step per-Project history

Undo has to act on a whole user intent and stay cheap on a Project with Plan Image Blobs, so history stores patches for one Project rather than full snapshots or per-view stacks.

1. One user intent is one Edit Transaction: the UI builds an Intent with pre-allocated IDs; `edit.applyIntent` returns the next Project with patches and inverse patches, or a Rejection; nothing is partially applied.
2. Each Project has one linear in-memory history: shared across views and capped at 200 transactions, with assets referenced by hash; undo and redo commit new forward revisions; every history boundary clears history behind an automatic Recovery Point.
3. Canonical content is undoable: warning acknowledgements (settled in [#20 §15.6](https://github.com/chryston/buildbox/issues/20#issuecomment-6911090101)) and saved per-view settings (settled in [#20 §15.8](https://github.com/chryston/buildbox/issues/20#issuecomment-6911090101)). Selection, viewport and navigation are not undoable. A view's zoom lives in a device-local cache (settled in [#20 §15.7](https://github.com/chryston/buildbox/issues/20#issuecomment-6911090101)).

## Consequences

- Rejections are the only way an Intent fails, so no view can render half of an aborted intent.
- Undo past the 200-step cap is impossible by design; the Recovery Point behind the boundary is the escape hatch.

**Owning resolutions:** [#26 editing transactions and history](https://github.com/chryston/buildbox/issues/26#issuecomment-6513075904), [#20 target architecture and migration seams](https://github.com/chryston/buildbox/issues/20#issuecomment-6911090101) (§4).
