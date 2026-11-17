/**
 * The emergency download (#48 criterion 11, #14): the one artefact a user keeps when storage
 * has failed, so it has to be re-importable, and it has to carry exactly the bytes the store
 * never took.
 *
 * The Asset Repository is written in the same transaction as the Project that references it
 * (#45), so "the store has never received this Asset" means "no commit carrying it has
 * succeeded". The session therefore holds the bytes it was handed until one lands, and hands
 * them to the download while a failure means they exist nowhere else.
 */
import { describe, expect, it } from 'vitest'
import type { Intent } from '../edit'
import { validateProject } from '../domain'
import type { Project } from '../domain'
import { createMemoryAdapter, withFaults } from '../persistence'
import type { FaultRule, Ports } from '../persistence'
import { sha256Hex } from '../lib'
import { intent } from '../edit/testing'
import { openProject } from './index'
import type { ProjectSession, SessionAsset } from './index'
import { createTestDeps, flush, heldAsset, quotaTimes, seedProject, testProject } from './testing'

const PROJECT_ID = 'project-1'

async function openSession(
  fault?: readonly FaultRule[],
): Promise<{ session: ProjectSession; project: Project; ports: Ports }> {
  const project = testProject(PROJECT_ID)
  const base = createMemoryAdapter()
  await seedProject(base, project)
  const ports: Ports = fault === undefined ? base : withFaults(base, fault)
  const test = createTestDeps(ports)
  const opened = await openProject(PROJECT_ID, test.deps)
  if (!opened.ok) throw new Error(`openProject: ${opened.error.kind}`)
  return { session: opened.value, project, ports }
}

/** A Plan Image upload: the Intent that carries new Asset bytes (#44). */
function upload(asset: SessionAsset, floorId: string): Intent {
  return intent('plan.setImage', {
    floorId,
    image: { assetHash: asset.sha256, mediaType: 'image/png', widthPx: 640, heightPx: 480 },
    clearExisting: false,
  })
}

function floorOf(project: Project): string {
  const floor = project.floors[0]
  if (floor === undefined) throw new Error('the New Project has no Floor')
  return floor.id
}

describe('the emergency download', () => {
  it('carries every Asset the store has never received, and nothing else (criterion 11)', async () => {
    const { session, project } = await openSession()
    const floorId = floorOf(project)
    const first = await heldAsset(1)
    const second = await heldAsset(2)

    expect(session.dispatch(upload(first, floorId), { newAssets: [first, second] })).toEqual({ ok: true })

    const held = session.emergencySource()
    expect([...held.heldAssets.keys()]).toEqual([first.sha256, second.sha256])
    for (const [hash, asset] of held.heldAssets) {
      expect(await sha256Hex(new Uint8Array(await asset.bytes.arrayBuffer())), 'the hash is the bytes it names').toBe(hash)
    }
    // The Project is the one in memory, and it is re-importable: strict validation, no
    // dangling reference (#42 §5).
    expect(held.project).toEqual(session.getSnapshot().project)
    expect(validateProject(held.project).ok).toBe(true)
    expect(held.project.floors[0]?.planImage?.assetHash).toBe(first.sha256)

    // Once the store has taken them, the download no longer carries them.
    await flush()
    expect(session.getSnapshot().save.kind).toBe('saved')
    expect(session.emergencySource().heldAssets.size).toBe(0)
  })

  it('keeps the bytes while the store refuses them, and the Project with them', async () => {
    const { session, project, ports } = await openSession(quotaTimes(3))
    const floorId = floorOf(project)
    const asset = await heldAsset(7)

    expect(session.dispatch(upload(asset, floorId), { newAssets: [asset] })).toEqual({ ok: true })
    expect(session.dispatch(intent('project.rename', { name: 'At Risk' }))).toEqual({ ok: true })
    await flush()
    expect(session.getSnapshot().save.kind).toBe('failed')

    const held = session.emergencySource()
    expect([...held.heldAssets.keys()]).toEqual([asset.sha256])
    expect(held.project.meta.name).toBe('At Risk')
    expect(validateProject(held.project).ok).toBe(true)

    // The download is ahead of the store, which is the whole point of it (#14).
    const stored = await ports.projects.load(PROJECT_ID)
    if (!stored.ok) throw new Error(`load: ${stored.error.kind}`)
    expect(stored.value.data.meta.name).toBe('Kitchen')
  })

  it('holds nothing for a Project that was only read', async () => {
    const { session } = await openSession()
    const held = session.emergencySource()
    expect(held.heldAssets.size).toBe(0)
    expect(validateProject(held.project).ok).toBe(true)
  })
})
