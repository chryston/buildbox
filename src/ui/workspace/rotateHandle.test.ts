/**
 * The rotate handle's geometry (#57 criterion 12): the 15° snap, the 0.1° free follow, the
 * quarter turns that wrap, and the handle sitting a constant 24 CSS px past the footprint's
 * furthest corner whatever the zoom.
 */
import { describe, expect, it } from 'vitest'
import {
  HANDLE_REACH_PX,
  cornerReach,
  handlePoint,
  handleRadiusMm,
  quarterTurn,
  rotationFromPointer,
} from './rotateHandle'

const SNAP = { enabled: true, incrementDeg: 15 }
const FREE = { enabled: false, incrementDeg: 15 }
const ORIGIN = { x: 0, y: 0 }

/** The pointer 100 mm from the Item Origin at the given rotation of the handle. */
const pointerAt = (deg: number): { x: number; y: number } => {
  const rad = (deg - 90) * Math.PI / 180
  return { x: Math.cos(rad) * 100, y: Math.sin(rad) * 100 }
}

describe('rotationFromPointer', () => {
  it('reads straight up as 0° and right as 90°, clockwise with +Y down', () => {
    expect(rotationFromPointer(ORIGIN, { x: 0, y: -100 }, FREE)).toBe(0)
    expect(rotationFromPointer(ORIGIN, { x: 100, y: 0 }, FREE)).toBe(90)
    expect(rotationFromPointer(ORIGIN, { x: 0, y: 100 }, FREE)).toBe(180)
    expect(rotationFromPointer(ORIGIN, { x: -100, y: 0 }, FREE)).toBe(270)
  })

  it('snaps a drag to the nearest increment (#57 criterion 12)', () => {
    expect(rotationFromPointer(ORIGIN, pointerAt(52), SNAP)).toBe(45)
    expect(rotationFromPointer(ORIGIN, pointerAt(56), SNAP)).toBe(60)
    expect(rotationFromPointer(ORIGIN, pointerAt(7), SNAP)).toBe(0)
    expect(rotationFromPointer(ORIGIN, pointerAt(355), SNAP)).toBe(0)
    expect(rotationFromPointer(ORIGIN, pointerAt(352), SNAP)).toBe(345)
  })

  it('follows the pointer to 0.1° with angle snap off', () => {
    expect(rotationFromPointer(ORIGIN, pointerAt(37), FREE)).toBe(37)
    expect(rotationFromPointer(ORIGIN, pointerAt(37.44), FREE)).toBe(37.4)
    expect(rotationFromPointer(ORIGIN, pointerAt(37.46), FREE)).toBe(37.5)
  })

  it('is the same answer wherever the placement stands', () => {
    const at = { x: 5150, y: 4500 }
    expect(rotationFromPointer(at, { x: 5150, y: 4400 }, FREE)).toBe(0)
    expect(rotationFromPointer(at, { x: 5250, y: 4500 }, SNAP)).toBe(90)
  })

  it('never answers -0 or a degree outside [0, 360)', () => {
    const north = rotationFromPointer(ORIGIN, { x: -0.0001, y: -100 }, FREE)
    expect(Object.is(north, -0)).toBe(false)
    expect(north).toBeGreaterThanOrEqual(0)
    expect(north).toBeLessThan(360)
  })
})

describe('quarterTurn', () => {
  it('wraps both ways through zero (#57 criterion 12)', () => {
    expect(quarterTurn(350, 1)).toBe(80)
    expect(quarterTurn(10, -1)).toBe(280)
    expect(quarterTurn(0, -1)).toBe(270)
    expect(quarterTurn(270, 1)).toBe(0)
    expect(quarterTurn(37.5, 1)).toBe(127.5)
  })
})

describe('handleRadiusMm', () => {
  it('is the furthest corner plus a reach that stays 24 CSS px at any zoom', () => {
    const centre = { x: 300, y: 200 }
    expect(cornerReach(600, 400, centre)).toBeCloseTo(Math.hypot(300, 200), 9)
    expect(handleRadiusMm(600, 400, centre, 1)).toBeCloseTo(Math.hypot(300, 200) + HANDLE_REACH_PX, 9)
    expect(handleRadiusMm(600, 400, centre, 4)).toBeCloseTo(Math.hypot(300, 200) + 6, 9)
    // An off-centre origin reaches further to the corner it is nearest to, not to the centre.
    expect(cornerReach(600, 400, { x: 0, y: 0 })).toBeCloseTo(Math.hypot(600, 400), 9)
  })
})

describe('handlePoint', () => {
  it('sits straight above the Item Origin at 0° and turns with the placement', () => {
    const context = { rotationDeg: 0, translation: { x: 1000, y: 800 }, origin: { x: 300, y: 200 } }
    expect(handlePoint(context, 100)).toEqual({ x: 1000, y: 700 })
    const turned = { ...context, rotationDeg: 90 }
    // 90° clockwise: local −Y now points to the right of the screen.
    expect(handlePoint(turned, 100).x).toBeCloseTo(1100, 9)
    expect(handlePoint(turned, 100).y).toBeCloseTo(800, 9)
  })
})
