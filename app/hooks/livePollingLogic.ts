/**
 * Pure scheduling math for useLivePolling.
 *
 * Kept free of runtime `@/` imports so vitest can load it (see "Test Runner
 * Split" in CLAUDE.md). The hook owns the timers and AppState; this module
 * only decides *when*.
 *
 * ADDED 2026-09-09 (quarter-hour cache stampede): every install used to fire
 * its Live refresh at the exact :00/:15/:30/:45 mark — the same second the
 * API's ScheduleCache expires its entries. With the whole fleet arriving in
 * one second the server ran its uncached pipeline once per request and
 * clients hit their 10 s timeout. We now land each refresh a random 5–90 s
 * after the mark so the fleet spreads across the first minute and a half.
 * The API side is being asked to warm the cache *before* the boundary; the
 * two halves are independent and each helps on its own.
 */

/** Earliest a refresh may fire after a quarter-hour mark. */
export const LIVE_POLL_JITTER_MIN_MS = 5_000
/**
 * Latest a refresh may fire after a quarter-hour mark (exclusive). 90 s
 * gives the server's worst observed in-person refresh (61 s on 2026-09-09)
 * room to land before the last client asks, while keeping the Live list
 * under two minutes stale at worst.
 */
export const LIVE_POLL_JITTER_MAX_MS = 90_000

/**
 * Milliseconds from `now` until the next :00/:15/:30/:45 mark.
 * When `now` is exactly on a mark, waits a full period rather than firing
 * immediately — the refresh for this mark already happened.
 */
export function msUntilNextQuarterHour(now: Date): number {
  const minutes = now.getMinutes()
  const seconds = now.getSeconds()
  const ms = now.getMilliseconds()

  // Find next 15-minute mark (0, 15, 30, 45)
  const nextMark = Math.ceil((minutes + 1) / 15) * 15
  const minutesUntil = (nextMark - minutes) % 60 || 15 // If exactly on mark, wait 15 min

  return minutesUntil * 60 * 1000 - seconds * 1000 - ms
}

/**
 * Draw a fresh offset in [MIN, MAX). One draw per scheduled refresh —
 * per-firing randomness spreads the fleet just as well as a stable
 * per-install offset and needs no identity input.
 *
 * @param random - injectable for tests; defaults to Math.random
 */
export function pickRefreshJitterMs(random: () => number = Math.random): number {
  return LIVE_POLL_JITTER_MIN_MS + random() * (LIVE_POLL_JITTER_MAX_MS - LIVE_POLL_JITTER_MIN_MS)
}

/** Delay until the next refresh: the boundary countdown plus this firing's jitter. */
export function msUntilNextRefresh(now: Date, jitterMs: number): number {
  return msUntilNextQuarterHour(now) + jitterMs
}
