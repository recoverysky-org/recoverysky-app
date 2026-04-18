/**
 * TimerSessionResumer Component
 *
 * Headless. On app startup (once the database is ready), check MMKV for an
 * External Zoom attendance timer that was running when the process was last
 * killed. If one is found:
 *  - Below the credit threshold: drop silently (nothing useful to save).
 *  - At or above the credit threshold: prompt the user to save or discard.
 *    "Save" finalizes the attendance with endedAt = now via
 *    saveTimerAttendance, mirroring what the modal would have done.
 *
 * Place inside DatabaseProvider alongside the other *Resumer / *Hydrator
 * components, below ProfileHydrator so we have a user context.
 */

import { useEffect, useRef } from "react"
import { Alert } from "react-native"

import { translate } from "@/i18n"
import {
  clearTimerSession,
  EXTERNAL_MIN_CREDIT_MS,
  loadTimerSession,
  saveTimerAttendance,
} from "@/services/zoom"
import { extractZoomMeetingNumber } from "@/services/zoom/useZoomMeeting"
import { logger } from "@/utils/logger"

import { useDatabase } from "./DatabaseProvider"

const log = logger.child({ module: "TimerSessionResumer" })

export function TimerSessionResumer(): null {
  const { status } = useDatabase()
  const hasRun = useRef(false)

  useEffect(() => {
    if ((status !== "open" && status !== "seeded") || hasRun.current) return
    hasRun.current = true

    const session = loadTimerSession()
    if (!session) return

    const elapsedMs = Date.now() - session.startedAt
    if (elapsedMs < EXTERNAL_MIN_CREDIT_MS) {
      log.info("Dropping persisted timer session below credit threshold", {
        mid: session.meetingId,
        elapsedMs,
      })
      clearTimerSession()
      return
    }

    log.info("Persisted timer session found, prompting user", {
      mid: session.meetingId,
      elapsedMs,
    })

    const endedAt = Date.now()
    const minutes = Math.floor(elapsedMs / 60000)

    Alert.alert(
      translate("externalZoomTimer:recoverTitle"),
      translate("externalZoomTimer:recoverMessage", {
        minutes,
        name: session.meetingName || "your meeting",
      }),
      [
        {
          text: translate("externalZoomTimer:recoverDiscard"),
          style: "destructive",
          onPress: () => {
            log.info("User discarded recovered timer session", {
              mid: session.meetingId,
            })
            clearTimerSession()
          },
        },
        {
          text: translate("externalZoomTimer:recoverSave"),
          onPress: async () => {
            try {
              const result = await saveTimerAttendance({
                uid: session.uid,
                mid: session.meetingId,
                zid: extractZoomMeetingNumber(session.meetingUrl) ?? "",
                meetingName: session.meetingName,
                startedAt: session.startedAt,
                endedAt,
              })
              if (result.ok) {
                log.info("Recovered timer attendance saved", {
                  attendanceId: result.attendanceId,
                  mid: session.meetingId,
                })
                clearTimerSession()
              } else {
                log.error("Failed to save recovered timer attendance", {
                  mid: session.meetingId,
                })
                // Leave the session persisted so the user gets another chance
                // on the next cold start.
                Alert.alert(
                  translate("externalZoomTimer:recoverTitle"),
                  translate("externalZoomTimer:recoveryError"),
                )
              }
            } catch (error) {
              log.error("Error saving recovered timer attendance", {
                error: String(error),
                mid: session.meetingId,
              })
              Alert.alert(
                translate("externalZoomTimer:recoverTitle"),
                translate("externalZoomTimer:recoveryError"),
              )
            }
          },
        },
      ],
      { cancelable: false },
    )
  }, [status])

  return null
}
