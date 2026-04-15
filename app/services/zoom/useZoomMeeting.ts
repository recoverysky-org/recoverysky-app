/**
 * Zoom Meeting Hook
 *
 * Provides meeting join functionality using:
 * 1. Native Zoom SDK (when available and configured)
 * 2. External Zoom app fallback (when SDK unavailable)
 */

import { useState, useCallback } from "react"
import { Linking } from "react-native"

import { useProfileStore } from "@/models"
import { logger } from "@/utils/logger"

import { useZoomContext, type ZoomContextValue } from "./ZoomMeetingProvider"
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
 * look like. If neither is available, falls back to the stored meetingUrl,
 * then to a bare join URL.
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
  return opts.meetingUrl || `https://zoom.us/j/${opts.meetingNumber}`
}

export interface UseZoomMeetingReturn {
  /** Current meeting state */
  state: ZoomMeetingState
  /** Error message if any */
  error: string | null
  /** Whether currently joining a meeting */
  isJoining: boolean
  /** Whether native SDK is available */
  isSDKReady: boolean
  /** Join a meeting (uses SDK if available, otherwise external app) */
  joinMeeting: (config: ZoomJoinConfig) => Promise<ZoomJoinResult>
  /** Open a URL directly in the Zoom app */
  openInZoomApp: (url: string) => Promise<void>
  /** Reset state to idle */
  reset: () => void
}

/**
 * Try to get Zoom context, returning null if not available
 */
function useOptionalZoomContext(): ZoomContextValue | null {
  try {
    return useZoomContext()
  } catch {
    return null
  }
}

/**
 * Hook for joining Zoom meetings.
 *
 * Attempts to use native Zoom SDK when available.
 * Falls back to opening meetings in external Zoom app.
 *
 * @example
 * ```tsx
 * const { joinMeeting, isSDKReady, state } = useZoomMeeting()
 *
 * const handleJoin = async () => {
 *   const result = await joinMeeting({
 *     meetingNumber: "123456789",
 *     userName: "John Doe",
 *     password: "abc123"
 *   })
 *   if (result.success) {
 *     console.log("Joined successfully")
 *   }
 * }
 * ```
 */
export function useZoomMeeting(): UseZoomMeetingReturn {
  const zoomContext = useOptionalZoomContext()
  const profileStore = useProfileStore()
  const [state, setState] = useState<ZoomMeetingState>("idle")
  const [error, setError] = useState<string | null>(null)

  const isSDKReady = zoomContext?.isReady ?? false

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
      log.info("Join meeting request", {
        mid: config.meetingId,
        zid: config.meetingNumber,
        userName: config.userName,
        sdkReady: isSDKReady,
        ts: Date.now(),
      })

      setState("joining")
      setError(null)

      try {
        // When "Use External Zoom" is on, every meeting opens in the installed
        // Zoom app instead of the in-app SDK. Attendance is not tracked in this
        // mode — the SDK path is what records attendance events.
        if (profileStore.useExternalZoom) {
          log.trace("Routing: external Zoom app (useExternalZoom=on)", {
            mid: config.meetingId,
            external: !!config.external,
            hasPassword: !!config.password,
            hasPasswordEnc: !!config.passwordEnc,
          })
          log.info("Opening meeting in external Zoom app", { mid: config.meetingId })
          const zoomUrl = buildExternalZoomUrl({
            meetingNumber: config.meetingNumber,
            meetingUrl: config.meetingUrl,
            password: config.password,
            passwordEnc: config.passwordEnc,
          })
          await openInZoomApp(zoomUrl)
          setState("idle")
          return { success: true }
        }

        // Try native SDK first if available
        if (isSDKReady && zoomContext) {
          log.trace("Routing: native SDK", { mid: config.meetingId })
          log.info("Using native Zoom SDK", { mid: config.meetingId })
          await zoomContext.joinMeeting(config)
          log.trace("zoomContext.joinMeeting resolved", { mid: config.meetingId })
          setState("inMeeting")
          return { success: true }
        }

        // Fallback to external Zoom app (use original URL which has encrypted pwd)
        log.trace("Routing: external Zoom app (SDK unavailable fallback)", {
          mid: config.meetingId,
          isSDKReady,
          hasContext: !!zoomContext,
        })
        log.info("SDK not available, using external app", { mid: config.meetingId })
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
        log.error("Failed to join meeting", { mid: config.meetingId, error: errorMessage })
        log.trace("joinMeeting threw", {
          mid: config.meetingId,
          error: errorMessage,
          stack: err instanceof Error ? (err.stack ?? "") : "",
        })
        setError(errorMessage)
        setState("error")
        return { success: false, error: errorMessage }
      }
    },
    [isSDKReady, zoomContext, openInZoomApp, profileStore.useExternalZoom],
  )

  return {
    state,
    error: error || zoomContext?.error || null,
    isJoining: state === "joining",
    isSDKReady,
    joinMeeting,
    openInZoomApp,
    reset,
  }
}
