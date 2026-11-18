/**
 * The channel a build writes to (#53 criterion 4).
 *
 * The production case is the one that matters most: a build with no flags opens `buildbox` and
 * writes unmarked Packages. The preview case is the mechanism the next flag will use, so it is
 * pinned here rather than left to whatever the one flag happened to set.
 */
import { describe, expect, it } from 'vitest'
import { PRODUCTION_DB_NAME, PREVIEW_DB_NAME, channelDbName, isPreviewChannel } from './channel'

describe('the build channel', () => {
  it('opens the production database when no flag is set', () => {
    expect(isPreviewChannel({})).toBe(false)
    expect(channelDbName({})).toBe(PRODUCTION_DB_NAME)
    expect(channelDbName({ BASE_URL: '/', MODE: 'production' })).toBe(PRODUCTION_DB_NAME)
  })

  it('opens the preview database when any flag is on', () => {
    expect(isPreviewChannel({ VITE_FF_MULTI_FLOOR: 'true' })).toBe(true)
    expect(channelDbName({ VITE_FF_MULTI_FLOOR: 'true' })).toBe(PREVIEW_DB_NAME)
  })

  it('reads a flag as off unless it is exactly "true"', () => {
    expect(isPreviewChannel({ VITE_FF_MULTI_FLOOR: 'false' })).toBe(false)
    expect(isPreviewChannel({ VITE_FF_MULTI_FLOOR: '' })).toBe(false)
    expect(isPreviewChannel({ VITE_FF_MULTI_FLOOR: undefined })).toBe(false)
    // A flag named like one is not one: only the prefix counts.
    expect(isPreviewChannel({ VITE_FEATURE_FLAG: 'true' })).toBe(false)
  })

  it('keeps the two databases apart by name', () => {
    expect(PRODUCTION_DB_NAME).toBe('buildbox')
    expect(PREVIEW_DB_NAME).not.toBe(PRODUCTION_DB_NAME)
    // Neither is the legacy localStorage key, which this app never writes (#53 criterion 1).
    expect(PRODUCTION_DB_NAME).not.toBe('buildbox-store')
  })
})
