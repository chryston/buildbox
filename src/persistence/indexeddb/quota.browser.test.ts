/**
 * A quota that trips (#46 criterion 5), in the one browser where it can: Chromium's DevTools
 * protocol shrinks this origin to a megabyte, a four-megabyte image goes past it, and the
 * store must show that the commit never happened.
 *
 * Three details of the command are easy to get wrong, and all three fail silently. The
 * parameter is `quotaSize`; any other name is simply absent, which the command reads as "no
 * override". Chromium reads an origin's quota once, when IndexedDB first starts up for it, so
 * the override goes in before this page touches IndexedDB at all — which is why this file has
 * a Vitest project and a browser to itself (`persistence-quota` in `vite.config.ts`) rather
 * than sharing one with the contract suite. And the small commit that establishes the
 * snapshot has to fit inside the megabyte, as it does.
 *
 * The nightly matrix runs the adapter on Firefox and WebKit too, where there is no such
 * command — the case is skipped there rather than passed on an assumption.
 */
import { cdp } from '@vitest/browser/context'
import type {} from '@vitest/browser/providers/playwright'
import { describe, expect, it } from 'vitest'
import { FIRST_SAVED_AT, PROJECT_ID, SECOND_SAVED_AT, assetBytes, assetHash, failure, projectFixture, snapshotStores, unwrap } from '../contract'
import { openIndexedDbAdapter } from './open'

const MEBIBYTE = 1024 * 1024
const isChromium = /Chrome\//.test(navigator.userAgent)

describe('a quota that trips (#46 criterion 5)', () => {
  it.skipIf(!isChromium)('resolves {kind:"quota"} and leaves every store exactly as it was', async () => {
    await cdp().send('Storage.overrideQuotaForOrigin', { origin: window.location.origin, quotaSize: MEBIBYTE })
    try {
      const opened = await openIndexedDbAdapter({ dbName: 'buildbox-test-quota' })
      if (!opened.ok) throw new Error(`The browser database did not open: ${JSON.stringify(opened.error)}`)
      const ports = opened.value

      // One small image, well inside the megabyte: this is the snapshot the refused commit
      // must leave behind.
      const small = assetBytes(1)
      const smallHash = await assetHash(1)
      unwrap(
        await ports.projects.commit(
          {
            project: projectFixture(smallHash),
            revision: 1,
            savedAt: FIRST_SAVED_AT,
            newAssets: [{ bytes: new Blob([small]), mediaType: 'image/png', widthPx: 64, heightPx: 48 }],
          },
          null,
        ),
      )
      const before = await snapshotStores(ports, { assets: [smallHash] })

      const big = new Uint8Array(4 * MEBIBYTE).fill(7)
      const committed = await ports.projects.commit(
        {
          project: projectFixture(smallHash),
          revision: 2,
          savedAt: SECOND_SAVED_AT,
          // The Plan Image stays the small one: the oversized asset is the new offer, and it
          // is the first write of the transaction, so it is what the quota has to refuse.
          newAssets: [{ bytes: new Blob([big]), mediaType: 'image/png', widthPx: 2000, heightPx: 2000 }],
        },
        1,
      )
      expect(failure(committed).kind).toBe('quota')
      // The Project record, its Library row and the asset table are still revision 1's.
      expect(await snapshotStores(ports, { assets: [smallHash] })).toBe(before)
      expect(unwrap(await ports.projects.load(PROJECT_ID)).revision).toBe(1)
    } finally {
      // The command hands the origin's own figure back when `quotaSize` is left out.
      await cdp().send('Storage.overrideQuotaForOrigin', { origin: window.location.origin })
    }
  })
})
