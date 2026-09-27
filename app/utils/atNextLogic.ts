/**
 * Pure logic for Live's "Starts In" selector (GET /schedules/at-next —
 * hyphenated; the `at_next` spelling was the design draft's).
 *
 * ADDED 2026-09-26. The API owns the window math: it interprets `offset`
 * against `starts_at`. The app only builds `starts_at`, prunes meetings that
 * have begun since the last fetch, sorts, and decides what a failure means.
 * Free of runtime `@/` imports so vitest can run it (CLAUDE.md "Test Runner
 * Split"). Spec: docs/superpowers/specs/2026-09-26-meetings-filter-bar-and-starts-in-design.md
 *
 * CHANGED 2026-09-27: aligned with the deployed API (api repo, src/openapi.ts
 * `GET /schedules/at-next`). The route is hyphenated; `offset` picks ONE
 * coming quarter-hour mark (15 = the next :00/:15/:30/:45 strictly after now,
 * 30/45/60 = 15/30/45 min past that) rather than a window; `starts_at` is a
 * boolean ("only meetings starting exactly at the mark"), not a reference
 * timestamp; and the response carries `at`, the mark it answered for. So the
 * app no longer builds a timestamp (`buildStartsAt` is gone), no longer sorts
 * by start (every row shares `at` — `sortByStart` is gone), and instead
 * schedules its refetch for just after `at`, when the server's answer moves
 * to the next mark.
 * Known product gap, not a bug: `starts_at=true` matches `millis === at`
 * exactly, so a meeting starting off the quarter hour (7:05, 7:10…) never
 * appears under any Starts In option.
 */

/** Selector values. Strings, because SegmentedPill is typed `T extends string`. */
export type StartsIn = "live" | "15" | "30" | "45" | "60"

/** Minutes the API accepts for `offset`. */
export type AtNextOffset = 15 | 30 | 45 | 60

/**
 * The four offsets, in chip order. REPLACED 2026-09-27: was
 * `STARTS_IN_OPTIONS` (Live + all four, always shown). Now every offset is
 * prefetched while Live is on screen and only the ones with meetings get a
 * chip (availableStartsIn), so the list of offsets and the list of chips are
 * different things.
 */
export const AT_NEXT_OFFSETS: readonly AtNextOffset[] = [15, 30, 45, 60]

/** `null` for `live`: that view comes from MeetingContext, not at_next. */
export function offsetOf(s: StartsIn): AtNextOffset | null {
  return s === "live" ? null : (Number(s) as AtNextOffset)
}

/**
 * The response's `at` (ISO 8601, the quarter-hour mark answered for) as UTC
 * millis, or null when absent/unparseable. Null disables the mark-driven
 * refetch and the "Starting at …" line rather than guessing a mark: the API
 * owns that math (`nextQuarterHour` server-side).
 */
