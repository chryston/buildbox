import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebLocksPort, projectLockKey } from './locks'

/**
 * The Web Locks contract in as much of it as `./locks` relies on: `request` settles when the
 * callback returns, so a callback that stays pending is a lock that stays held, and
 * `ifAvailable` answers `null` instead of queueing. A stub that resolved `request` when the
 * callback *started* would hide the one thing this port has to get right — it cost a smoke
 * run when it did not (#49).
 */
class FakeLocks {
  readonly names: string[] = []
  private readonly held = new Set<string>()
  private readonly waiters = new Map<string, (() => void)[]>()

  async request<T>(
    name: string,
    options: { ifAvailable?: boolean } | undefined,
    callback: (lock: { name: string } | null) => Promise<T>,
  ): Promise<T> {
    this.names.push(name)
    if (this.held.has(name)) {
      if (options?.ifAvailable === true) return callback(null)
      await new Promise<void>((wake) => {
        this.waiters.set(name, [...(this.waiters.get(name) ?? []), wake])
      })
    }
    this.held.add(name)
    try {
      return await callback({ name })
    } finally {
      this.held.delete(name)
      this.waiters.get(name)?.shift()?.()
    }
  }

  /** Whether a request still owns the name; the fake frees it when the callback returns. */
  isHeld(name: string): boolean {
    return this.held.has(name)
  }

  /** How many requests are queued behind a holder; the queue is the read-only state. */
  queued(name: string): number {
    return this.waiters.get(name)?.length ?? 0
  }
}

/** The fake frees a name when the held callback returns, one microtask after `release`. */
async function giveUp(locks: FakeLocks, projectId: string): Promise<void> {
  await vi.waitFor(() => expect(locks.isHeld(projectLockKey(projectId))).toBe(false))
}

const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'locks')

function install(locks: FakeLocks | undefined): void {
  Object.defineProperty(Navigator.prototype, 'locks', {
    value: locks,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  if (original === undefined) delete (Navigator.prototype as unknown as Record<string, unknown>).locks
  else Object.defineProperty(Navigator.prototype, 'locks', original)
})

describe('createWebLocksPort', () => {
  it('hands the lock back while still holding it', async () => {
    const locks = new FakeLocks()
    install(locks)
    const port = createWebLocksPort()

    // The regression: `request` only settles when the callback returns, so a port that
    // awaited it would never come back and no Project would ever open.
    const handle = await port.acquire('proj-1')
    expect(handle).not.toBeNull()
    expect(locks.names).toEqual([projectLockKey('proj-1')])

    // Still held, so another tab asking for it is told to read.
    expect(await port.acquire('proj-1')).toBeNull()

    handle?.release()
    await giveUp(locks, 'proj-1')
    expect(await port.acquire('proj-1')).not.toBeNull()
  })

  it('waits for the holder when the tab did not ask with ifAvailable', async () => {
    const locks = new FakeLocks()
    install(locks)
    const port = createWebLocksPort()
    const held = await port.acquire('proj-1')

    let acquired: unknown = null
    const waiting = port.waitFor('proj-1').then((handle) => {
      acquired = handle
    })
    // The condition, not a duration: the request is queued and nothing has been handed back.
    await vi.waitFor(() => expect(locks.queued(projectLockKey('proj-1'))).toBe(1))
    expect(acquired).toBeNull()

    held?.release()
    await waiting
    expect(acquired).not.toBeNull()
  })

  it('gives up once, however many times it is released', async () => {
    const locks = new FakeLocks()
    install(locks)
    const port = createWebLocksPort()
    const held = await port.acquire('proj-1')

    held?.release()
    held?.release()

    await giveUp(locks, 'proj-1')
    expect(await port.acquire('proj-1')).not.toBeNull()
    expect(locks.names).toHaveLength(2)
  })

  it('treats a browser without the API as a single tab', async () => {
    install(undefined)
    const port = createWebLocksPort()
    const first = await port.acquire('proj-1')
    const second = await port.acquire('proj-1')

    // No other tab can exist where the API is missing, so nothing waits and nothing is
    // read-only (#51).
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(() => first?.release()).not.toThrow()
    await expect(port.waitFor('proj-1')).resolves.not.toBeNull()
  })
})
