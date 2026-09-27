/**
 * Data for Live's Starts In view (GET /schedules/at-next). ADDED 2026-09-26.
 *
 * Deliberately separate from MeetingContext: the in-progress Live pipeline
 * (quarter-hour polling, maintenance-exit refresh) stays untouched, and this
 * only runs while the user has a minute option selected AND Live is on screen.
 *
 * - Fetches on selection, on `refresh()`, and every 5 min while shown.
 * - A 60 s tick prunes meetings that have started since the last fetch.
 * - Clears on offset change, and a sequence ref drops superseded responses,
 *   so a slow 60-min answer can never land under 15.
 * - 404 → `unavailable`: this API build has no route. The caller hides the
 *   selector for the session.
 * - Blocked by maintenance/outage the same way MeetingContext is.
 * - CHANGED 2026-09-26: AppState-aware, following useLivePolling's pattern.
 *   Android keeps JS timers firing while backgrounded, so an unguarded 5-min
 *   `setInterval` polled and burned battery/data the whole time the app sat
 *   in the background with a minute option selected. Both intervals below
 *   now pause while the app isn't `"active"` and resume — with one immediate
 *   refetch — on the background→active edge, gated on the same `visible` /
 *   `offset` conditions as everything else here. This does NOT reset
 *   `startsIn`: that reset is owned by LiveScreen's hide-edge effect and is
 *   per segment-visit, not per app-foreground-visit.
 * - CHANGED 2026-09-27: aligned with the deployed `GET /schedules/at-next`
 *   (see api.getAtNextSchedules). Each offset is one quarter-hour mark whose
 *   answer only changes when that mark passes, so the 5-min interval is gone:
 *   the hook refetches once, just after the next quarter-hour boundary (for
 *   offset 15 that's `at`; for 30/45/60 it's before `at` — see
 *   atNextLogic.refetchDelayMs), and re-arms from each successful answer.
 *   The "every 5 min while shown" bullet above no longer holds.
 *   `atMs` is returned so LiveScreen can say "Starting at 7:30p". Rows are no
 *   longer start-sorted (they all start at `at`); LiveScreen ranks them by
 *   feedback like the Live list.
 *
 * INTEGRATION REQUIREMENT: call from an `observer()` component (reads ConfigStore).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppState, type AppStateStatus } from "react-native"

import { retryWithBackoff, toMeetingWithTrex, type MeetingWithTrex } from "@/context/MeetingContext"
import { projectOnline } from "@/context/meetingPools"
import { useConfigStore } from "@/models"
import { api } from "@/services/api"
import {
  classifyAtNextProblem,
  offsetOf,
  parseAtMillis,
  pruneStarted,
  refetchDelayMs,
  type StartsIn,
} from "@/utils/atNextLogic"
import { isLiveRefreshBlocked } from "@/utils/connectivityLogic"

/** Prune cadence: minute resolution matches `starts_at`. */
// CHANGED 2026-09-27: `starts_at` is now a boolean, not a minute-truncated
// timestamp; a minute tick still suffices to drop rows once the mark passes.
// (REFETCH_MS, the 5-min refetch interval, was removed — see the header.)
const TICK_MS = 60_000

