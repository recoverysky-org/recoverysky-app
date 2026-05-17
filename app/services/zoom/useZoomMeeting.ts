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

import { useProfileStore } from "@/models"
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
 * Encode a UTF-8 string as base64. Hermes ships `btoa` but it only handles
 * Latin-1; the encodeURIComponent/unescape dance is the canonical
 * cross-runtime workaround for Unicode names (e.g. "José", "Žaneta") so
 * non-ASCII display names don't throw `InvalidCharacterError` here.
 */
function toBase64Utf8(s: string): string {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return btoa(unescape(encodeURIComponent(s)))
}

/**
 * Build the URL used to launch a meeting in the external Zoom app. Prefers
 * `passwordEnc` (the encrypted share-link pwd) when present; otherwise falls
 * back to the plaintext `password`. Either is appended as `?pwd=<value>` on a
 * freshly-constructed join URL so it matches what Zoom's own share links
 * look like. If neither is available, falls back to the stored meetingUrl,
 * then to a bare join URL.
 *
 * Display name (`?un=<base64>`): best-effort prefill of the participant
 * name. Officially Zoom only documents `un=` for the web client
 * (zoom.us/wc/...) but some native clients honor it as well, and including
 * it costs nothing if they don't. Users on Android whose Zoom app has
 * never been configured with "Remember my name for future meetings" are
 * the audience here — iOS users typically have a cached identity already
 * so the prompt doesn't show. We base64-encode UTF-8 to match the format
 * the web client accepts; URL-safe characters in base64 (`+`, `/`, `=`)
 * are then percent-encoded by URL.searchParams below.
 */
export function buildExternalZoomUrl(opts: {
  meetingNumber: string
  meetingUrl?: string | null
  password?: string | null
  passwordEnc?: string | null
  userName?: string | null
}): string {
  const pwd = opts.passwordEnc || opts.password
  const trimmedName = opts.userName?.trim() || ""
  const unParam = trimmedName ? `&un=${encodeURIComponent(toBase64Utf8(trimmedName))}` : ""

  if (pwd && opts.meetingNumber) {
    return `https://zoom.us/j/${opts.meetingNumber}?pwd=${encodeURIComponent(pwd)}${unParam}`
  }
  // No pwd path: we still want the un= prefill if we have a name. Tack
  // it onto the bare join URL or the supplied meetingUrl as appropriate.
  if (opts.meetingNumber) {
    return `https://zoom.us/j/${opts.meetingNumber}${unParam ? `?${unParam.slice(1)}` : ""}`
  }
  if (opts.meetingUrl && trimmedName) {
    const sep = opts.meetingUrl.includes("?") ? "&" : "?"
    return `${opts.meetingUrl}${sep}un=${encodeURIComponent(toBase64Utf8(trimmedName))}`
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
  const profileStore = useProfileStore()
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
      log.info("Join meeting request (external Zoom)", {
        mid: config.meetingId,
        zid: config.meetingNumber,
        userName: config.userName,
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
          userName: config.userName ?? profileStore.displayName,
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
    [openInZoomApp, profileStore.displayName],
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
