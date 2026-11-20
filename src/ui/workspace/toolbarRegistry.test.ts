/**
 * The measured-tool gate (#56 criterion 6, #64 criterion 11).
 *
 * The rule is one line — a measured tool needs a calibrated Floor — but it is the line that
 * decides whether the app is honest about a number, so it is written once here and asserted
 * against a tool definition rather than against a click. `Wall` is the first shipping tool
 * that measures; the tests below kept asserting against a made-up definition even after it
 * landed, because the gate has to hold for the next measured tool too.
 */
import { describe, expect, it } from 'vitest'
import type { PlanImage } from '../../domain'
import {
  CALIBRATION_REQUIRED_HINT,
  WORKSPACE_TOOLS,
  floorNeedsCalibration,
  toolIsGated,
} from './toolbarRegistry'
import type { WorkspaceToolDefinition } from './toolbarRegistry'

const image = (pixelsPerMm: number | null): PlanImage => ({
  assetHash: 'a'.repeat(64),
  mediaType: 'image/png',
  widthPx: 100,
  heightPx: 100,
  pixelsPerMm,
})

/**
 * A tool definition with the flag under test. The id and label are the pointer tool's — the
 * gate reads `requiresCalibratedFloor` and nothing else, which is the point of the registry.
 */
const tool = (requiresCalibratedFloor: boolean): WorkspaceToolDefinition => ({
  id: 'select',
  label: 'Select',
  testId: 'tool-select',
  requiresCalibratedFloor,
})

const measured = tool(true)
const pointer = tool(false)

describe('floorNeedsCalibration', () => {
  it('is false with no Plan Image at all — there is nothing to measure against', () => {
    expect(floorNeedsCalibration(null)).toBe(false)
  })

  it('is true for an image whose scale is unknown', () => {
    expect(floorNeedsCalibration(image(null))).toBe(true)
  })

  it('is false once the image is calibrated', () => {
    expect(floorNeedsCalibration(image(0.08))).toBe(false)
  })
})

describe('toolIsGated', () => {
  it('gates a measured tool on an uncalibrated Floor', () => {
    expect(toolIsGated(measured, image(null))).toBe(true)
  })

  it('leaves a measured tool free when there is no image, and once calibrated', () => {
    expect(toolIsGated(measured, null)).toBe(false)
    expect(toolIsGated(measured, image(0.08))).toBe(false)
  })

  it('never gates a tool that measures nothing', () => {
    expect(toolIsGated(pointer, image(null))).toBe(false)
  })
})

describe('the registry', () => {
  it('holds the pointer tools, which measure nothing and so are never gated', () => {
    const pointer = WORKSPACE_TOOLS.filter((each) => !each.requiresCalibratedFloor)
    expect(pointer.map((each) => each.id)).toEqual(['select', 'pan'])
    expect(pointer.every((each) => toolIsGated(each, image(null)))).toBe(false)
  })

  it('gates the Wall tool on an uncalibrated Floor, and nowhere else (#64 criterion 11)', () => {
    const wall = WORKSPACE_TOOLS.find((each) => each.id === 'wall')!
    expect(wall.label).toBe('Wall')
    expect(wall.testId).toBe('tool-wall')
    expect(toolIsGated(wall, image(null))).toBe(true)
    expect(toolIsGated(wall, image(0.08))).toBe(false)
    expect(toolIsGated(wall, null)).toBe(false)
  })

  it('states the reason in the words the issue prescribes', () => {
    expect(CALIBRATION_REQUIRED_HINT).toBe("Calibrate this Floor's Plan Image to draw measured shapes")
  })
})