export function useAtNextSchedules(startsIn: StartsIn, visible: boolean) {
  const configStore = useConfigStore()
  const blocked = isLiveRefreshBlocked({
    maintenanceMode: configStore.maintenanceMode,
    outageMode: configStore.outageMode,
  })
  const offset = offsetOf(startsIn)

  const [raw, setRaw] = useState<MeetingWithTrex[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [isLoading, setIsLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  // The quarter-hour mark the last answer was for (UTC ms), and when that
  // answer landed. ADDED 2026-09-27. `lastFetchMs` is what re-arms the
  // mark-driven refetch: a clock-skewed device can get the same `at` back,
  // and keying only on `atMs` would then never schedule another fetch.
  const [atMs, setAtMs] = useState<number | null>(null)
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null)
  const seqRef = useRef(0)
  // AppState-aware pause (CHANGED 2026-09-26). Mirrors useLivePolling's inline
  // regex edge-check rather than extracting a pure helper: this is the same
  // one-liner already established there, not new decision logic worth a
  // vitest module of its own.
  const [isActive, setIsActive] = useState(() => AppState.currentState === "active")
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)

  const refresh = useCallback(async () => {
    if (offset === null || blocked || unavailable) return
    const seq = ++seqRef.current
    setIsLoading(true)
    const outcome = await retryWithBackoff(
      () => api.getAtNextSchedules(offset),
      (result) => result.kind === "ok",
      `getAtNextSchedules(${offset})`,
      // CHANGED 2026-09-26: ends the retry ladder as soon as this call is
      // superseded (a newer refresh() bumped seqRef) instead of burning up
      // to 4 attempts against the network for a response nothing will read.
      () => seq === seqRef.current,
    )
    if (seq !== seqRef.current) return // superseded by a newer request
    setIsLoading(false)

    if ("result" in outcome && outcome.result.kind === "ok") {
      setRaw(projectOnline(outcome.result.schedules.map(toMeetingWithTrex)))
      const fetchedMs = Date.now()
      setNowMs(fetchedMs)
      setAtMs(parseAtMillis(outcome.result.at))
      setLastFetchMs(fetchedMs)
      setFailed(false)
      return
    }
    const kind = "result" in outcome ? outcome.result.kind : "unknown"
    if (classifyAtNextProblem(kind) === "hide-for-session") {
      setUnavailable(true)
      return
    }
    // Keep the last list — a failed refresh must not blank a screen that was
    // showing real rows a moment ago. CHANGED 2026-09-26 (review round 1, spec
    // "A failed fetch keeps the last list and surfaces an inline 'Couldn't
    // load — tap to retry'"): the caller surfaces a retry affordance either
    // way now — the empty-list branch in ListEmptyComponent, or an inline
    // banner over the kept rows when the list isn't empty.
    setFailed(true)
  }, [offset, blocked, unavailable])

  // New offset: never show the previous window's rows under the new label.
  useEffect(() => {
    seqRef.current++
    setRaw([])
    setAtMs(null)
    setLastFetchMs(null)
    setFailed(false)
    setIsLoading(false)
  }, [offset])

  // Subscribe once: toggles `isActive`, which the two interval effects below
  // depend on. Flipping it false→true reruns those effects from scratch,
  // which is what gives us "one immediate refetch on foreground" for free —
  // see the effect bodies.
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const cameToForeground =
        appStateRef.current.match(/inactive|background/) && nextAppState === "active"
      const wentToBackground = Boolean(nextAppState.match(/inactive|background/))
      appStateRef.current = nextAppState
      if (cameToForeground) setIsActive(true)
      else if (wentToBackground) setIsActive(false)
    }
    const subscription = AppState.addEventListener("change", handleAppStateChange)
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    // CHANGED 2026-09-26: paused while backgrounded (`isActive` false) — see
    // file header. Re-running this effect on the background→active edge
    // fires the `void refresh()` below immediately, which is the "one
    // foreground refetch" the header promises; no separate call needed.
    if (!visible || offset === null || !isActive) return
    void refresh()
    // CHANGED 2026-09-27: no interval any more — the next fetch is scheduled
    // from the answer's `at` by the effect below.
  }, [visible, offset, refresh, isActive])

  // Refetch just after the next quarter-hour boundary (ADDED 2026-09-27). Re-armed by every
  // successful answer via `lastFetchMs`; cleared when hidden, backgrounded,
  // or switched back to Live. A failed fetch doesn't re-arm — the retry
  // prompt is the way back, same as before.
  useEffect(() => {
    if (!visible || offset === null || !isActive || lastFetchMs === null) return
    const delay = refetchDelayMs(atMs, offset, Date.now())
    if (delay === null) return
    const id = setTimeout(() => void refresh(), delay)
    return () => clearTimeout(id)
  }, [visible, offset, isActive, atMs, lastFetchMs, refresh])

  useEffect(() => {
    // CHANGED 2026-09-26: paused while backgrounded, same reasoning as above.
    if (!visible || offset === null || !isActive) return
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [visible, offset, isActive])

  // CHANGED 2026-09-27: no start sort — every row starts at `atMs`.
  const meetings = useMemo(() => pruneStarted(raw, nowMs), [raw, nowMs])

  return { meetings, atMs, isLoading, failed, unavailable, blocked, refresh }
}
