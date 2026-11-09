/**
 * Opens a meeting from one of Sky's cards in the app's own popup.
 *
 * ADDED 2026-11-08. A card's meeting is meetings-mcp's Meeting (`SkyMeeting`,
 * `utils/agentMeetingsLogic.ts`): an id, a venue and display fields, with none of the schedule,
 * password or grid that SchedulePopup and InPersonPopup work from. So a tap looks the schedule up by
 * id in the meeting's own pool, `GET /schedules/meeting/{mid}`, and projects it the way every other
 * Meetings surface does (`toMeetingWithTrex`). That is the lookup the deep links already make
 * (LiveScreen, InPersonScreen), and the agent tells the person that tapping a card "opens that
 * meeting in the app" (its cards rule, agent `packages/agent/src/meetingTools.ts`).
 *
 * The card's `venue` decides the pool and the popup: an online meeting opens SchedulePopup, an
 * in-person one InPersonPopup. Before this the screen opened SchedulePopup with the tool result's
 * entry cast to `MeetingWithTrex`, which no tool ever sent.
 *
 * Privacy: the meeting id goes in the lookup's path, as it does for the deep links. The api client
 * logs it at debug, as it does for every lookup by id (`getScheduleByMeetingId`, and the request
 * trace line's path). This hook's own failure line logs its reason alone. The id may be one of the
 * person's hearted meetings, and the favorite ids are never logged as a set (agent spec
 * 2026-11-07-sky-on-meetings-mcp-design.md).
 * CHANGED 2026-11-08 (review): this said the id went "nowhere else", which the client's debug lines
 * contradict.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useIsFocused } from "@react-navigation/native"

import { useToast } from "@/components/Toast"
import { toMeetingWithTrex, type MeetingWithTrex } from "@/context/MeetingContext"
import { isInPersonVenue } from "@/context/meetingPools"
import { feedbackCache } from "@/db"
import { useConfigStore } from "@/models"
import { api } from "@/services/api"
import type { SkyMeeting } from "@/utils/agentMeetingsLogic"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "SkyMeetingPopup" })

/** The popup to show: which one, over which meeting, and the card it was opened from */
export interface SkyMeetingPopup {
  venue: SkyMeeting["venue"]
  meeting: MeetingWithTrex
  /** The card's tool call, which collapses when the popup closes */
  toolCallId: string
}

/**
 * Failures that the same lookup will hit again: the meeting is in no active schedule (404), the
 * server answered with no schedule, or it answered from the other pool. A retry cannot fix them, so
 * the toast says the meeting is not on the schedule and the hook asks no more for that meeting.
 * Every other failure (offline, a timeout, a 5xx, a refused token) may pass, so its toast asks for
 * a retry and nothing is remembered.
 * ADDED 2026-11-08 (review): every failure said "Check your connection and try again", and each
 * retry of a dead card was one more 404 to the api, the pattern CrowdSec's http-probing ban counts
 * (CLAUDE.md, the sync body backfill).
 */
const LASTING_FAILURES: ReadonlySet<string> = new Set(["not-found", "bad-data", "venue"])

/** One meeting in one pool. The same id in the other pool is a different lookup. */
const keyOf = (meeting: SkyMeeting) => `${meeting.venue}:${meeting.id}`

