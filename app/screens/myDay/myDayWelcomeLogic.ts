/**
 * When My Day's welcome page shows (ADDED 2026-11-18, spec
 * `docs/superpowers/specs/2026-11-18-my-day-welcome-design.md`).
 *
 * Production and TestFlight show it until the person taps Get started, which writes
 * `MY_DAY_WELCOME_SEEN_KEY`. The flag is written on the tap, not when the page shows, so someone
 * who leaves the tab mid-read sees it again. Dev builds (`__DEV__`) show it on every mount of the
 * Today route so the page can be worked on; Get started still hides it until the next mount.
 *
 * No `@/` imports: vitest loads this.
 */

/** MMKV key, per install. The device has one owner, so per install is per person here. */
export const MY_DAY_WELCOME_SEEN_KEY = "myDay.welcomeSeen"

export interface MyDayWelcomeInput {
  /** `__DEV__`: false in TestFlight, which behaves as production. */
  isDev: boolean
  /** The MMKV flag, read once when the route mounts. */
  seen: boolean
  /** Get started was tapped since the route mounted. */
  dismissedThisMount: boolean
}

export function shouldShowMyDayWelcome({
  isDev,
  seen,
  dismissedThisMount,
}: MyDayWelcomeInput): boolean {
  // A tap always wins for the rest of the mount, even in dev, or Get started would do nothing.
  if (dismissedThisMount) return false
  return isDev || !seen
}
