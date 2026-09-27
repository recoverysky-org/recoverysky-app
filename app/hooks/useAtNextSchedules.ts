/**
 * Data for Live's Starts In view (GET /schedules/at_next). ADDED 2026-09-26.
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
 *
 * INTEGRATION REQUIREMENT: call from an `observer()` component (reads ConfigStore).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { retryWithBackoff, toMeetingWithTrex, type MeetingWithTrex } from "@/context/MeetingContext"
import { projectOnline } from "@/context/meetingPools"
import { useConfigStore } from "@/models"
import { api } from "@/services/api"
import {
  buildStartsAt,
  classifyAtNextProblem,
  offsetOf,
  pruneStarted,
  sortByStart,
  type StartsIn,
} from "@/utils/atNextLogic"
import { isLiveRefreshBlocked } from "@/utils/connectivityLogic"

/** Refetch cadence while shown: the window slides, and new meetings enter it. */
const REFETCH_MS = 5 * 60_000
/** Prune cadence: minute resolution matches `starts_at`. */
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
  const seqRef = useRef(0)

  const refresh = useCallback(async () => {
    if (offset === null || blocked || unavailable) return
    const seq = ++seqRef.current
    setIsLoading(true)
    const outcome = await retryWithBackoff(
      () => api.getAtNextSchedules(offset, buildStartsAt(new Date())),
      (result) => result.kind === "ok",
      `getAtNextSchedules(${offset})`,
    )
    if (seq !== seqRef.current) return // superseded by a newer request
    setIsLoading(false)

    if ("result" in outcome && outcome.result.kind === "ok") {
      setRaw(projectOnline(outcome.result.schedules.map(toMeetingWithTrex)))
      setNowMs(Date.now())
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
    setFailed(false)
    setIsLoading(false)
  }, [offset])

  useEffect(() => {
    if (!visible || offset === null) return
    void refresh()
    const id = setInterval(() => void refresh(), REFETCH_MS)
    return () => clearInterval(id)
  }, [visible, offset, refresh])

  useEffect(() => {
    if (!visible || offset === null) return
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [visible, offset])

  const meetings = useMemo(() => sortByStart(pruneStarted(raw, nowMs)), [raw, nowMs])

  return { meetings, isLoading, failed, unavailable, blocked, refresh }
}
