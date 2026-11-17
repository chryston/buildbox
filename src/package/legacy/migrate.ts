/**
 * The two legacy upgrades, moved out of `store.ts` and `utils/workspaceIO.ts` unchanged
 * (#40 §1) so the frozen reader owns every path into the old shapes.
 *
 * `newId` is injected — the store passes `() => nanoid(8)`, the import path passes
 * `() => crypto.randomUUID()`, exactly as before — which is what lets the tests assert
 * the migrated bytes.
 *
 * Both copy before they change anything, so a caller's value is never mutated.
 */
import { isAbsent, isRecord } from './guards'

/**
 * The zustand persist migration, v0 → v1 → v2 → v3, verbatim from `store.ts`.
 *
 * Two deliberate differences from the version that lived in the store: it copies first,
 * and it never throws on a value the store could never have written — `checkLegacyStore`
 * runs it on untrusted input, and the validator, not the migrator, is what reports a
 * malformed state. Both callers hand in `JSON.parse` output, which `structuredClone`
 * always takes.
 */
export function migrateLegacyState(persisted: unknown, fromVersion: number, newId: () => string): unknown {
  if (!isRecord(persisted)) return persisted
  const origVersion = fromVersion
  let state = structuredClone(persisted)

  // Apply structural project migrations first (v0→v1, v1→v2), then add floorPlan after
  // any reassignment of `state` above.
  if (origVersion === 0) {
    const projects = Array.isArray(state.projects) ? state.projects : []
    state = {
      projects: projects.map((project) => {
        if (!isRecord(project)) return project
        return {
          id: project.id,
          name: project.name,
          units: [{
            type: 'cabinet' as const,
            id: newId(),
            label: 'Unit 1',
            settings: project.globalSettings,
            root: project.root,
            x: 0,
            y: 0,
          }],
        }
      }),
      activeProjectId: state.activeProjectId,
    }
    // fall through to apply v1→v2 rename
  }
  if (origVersion <= 1) {
    const projects = Array.isArray(state.projects) ? state.projects : []
    for (const project of projects) {
      if (!isRecord(project)) continue
      const units = Array.isArray(project.units) ? project.units : []
      for (const unit of units) {
        if (!isRecord(unit) || !isRecord(unit.settings)) continue
        if ('defaultMaterial' in unit.settings) {
          unit.settings.material = unit.settings.defaultMaterial
          delete unit.settings.defaultMaterial
        }
      }
    }
  }
  // Add floorPlan shape after structural migrations so it is not lost by any
  // reassignment of `state` above.
  if (origVersion <= 2) {
    if (isAbsent(state.floorPlan)) {
      state.floorPlan = {
        image: null,
        pixelsPerMm: null,
        objects: [],
        annotations: [],
        customTemplates: [],
      }
    }
    if (isRecord(state.floorPlan) && isAbsent(state.floorPlan.customTemplates)) {
      state.floorPlan.customTemplates = []
    }
  }
  return state
}

/**
 * The v0 Design → `units[]` upgrade from `importWorkspace`, verbatim. A Design that
 * already has `units`, or has neither of the two old fields, is returned as it came in:
 * the validator reports what is wrong with it.
 *
 * The old `globalSettings` key is kept, not renamed — that is what today's import does,
 * and `validate.ts` accepts either material key because of it.
 */
export function upgradeLegacyDesign(raw: unknown, newId: () => string): unknown {
  if (!isRecord(raw)) return raw
  // v0: has root/globalSettings at top level, no units array
  if (!isAbsent(raw.units) || isAbsent(raw.root) || isAbsent(raw.globalSettings)) return raw
  return {
    ...raw,
    units: [{
      type: 'cabinet' as const,
      id: newId(),
      label: 'Unit 1',
      x: 0,
      y: 0,
      settings: upgradeLegacySettings(raw.globalSettings),
      root: raw.root,
    }],
  }
}

/**
 * `defaultMaterial` → `material`, the same rename the v1→v2 state migration applies.
 * Without it an imported v0 design reaches the canvas with `settings.material` undefined
 * and `MATERIALS[settings.material].fill` throws.
 */
function upgradeLegacySettings(raw: unknown): unknown {
  if (!isRecord(raw) || !('defaultMaterial' in raw)) return raw
  const settings: Record<string, unknown> = { ...raw }
  settings.material = settings.defaultMaterial
  delete settings.defaultMaterial
  return settings
}
