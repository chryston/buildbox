/**
 * The contract suite against the in-memory adapter (#45 verification): the reference
 * implementation has to pass all nine cases, faults included, under Vitest's Node
 * environment with no DOM at all (#20 §13.13).
 */
import { describePersistenceContract } from './contract'
import { createMemoryAdapter } from './index'

describePersistenceContract('memory', createMemoryAdapter, { faults: true })
