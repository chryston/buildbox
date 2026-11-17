# One Vite package with ESLint-enforced inward-only module folders

BuildBox is one app: separate published packages would cost more than the boundaries they buy, so the boundaries are enforced inside a single package instead.

1. BuildBox stays one Vite package. Its modules are the folders `lib`, `geometry`, `domain`, `cabinet`, `derive`, `edit`, `drawing`, `package`, `export`, `persistence`, `session`, plus `platform`, `ui` and `app`. Each module has a small public `index.ts`. Dependencies point inward only, following the [#20 §2](https://github.com/chryston/buildbox/issues/20#issuecomment-6911090101) allow-list.
2. `eslint-plugin-boundaries` and `no-restricted-globals` enforce the rules in CI: deep imports, cycles, React or `idb` in pure modules, and DOM globals outside `platform`/`ui`/`app`/the IndexedDB adapter all fail the build; only `app` imports adapters.
3. Modules split into separate packages only when a second consumer exists, such as a separate Worker bundle or a backend.

## Consequences

- Module boundaries are CI facts, not conventions: a wrong-direction import fails the build rather than being reviewed.
- Pure modules stay testable without a browser, which is what makes the later seams cheap.

**Owning resolution:** [#20 target architecture and migration seams](https://github.com/chryston/buildbox/issues/20#issuecomment-6911090101) (§1, §2).
