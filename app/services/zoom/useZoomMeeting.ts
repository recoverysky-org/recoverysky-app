/**
 * Zoom Meeting Hook (External-only)
 *
 * The native Zoom Meeting SDK was removed in 4.5.0 after a fatal Android
 * startup crash (libzReflection.so) caused by autolinking the SDK's
 * native module. Every join now opens the installed Zoom app via
 * `Linking.openURL`. Attendance is captured via the timer modal flow
 * (see `externalAttendance.ts`) when `attendanceEnabled` is on; the
 * timer modal is rendered by `SchedulePopup` based on profile state.
 *
 * This hook keeps its original shape (`{ joinMeeting, openInZoomApp,
 * isJoining, state, error, reset }`) so callers don't need to be
 * rewritten — the `isSDKReady` field is gone but no caller branched on
 * it after the SDK removal.
 */

import { useCallback, useState } from "react"
import { Linking } from "react-native"

import { logger } from "@/utils/logger"

import type { ZoomJoinConfig, ZoomJoinResult, ZoomMeetingState } from "./zoomTypes"

const log = logger.child({ module: "ZoomMeeting" })

/**
 * Extract Zoom meeting number from various URL formats
 */
export function extractZoomMeetingNumber(url: string): string | null {
  if (!url) return null
  if (/^\d+$/.test(url)) return url

  const patterns = [/zoom\.us\/j\/(\d+)/i, /zoom\.us\/my\/(\w+)/i, /\/j\/(\d+)/i]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match?.[1]) return match[1]
  }

  return null
}

/**
 * Extract password from Zoom URL if present
 */
export function extractZoomPassword(url: string): string | null {
  if (!url) return null
  const match = url.match(/[?&]pwd=([^&]+)/i)
  return match?.[1] ?? null
}

/**
 * Build the URL used to launch a meeting in the external Zoom app. Prefers
 * `passwordEnc` (the encrypted share-link pwd) when present; otherwise falls
 * back to the plaintext `password`. Either is appended as `?pwd=<value>` on a
 * freshly-constructed join URL so it matches what Zoom's own share links
 * look like. If neither is available, a bare join URL is used when there is
 * a meeting number, and the stored meetingUrl otherwise; changing that order
 * would change which link opens for a meeting with no passcode.
 * (CORRECTED 2026-10-11: this said meetingUrl came first, which the code
 * below does not do.)
 *
 * CHANGED 2026-10-11: the display-name prefill (Zoom's `un` query parameter)
 * is removed (Zoom never applied it). No join link carries a name, so guest
 * mode needs no name rule.
 */
export function buildExternalZoomUrl(opts: {
  meetingNumber: string
  meetingUrl?: string | null
  password?: string | null
  passwordEnc?: string | null
}): string {
  const pwd = opts.passwordEnc || opts.password

  if (pwd && opts.meetingNumber) {
    return `https://zoom.us/j/${opts.meetingNumber}?pwd=${encodeURIComponent(pwd)}`
  }
  // No passcode: a meeting number still wins over meetingUrl (see the doc
  // comment above).
  if (opts.meetingNumber) {
    return `https://zoom.us/j/${opts.meetingNumber}`
  }
  return opts.meetingUrl || `https://zoom.us/j/${opts.meetingNumber}`
}

export interface UseZoomMeetingReturn {
  /** Current meeting state */
  state: ZoomMeetingState
  /** Error message, if any, from the most recent join attempt */
  error: string | null
  /** Whether a join is currently in flight */
  isJoining: boolean
  /** Open the meeting in the installed external Zoom app */
  joinMeeting: (config: ZoomJoinConfig) => Promise<ZoomJoinResult>
  /** Open a URL directly in the Zoom app (escape hatch) */
  openInZoomApp: (url: string) => Promise<void>
  /** Reset state to idle */
  reset: () => void
}

/**
 * Hook for joining Zoom meetings via the external Zoom app.
 *
 * Returned state is largely cosmetic — the join is effectively
 * fire-and-forget once `Linking.openURL` resolves, so `state` flips back
 * to `"idle"` immediately after dispatch. Errors only surface if
 * `Linking.openURL` itself throws (e.g. malformed URL or no app handler
 * registered).
 */
export function useZoomMeeting(): UseZoomMeetingReturn {
  const [state, setState] = useState<ZoomMeetingState>("idle")
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setState("idle")
    setError(null)
  }, [])

  const openInZoomApp = useCallback(async (url: string) => {
    log.info("Opening meeting in Zoom app", { url })
    try {
      await Linking.openURL(url)
    } catch (err) {
      log.error("Failed to open Zoom app", { error: String(err) })
      throw err
    }
  }, [])

  const joinMeeting = useCallback(
    async (config: ZoomJoinConfig): Promise<ZoomJoinResult> => {
      // CHANGED 2026-10-11: no name field. This line used to log `userName`;
      // join links carry no name now (see buildExternalZoomUrl).
      log.info("Join meeting request (external Zoom)", {
        mid: config.meetingId,
        zid: config.meetingNumber,
        ts: Date.now(),
      })

      setState("joining")
      setError(null)

      try {
        const zoomUrl = buildExternalZoomUrl({
          meetingNumber: config.meetingNumber,
          meetingUrl: config.meetingUrl,
          password: config.password,
          passwordEnc: config.passwordEnc,
        })
        await openInZoomApp(zoomUrl)
        setState("idle")
        return { success: true }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error"
        log.error("Failed to open external Zoom", { mid: config.meetingId, error: errorMessage })
        setError(errorMessage)
        setState("error")
        return { success: false, error: errorMessage }
      }
    },
    [openInZoomApp],
  )

  return {
    state,
    error,
    isJoining: state === "joining",
    joinMeeting,
    openInZoomApp,
    reset,
  }
}
