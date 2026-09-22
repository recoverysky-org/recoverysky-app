/**
 * Pure helpers behind the observable local-day clock (`localDay.ts`).
 *
 * Kept free of `@/` and React Native imports so Vitest can load it — see
 * "Test Runner Split" in CLAUDE.md. The MobX box and AppState wiring live in
 * `localDay.ts`, which the tests don't import.
 */

/**
 * Milliseconds from `now` until the next local midnight.
 *
 * Built from `new Date(y, m, d + 1)` rather than `now + 86_400_000` so DST
 * days (23 h / 25 h) and month/year rollovers land on the real midnight.
 * Strictly positive: at exactly 00:00 it returns the full day ahead, never 0,
 * so a caller that re-arms a timer from inside its own callback can't spin.
 */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return next.getTime() - now.getTime()
}
