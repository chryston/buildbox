import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Project } from '../domain'
import { arbProject } from '../domain/testing'
import { sha256Hex } from '../lib'
import { referencedAssetHashes } from './assets'
import { encodeProject, type AssetSource } from './encode'
import { stageImport } from './import'
import { allocateIds, FIXTURE_BUILD } from './testing'

/**
 * Round-trip (#44 acceptance): every Project this build can write, it reads back
 * unchanged. The seed is fixed so CI replays the same Projects on every machine.
 */
const SEED = 20_260_118
const params = { numRuns: 200, seed: SEED }

/**
 * Assets are content-addressed, so the store can only serve bytes whose hash is the one
 * asked for: the Projects under test reference these hashes and nothing else.
 */
const ASSETS = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6, 7]), new Uint8Array([8])].map(
  (bytes) => new Uint8Array([...bytes, 0x89, 0x50, 0x4e, 0x47]),
)
const HASHES = await Promise.all(ASSETS.map(sha256Hex))

const store: AssetSource = async (hash) => {
  const index = HASHES.indexOf(hash)
  if (index < 0) throw new Error(`the asset store holds no ${hash}`)
  return { bytes: ASSETS[index]!, mediaType: 'image/png' }
}

/** Point every Plan Image at an asset the store really holds, keeping the rest as drawn. */
function withRealAssets(project: Project): Project {
  return {
    ...project,
    floors: project.floors.map((floor, index) =>
      floor.planImage === null
        ? floor
        : { ...floor, planImage: { ...floor.planImage, assetHash: HASHES[index % HASHES.length]! } },
    ),
  }
}

describe('every Project round-trips through the codec', () => {
  it('stages exactly the Project it was given', async () => {
    await fc.assert(
      fc.asyncProperty(arbProject(), async (drawn) => {
        const project = withRealAssets(drawn)
        const result = await stageImport(await encodeProject(project, store, FIXTURE_BUILD), { acceptPreview: false, allocateId: allocateIds() })
        if (!result.ok) throw new Error(`${result.problem.code} ${JSON.stringify(result.problem)}`)
        expect(result.staged.project).toEqual(project)
        expect(result.staged.migratedFrom).toBeNull()
        expect(result.staged.manifest.projectId).toBe(project.id)
        const hashes = referencedAssetHashes(project)
        expect([...result.staged.assets.keys()]).toEqual(hashes)
        // Assets come back as the exact bytes and media type the store handed over.
        for (const hash of hashes) {
          const asset = result.staged.assets.get(hash)
          expect(asset?.bytes).toEqual(ASSETS[HASHES.indexOf(hash)]!)
          expect(asset?.mediaType).toBe('image/png')
        }
      }),
      params,
    )
  })

  it('writes the same bytes for the same Project every time', async () => {
    await fc.assert(
      fc.asyncProperty(arbProject(), async (drawn) => {
        const project = withRealAssets(drawn)
        expect(await encodeProject(project, store, FIXTURE_BUILD)).toEqual(
          await encodeProject(project, store, FIXTURE_BUILD),
        )
      }),
      params,
    )
  })

  it('carries an asset shared by every Floor once', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbProject().filter((project) => project.floors.length >= 2),
        async (drawn) => {
          const project: Project = {
            ...drawn,
            floors: drawn.floors.map((floor) => ({
              ...floor,
              planImage: { assetHash: HASHES[0]!, mediaType: 'image/png' as const, widthPx: 4, heightPx: 4, pixelsPerMm: null },
            })),
          }
          const result = await stageImport(await encodeProject(project, store, FIXTURE_BUILD), { acceptPreview: false, allocateId: allocateIds() })
          if (!result.ok) throw new Error(`${result.problem.code}`)
          expect(result.staged.project).toEqual(project)
          expect([...result.staged.assets.keys()]).toEqual([HASHES[0]])
        },
      ),
      params,
    )
  })

  it('refuses an archive whose last byte is gone', async () => {
    // A download cut short is the commonest broken file there is: whatever the Project
    // inside it, an archive whose directory is gone is refused, never half-staged.
    await fc.assert(
      fc.asyncProperty(arbProject(), async (drawn) => {
        const project = withRealAssets(drawn)
        const archive = await encodeProject(project, store, FIXTURE_BUILD)
        const result = await stageImport(archive.subarray(0, archive.length - 1), { acceptPreview: false, allocateId: allocateIds() })
        expect(result.ok).toBe(false)
      }),
      params,
    )
  })
})