export function useSkyMeetingPopup(): {
  popup: SkyMeetingPopup | null
  openMeeting: (meeting: SkyMeeting, toolCallId: string) => void
  closePopup: () => void
} {
  const configStore = useConfigStore()
  const { showToast } = useToast()
  const isFocused = useIsFocused()
  const [popup, setPopup] = useState<SkyMeetingPopup | null>(null)

  // Bumped by every tap, close, blur and unmount, so only the newest tap's answer lands. Two taps
  // in a row open the second card, and a lookup that lands after a close opens nothing.
  const latestRef = useRef(0)
  // The lookup in flight, as card and meeting, so tapping the same row again while it loads sends
  // nothing. A row shows no spinner, and the lookup can take the api timeout. ADDED 2026-11-08.
  const pendingRef = useRef<string | null>(null)
  // Meetings a lookup already showed cannot open, for as long as this chat is mounted (a New
  // conversation remounts it). ADDED 2026-11-08, see LASTING_FAILURES.
  const unopenableRef = useRef(new Set<string>())

  const cancelPending = useCallback(() => {
    latestRef.current++
    pendingRef.current = null
  }, [])

  useEffect(() => cancelPending, [cancelPending])

  // ADDED 2026-11-08 (review): a lookup that lands after the tab lost focus opens nothing. Bottom
  // tabs stay mounted, so its answer used to set the popup on a hidden screen: the Modal drew over
  // the other tab for a commit, then the popup's own blur effect closed it, and the close collapsed
  // the card to "Selected: X", a meeting the person never saw. A failure's toast showed on
  // whichever tab was up. SchedulePopup also counted the view and armed the rating soft-ask.
  useEffect(() => {
    if (!isFocused) cancelPending()
  }, [isFocused, cancelPending])

  const openMeeting = useCallback(
    (meeting: SkyMeeting, toolCallId: string) => {
      const meetingKey = keyOf(meeting)
      const pendingKey = `${toolCallId}|${meetingKey}`
      if (pendingRef.current === pendingKey) return

      const request = ++latestRef.current
      pendingRef.current = null

      const notScheduled = () => showToast({ tx: "agentScreen:meetingNotScheduled", type: "error" })

      // Known before any request: the answer said so (`scheduled: false`), or a lookup did.
      if (!meeting.scheduled || unopenableRef.current.has(meetingKey)) {
        notScheduled()
        return
      }

      const fail = (reason: string) => {
        if (request !== latestRef.current) return
        pendingRef.current = null
        log.warn("Sky meeting card did not open", { reason })
        if (LASTING_FAILURES.has(reason)) {
          unopenableRef.current.add(meetingKey)
          notScheduled()
        } else {
          showToast({ tx: "agentScreen:meetingOpenFailed", type: "error" })
        }
      }

      // CLAUDE.md "Features that self-disable under maintenanceMode": the api is not answering, so
      // nothing is sent and the toast says the meeting did not open. Nothing is latched; a tap
      // after maintenance ends looks it up.
      if (configStore.maintenanceMode) {
        fail("maintenance")
        return
      }

      pendingRef.current = pendingKey
      // Encoded, because the id comes from a tool's answer and goes into the path as it stands
      // (`/schedules/meeting/${mid}`): a `/`, `?` or `#` in it would ask for another route. A UUID
      // is unchanged by it. ADDED 2026-11-08 (review).
      api
        .getScheduleByMeetingId(encodeURIComponent(meeting.id), meeting.venue)
        .then((result) => {
          if (request !== latestRef.current) return
          if (result.kind !== "ok") {
            fail(result.kind)
            return
          }
          const schedule = result.schedule
          // Self-verify the pool, as the deep links do: a server that ignores `venueType` answers
          // from the online pool, and InPersonPopup on an online record (or SchedulePopup on a
          // venue) is a dead end with no join link or no address.
          if (isInPersonVenue(schedule.meeting.venueType) !== (meeting.venue === "in_person")) {
            fail("venue")
            return
          }
          pendingRef.current = null
          // Schedule-wide hearts and stars first, so the projection's feedback snapshot has them.
          feedbackCache.reconcileSchedules([schedule])
          setPopup({ venue: meeting.venue, meeting: toMeetingWithTrex(schedule), toolCallId })
        })
        .catch(() => fail("threw"))
    },
    [configStore, showToast],
  )

  const closePopup = useCallback(() => {
    cancelPending()
    setPopup(null)
  }, [cancelPending])

  return { popup, openMeeting, closePopup }
}