export function parseAtMillis(at: string | undefined): number | null {
  if (!at) return null
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Slack after the boundary before refetching: a buffer for the device clock
 * running slightly behind the API's, so the request lands after the server's
 * `nextQuarterHour` has moved on. (The API's cache rotation runs minutes
 * BEFORE the boundary, so it is not what this waits for.)
 */
export const REFETCH_GRACE_MS = 5_000

/**
 * Minimum wait when `at` is already in the past by the device clock. That only
 * happens when the device clock runs ahead of the API's: refetching "right
 * away" would get the same `at` back and loop every few seconds until the
 * clocks agree.
 */
export const REFETCH_SKEW_FLOOR_MS = 60_000

/**
 * How long to wait before refetching. The server recomputes every offset's
 * mark at each quarter-hour boundary (`nextQuarterHour(now, offset)`), so an
 * answer is current until the NEXT boundary — `at` for offset 15, but
 * `at − (offset − 15) min` for 30/45/60 (asked at 12:06, "60" answers for
 * 13:00 and moves to 13:15 at 12:15). Polling between boundaries would return
 * the same rows: one request per quarter hour is the whole budget.
 * FIXED 2026-09-27 (review): this first waited for `at` itself, which left
 * "60" stale for 45 min per cycle and skipped three of every four marks.
 */
export function refetchDelayMs(
  atMs: number | null,
  offset: AtNextOffset,
  nowMs: number,
): number | null {
  // CHANGED 2026-09-27: one definition of the boundary math — delegates to
  // the four-slot version with a single slot.
  return nextRefetchDelayMs({ [offset]: atMs }, nowMs)
}

/**
 * Drop entries whose start has passed (`millis <= nowMs`).
 * Runs on a 60 s tick between fetches, so a 15-minute list never shows a
 * meeting that already began.
 * CHANGED 2026-09-27: with `starts_at=true` every row starts exactly at `at`,
 * so for offset 15 this drops the whole list once the mark passes — normally
 * moot, because the boundary refetch (refetchDelayMs) has already replaced
 * the rows a few seconds after the mark, before the next 60 s tick. Also drops continuous rooms (`millis === 0`,
 * shown as "24h" by MeetingRow): an always-open room has no upcoming start, so
 * it doesn't belong in a "starting soon" list even if the API returns one.
 */
export function pruneStarted<T extends { millis: number }>(
  items: readonly T[],
  nowMs: number,
): T[] {
  return items.filter((i) => i.millis > nowMs)
}

/**
 * What a failed at_next fetch means for the UI.
 * `not-found` = this API build has no route yet (the `startsInVisible` flag
 * was flipped before the deploy), so hide the selector for the session and
 * show Live. Anything else is a real failure worth a retry prompt. Transport
 * retries already happened inside retryWithBackoff before this is asked.
 */
export function classifyAtNextProblem(kind: string): "hide-for-session" | "show-error" {
  return kind === "not-found" ? "hide-for-session" : "show-error"
}

/**
 * Minute chips worth showing: offsets whose (already fellowship/language
 * filtered) list is non-empty, in chip order. ADDED 2026-09-27 (Jenova): the
 * app prefetches all four and hides the ones with nothing starting, so a chip
 * never opens onto an empty list. A slot that hasn't loaded counts as empty.
 */
export function availableStartsIn(
  countByOffset: Partial<Record<AtNextOffset, number>>,
): StartsIn[] {
  return AT_NEXT_OFFSETS.filter((o) => (countByOffset[o] ?? 0) > 0).map(
    (o) => String(o) as StartsIn,
  )
}

/**
 * Where a Starts In pick should be after the slots change.
 *
 * REPLACED 2026-09-27 (Jenova): was `resolveStartsIn`, which fell back to
 * Live Now whenever the picked chip vanished. That lost the pick exactly when
 * the user most needed it kept: pick 30m at 12:06 (the 12:30 mark), background
 * the app, come back at 12:21 — every slot has gone stale, so the chip
 * vanished, the pick dropped to Live Now, and the refetch then showed 12:30
 * under 15m with nobody looking. Also, while watching, the boundary refetch
 * at 12:15 silently turned "30m" into 12:45 under the user.
 *
 * Now: a minute pick is remembered with the mark it was made for
 * (`pickedAtMs`). It stays while its chip is visible AND that chip still
 * answers for the same mark (so a pull-to-refresh inside the quarter keeps
 * it). Once the mark has moved, the pick FOLLOWS ITS MEETINGS to whichever
 * visible chip now answers for that mark (see below); only when the mark has
 * passed, or no visible chip shows it, does it move to the LOWEST visible
 * chip, and to Live Now only when no chip is visible.
 * CHANGED 2026-09-27 (Jenova): "lowest chip" alone jumped a watched 60m
 * (13:00) to 15m (12:30) at the 12:15 boundary; following the mark keeps the
 * same meetings on screen under 45m.
 * Callers must not apply this while a batch is loading (the slots are
 * mid-refresh; see LiveScreen).
 */
export function followStartsIn(i: {
  selected: StartsIn
  pickedAtMs: number | null
  atByOffset: Partial<Record<AtNextOffset, number | null>>
  available: readonly StartsIn[]
}): { startsIn: StartsIn; pickedAtMs: number | null } {
  const offset = offsetOf(i.selected)
  if (offset === null) return { startsIn: "live", pickedAtMs: null }
  const currentAtMs = i.atByOffset[offset] ?? null
  if (i.available.includes(i.selected)) {
    // A pick made while its mark was unknown (tapped during a batch, when the
    // slot was cleared) adopts the mark it lands with instead of counting as
    // "moved". CHANGED 2026-09-27 (review): without this the user's own tap
    // was overridden to the lowest chip the moment the batch landed.
    if (i.pickedAtMs === null) return { startsIn: i.selected, pickedAtMs: currentAtMs }
    if (currentAtMs === i.pickedAtMs) return { startsIn: i.selected, pickedAtMs: i.pickedAtMs }
  }
  // Follow the meetings (CHANGED 2026-09-27, Jenova: "the point is to adjust
  // so the same meetings remain visible"): if another visible chip now
  // answers for the picked mark — 60m's 13:00 is under 45m after the 12:15
  // boundary; 30m's 12:30 is under 15m after a return at 12:21 — move there.
  if (i.pickedAtMs !== null) {
    for (const option of i.available) {
      const o = offsetOf(option)
      if (o !== null && (i.atByOffset[o] ?? null) === i.pickedAtMs) {
        return { startsIn: option, pickedAtMs: i.pickedAtMs }
      }
    }
  }
  // The picked mark has passed (or its chip is hidden): the soonest chip.
  const lowest = i.available[0]
  const lowestOffset = lowest ? offsetOf(lowest) : null
  if (!lowest || lowestOffset === null) return { startsIn: "live", pickedAtMs: null }
  return { startsIn: lowest, pickedAtMs: i.atByOffset[lowestOffset] ?? null }
}

/** The quarter-hour boundary after which an offset's answer is stale. */
function boundaryOf(atMs: number, offset: AtNextOffset): number {
  return atMs - (offset - 15) * 60_000
}

/**
 * Whether a slot's rows still answer the current question: its boundary
 * hasn't passed. ADDED 2026-09-27 (review): a slot that failed to refresh
 * keeps its rows, but once its boundary passes they describe an older mark
 * — the "30m" rows would duplicate what "15m" now shows — so they're dropped.
 */
export function isSlotCurrent(atMs: number | null, offset: AtNextOffset, nowMs: number): boolean {
  return atMs !== null && boundaryOf(atMs, offset) > nowMs
}

/**
 * When to refetch all four slots. They share one boundary, so this takes the
 * LATEST boundary any slot implies. Null when nothing has a mark yet.
 * ADDED 2026-09-27.
 * FIXED 2026-09-27 (review): this took the earliest, so a failed slot's stale
 * mark (boundary already past) forced the 60 s skew floor and turned the
 * quarter-hour timer into a full batch every minute for as long as that
 * offset kept failing. The latest boundary ignores stale slots, and a device
 * whose clock runs ahead (every boundary past) still gets the floor.
 */
export function nextRefetchDelayMs(
  atByOffset: Partial<Record<AtNextOffset, number | null>>,
  nowMs: number,
): number | null {
  let latest: number | null = null
  for (const offset of AT_NEXT_OFFSETS) {
    const atMs = atByOffset[offset]
    if (atMs === null || atMs === undefined) continue
    const boundary = boundaryOf(atMs, offset)
    if (latest === null || boundary > latest) latest = boundary
  }
  if (latest === null) return null
  return latest > nowMs ? latest - nowMs + REFETCH_GRACE_MS : REFETCH_SKEW_FLOOR_MS
}

/**
 * Delay to the next clock quarter-hour (:00/:15/:30/:45) plus the grace.
 * ADDED 2026-09-27 (review): the fallback schedule after a batch where every
 * offset failed, which has no `at` to schedule from. Without it nothing
 * retried until the user left Live, and the chips simply vanished.
 */
export function msUntilNextQuarterHour(nowMs: number): number {
  const quarter = 15 * 60_000
  return (Math.floor(nowMs / quarter) + 1) * quarter - nowMs + REFETCH_GRACE_MS
}
