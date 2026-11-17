/**
 * IndexedDB failures, translated (#46): the port vocabulary is the only thing a caller of
 * `persistence` is allowed to see, so no raw `DOMException` ever leaves this folder.
 *
 * A quota has to be recognised in both places it surfaces — on the request that tripped it
 * and, more often, on the transaction `abort` that follows, where `tx.error` names it.
 * `transact` in `./adapter` feeds both through here.
 */
import type { PersistenceError } from '../index'

/**
 * The port error an IndexedDB failure stands for. Anything the transaction aborted over is
 * `aborted`: from the caller's side an interrupted write and an unexplained one look the
 * same, and both leave the last successful snapshot in place (#14).
 */
export function mapIndexedDbError(error: unknown): PersistenceError {
  if (!(error instanceof DOMException)) throw error
  switch (error.name) {
    // Quota, however it surfaces: the Save failed path is built on this one kind (#51).
    case 'QuotaExceededError':
      return { kind: 'quota' }
    // A value the structured clone algorithm refused to store: a programmer bug, typed.
    case 'DataCloneError':
      return { kind: 'serialization' }
    // A closed or closing connection: the store itself is gone, which is memory-only mode.
    case 'InvalidStateError':
      return { kind: 'unavailable', reason: describeError(error) }
    default:
      return { kind: 'aborted' }
  }
}

/** Why the database could not be opened, in the one string `unavailable` carries. */
export function describeError(error: unknown): string {
  return error instanceof Error || error instanceof DOMException ? `${error.name}: ${error.message}` : String(error)
}

/**
 * The failure of a write that already had a transaction to run in.
 *
 * `transactionError` is what the transaction itself recorded, which is where a quota surfaces
 * — the write that trips it aborts the transaction, and the abort names the reason. Inside a
 * transaction, `InvalidStateError` means that transaction was interrupted: a closed connection
 * throws the same name one level out, before there is a transaction to ask, and that stays
 * `unavailable` (#46 criterion 2).
 */
export function mapWriteError(thrown: unknown, transactionError: DOMException | null | undefined): PersistenceError {
  if (transactionError !== null && transactionError !== undefined) return mapIndexedDbError(transactionError)
  if (thrown instanceof DOMException && thrown.name === 'InvalidStateError') return { kind: 'aborted' }
  return mapIndexedDbError(thrown)
}
