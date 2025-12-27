/**
 * Zoom Meeting Hook
 *
 * Provides meeting join functionality using:
 * 1. Native Zoom SDK (when available and configured)
 * 2. External Zoom app fallback (when SDK unavailable)
 */

import { useState, useCallback } from "react"
import { Linking } from "react-native"

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

  const patterns = [
    /zoom\.us\/j\/(\d+)/i,
    /zoom\.us\/my\/(\w+)/i,
    /\/j\/(\d+)/i,
  ]

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
      const canOpen = await Linking.canOpenURL(url)
      if (canOpen) {
        await Linking.openURL(url)
      } else {
        const meetingNumber = extractZoomMeetingNumber(url)
        if (meetingNumber) {
          const zoomUrl = `zoomus://zoom.us/join?confno=${meetingNumber}`
          await Linking.openURL(zoomUrl)
        } else {
          throw new Error("Unable to open Zoom meeting")
        }
      }
    } catch (err) {
      log.error("Failed to open Zoom app", { error: String(err) })
      throw err
    }
  }, [])

  const joinMeeting = useCallback(
    async (config: ZoomJoinConfig): Promise<ZoomJoinResult> => {
      console.log("=== JOIN MEETING REQUEST ===")
      console.log(`[useZoomMeeting] Meeting: ${config.meetingNumber}`)
      console.log(`[useZoomMeeting] User: ${config.userName}`)
      console.log(`[useZoomMeeting] SDK Ready: ${isSDKReady}`)
      console.log(`[useZoomMeeting] Context available: ${!!zoomContext}`)

      log.info("Joining Zoom meeting", {
        meetingNumber: config.meetingNumber,
        userName: config.userName,
        usingSDK: isSDKReady,
      })

      setState("joining")
      setError(null)

      try {
        // Try native SDK first if available
        if (isSDKReady && zoomContext) {
          console.log("[useZoomMeeting] ✓ Using NATIVE Zoom SDK")
          log.info("Using native Zoom SDK")
          await zoomContext.joinMeeting(config)
          setState("inMeeting")
          console.log("[useZoomMeeting] ✓ Joined via native SDK")
          console.log("============================")
          return { success: true }
        }

        // Fallback to external Zoom app
        console.log("[useZoomMeeting] ⚠️ SDK not ready, using EXTERNAL app fallback")
        log.info("Native SDK not available, falling back to external app")
        const zoomUrl = `https://zoom.us/j/${config.meetingNumber}${config.password ? `?pwd=${config.password}` : ""}`
        console.log(`[useZoomMeeting] Opening URL: ${zoomUrl}`)
        await openInZoomApp(zoomUrl)

        setState("idle")
        return { success: true }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error"
        log.error("Failed to join meeting", { error: errorMessage })
        setError(errorMessage)
        setState("error")
        return { success: false, error: errorMessage }
      }
    },
    [isSDKReady, zoomContext, openInZoomApp]
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
