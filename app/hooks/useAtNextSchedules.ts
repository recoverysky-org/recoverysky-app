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
 * - CHANGED 2026-09-27 (later, Jenova): prefetches ALL FOUR offsets. The
 *   signature went from `(startsIn, visible)` to `(active)`: selecting a chip
 *   no longer fetches anything, it just picks which prefetched slot to show,
 *   and LiveScreen hides the chips whose slot has no (filtered) meetings.
 *   So: one parallel batch of four when Live comes on screen or the app
 *   returns to the foreground, then one batch just after each quarter-hour
 *   boundary (atNextLogic.nextRefetchDelayMs), and on pull-to-refresh. The
 *   per-offset clearing and the offset-change sequence bump are gone with the
 *   per-offset fetch; the sequence ref now guards whole batches. A partial
 *   failure keeps that slot's previous rows and sets `failed`; any 404 means
 *   the route is missing and sets `unavailable`.
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
  AT_NEXT_OFFSETS,
  classifyAtNextProblem,
  nextRefetchDelayMs,
  parseAtMillis,
  pruneStarted,
  type AtNextOffset,
} from "@/utils/atNextLogic"
import { isLiveRefreshBlocked } from "@/utils/connectivityLogic"

/** Prune cadence: a minute tick suffices to drop rows once their mark passes. */
const TICK_MS = 60_000

/** One offset's answer: its rows and the quarter-hour mark they start at. */
export interface AtNextSlot {
  meetings: MeetingWithTrex[]
  /** UTC ms of the mark (the response's `at`); null before the first answer. */
  atMs: number | null
}

export type AtNextSlots = Record<AtNextOffset, AtNextSlot>

const EMPTY_SLOTS: AtNextSlots = {
  15: { meetings: [], atMs: null },
  30: { meetings: [], atMs: null },
  45: { meetings: [], atMs: null },
  60: { meetings: [], atMs: null },
}

/**
 * @param active - fetch only while true: Live on screen AND the Starts In
 *   feature enabled (`startsInVisible`). Nothing is fetched while false.
 */
export function useAtNextSchedules(active: boolean) {
  const configStore = useConfigStore()
  const blocked = isLiveRefreshBlocked({
    maintenanceMode: configStore.maintenanceMode,
    outageMode: configStore.outageMode,
  })

  const [rawSlots, setRawSlots] = useState<AtNextSlots>(EMPTY_SLOTS)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [isLoading, setIsLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  // When the last batch with at least one answer landed. Re-arms the boundary
  // timer even when the marks come back unchanged (a clock-skewed device).
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null)
  const seqRef = useRef(0)
  // AppState-aware pause (CHANGED 2026-09-26), same edge-check as
  // useLivePolling.
  const [isForeground, setIsForeground] = useState(() => AppState.currentState === "active")
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)

  const refresh = useCallback(async () => {
    if (blocked || unavailable) return
    const seq = ++seqRef.current
    setIsLoading(true)
    const outcomes = await Promise.all(
      AT_NEXT_OFFSETS.map((offset) =>
        retryWithBackoff(
          () => api.getAtNextSchedules(offset),
          (result) => result.kind === "ok",
          `getAtNextSchedules(${offset})`,
          // Ends the retry ladder once a newer batch supersedes this one.
          () => seq === seqRef.current,
        ),
      ),
    )
    if (seq !== seqRef.current) return // superseded by a newer batch
    setIsLoading(false)

    let anyOk = false
    let anyFailed = false
    let missingRoute = false
    const updates: Partial<AtNextSlots> = {}
    AT_NEXT_OFFSETS.forEach((offset, i) => {
      const outcome = outcomes[i]
      if ("result" in outcome && outcome.result.kind === "ok") {
        anyOk = true
        updates[offset] = {
          meetings: projectOnline(outcome.result.schedules.map(toMeetingWithTrex)),
          atMs: parseAtMillis(outcome.result.at),
        }
        return
      }
      const kind = "result" in outcome ? outcome.result.kind : "unknown"
      if (classifyAtNextProblem(kind) === "hide-for-session") missingRoute = true
      else anyFailed = true
    })

    if (missingRoute) {
      setUnavailable(true)
      return
    }
    // A failed offset keeps its previous rows: a transient miss shouldn't make
    // a chip vanish and reappear a quarter-hour later.
    if (anyOk) {
      const fetchedMs = Date.now()
      setRawSlots((prev) => ({ ...prev, ...updates }))
      setNowMs(fetchedMs)
      setLastFetchMs(fetchedMs)
    }
    setFailed(anyFailed)
  }, [blocked, unavailable])

  // Subscribe once; flipping `isForeground` reruns the effects below.
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const cameToForeground =
        appStateRef.current.match(/inactive|background/) && nextAppState === "active"
      const wentToBackground = Boolean(nextAppState.match(/inactive|background/))
      appStateRef.current = nextAppState
      if (cameToForeground) setIsForeground(true)
      else if (wentToBackground) setIsForeground(false)
    }
    const subscription = AppState.addEventListener("change", handleAppStateChange)
    return () => subscription.remove()
  }, [])

  // One batch whenever Live comes on screen or the app returns to the
  // foreground. `nowMs` is bumped first so rows kept from an earlier visit
  // are pruned against the real clock before the batch lands.
  useEffect(() => {
    if (!active || !isForeground) return
    setNowMs(Date.now())
    void refresh()
  }, [active, isForeground, refresh])

  // One batch just after the next quarter-hour boundary, re-armed by each
  // batch that returned anything. A batch where every offset failed doesn't
  // re-arm; the retry prompt is the way back.
  const atByOffset = useMemo(
    () => ({
      15: rawSlots[15].atMs,
      30: rawSlots[30].atMs,
      45: rawSlots[45].atMs,
      60: rawSlots[60].atMs,
    }),
    [rawSlots],
  )
  useEffect(() => {
    if (!active || !isForeground || lastFetchMs === null) return
    const delay = nextRefetchDelayMs(atByOffset, Date.now())
    if (delay === null) return
    const id = setTimeout(() => void refresh(), delay)
    return () => clearTimeout(id)
  }, [active, isForeground, atByOffset, lastFetchMs, refresh])

  useEffect(() => {
    if (!active || !isForeground) return
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [active, isForeground])

  const slots = useMemo<AtNextSlots>(() => {
    const prune = (slot: AtNextSlot): AtNextSlot => ({
      meetings: pruneStarted(slot.meetings, nowMs),
      atMs: slot.atMs,
    })
    return {
      15: prune(rawSlots[15]),
      30: prune(rawSlots[30]),
      45: prune(rawSlots[45]),
      60: prune(rawSlots[60]),
    }
  }, [rawSlots, nowMs])

  return { slots, isLoading, failed, unavailable, blocked, refresh }
}
