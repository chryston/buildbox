/**
 * The `app` module's face (#42 §2).
 *
 * `mountProjectsV2` is deliberately absent: `main.tsx` reaches it with a dynamic import so the
 * whole Local Projects graph — `ui`, `session`, `persistence` — stays out of the measured app
 * shell (#35). What is here is the one thing another module legitimately needs to name: the
 * Intent factory, which the #53 component-test harness borrows so a test builds its Intents
 * exactly as a view does.
 */
export { createIntentFactory } from './projectsV2'
