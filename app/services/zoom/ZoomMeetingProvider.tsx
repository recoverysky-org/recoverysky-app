/**
 * Zoom Meeting Provider
 *
 * Wraps the app with Zoom SDK context, handling:
 * - JWT token generation and refresh
 * - SDK initialization
 * - Meeting join functionality
 *
 * Falls back gracefully when SDK keys are not configured.
 */

import { FC, ReactNode, useState, useEffect, createContext, useContext, useCallback } from "react"
import { ZoomSDKProvider, useZoom } from "@zoom/meetingsdk-react-native"

import { logger } from "@/utils/logger"

import { generateZoomJwt } from "./generateJwt"
import { getZoomConfig, isZoomConfigured } from "./zoomConfig"
import type { ZoomInitState, ZoomJoinConfig } from "./zoomTypes"

const log = logger.child({ module: "ZoomMeetingProvider" })

/**
 * Context value provided by ZoomMeetingProvider
 */
export interface ZoomContextValue {
  /** Current SDK initialization state */
  initState: ZoomInitState
  /** Error message if initialization failed */
  error: string | null
  /** Whether SDK is ready for use */
  isReady: boolean
  /** Join a Zoom meeting using native SDK */
  joinMeeting: (config: ZoomJoinConfig) => Promise<void>
}

const ZoomContext = createContext<ZoomContextValue | null>(null)

/**
 * Hook to access Zoom SDK context
 * @throws Error if used outside ZoomMeetingProvider
 */
export const useZoomContext = (): ZoomContextValue => {
  const context = useContext(ZoomContext)
  if (!context) {
    throw new Error("useZoomContext must be used within ZoomMeetingProvider")
  }
  return context
}

/**
 * Inner component that consumes the Zoom SDK hook
 */
const ZoomSDKConsumer: FC<{ children: ReactNode }> = ({ children }) => {
  const zoom = useZoom()
  const [error, setError] = useState<string | null>(null)

  const joinMeeting = useCallback(
    async (config: ZoomJoinConfig) => {
      // Check for override meeting ID
      const overrideZid = process.env.EXPO_PUBLIC_JOIN_MEETING_ZID
      const meetingToJoin = overrideZid || config.meetingNumber

      console.log("=== ZOOM SDK JOIN ===")
      console.log(`[ZoomSDKConsumer] Original meeting number: ${config.meetingNumber}`)
      console.log(`[ZoomSDKConsumer] Override ZID (env): ${overrideZid || "NOT SET"}`)
      console.log(`[ZoomSDKConsumer] ACTUAL meeting to join: ${meetingToJoin}`)

      log.info("Joining meeting via native SDK", {
        meetingNumber: meetingToJoin,
        userName: config.userName,
      })

      try {
        // Generate fresh JWT for this specific meeting
        console.log(`[ZoomSDKConsumer] Generating JWT for meeting: ${meetingToJoin}`)
        const freshJwt = await generateZoomJwt(meetingToJoin, 0)
        console.log(`[ZoomSDKConsumer] JWT generated (first 50 chars): ${freshJwt.slice(0, 50)}...`)
        console.log(`[ZoomSDKConsumer] Full JWT for decoding:`)
        console.log(freshJwt)

        console.log(`[ZoomSDKConsumer] Calling zoom.joinMeeting with ZID: ${meetingToJoin}`)
        const statusCode = await zoom.joinMeeting({
          meetingNumber: meetingToJoin,
          userName: config.userName,
          password: config.password || "",
        })

        console.log(`[ZoomSDKConsumer] joinMeeting returned status code: ${statusCode}`)
        log.info("joinMeeting returned", { statusCode })

        // Status code 0 or undefined = success (native bridge sometimes doesn't pass the value)
        // Non-zero values are errors
        if (statusCode !== undefined && statusCode !== 0) {
          const errorMsg = `Zoom SDK returned error code: ${statusCode}`
          console.error(`[ZoomSDKConsumer] ❌ ${errorMsg}`)
          setError(errorMsg)
          throw new Error(errorMsg)
        }

        console.log("[ZoomSDKConsumer] ✓ Join request accepted by SDK")
        console.log("[ZoomSDKConsumer] ℹ️  If meeting closes immediately, check Xcode console for:")
        console.log("   - onMeetingStateChange: X (state codes)")
        console.log("   - onMeetingError: X (error codes)")
        console.log("   - Common issues: meeting ended, invalid meeting, auth required")
        log.info("Successfully joined meeting")
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to join meeting"
        console.error("[ZoomSDKConsumer] ❌ Exception:", errorMessage)
        log.error("Failed to join meeting via SDK", { error: errorMessage })
        setError(errorMessage)
        throw err
      }
    },
    [zoom]
  )

  const contextValue: ZoomContextValue = {
    initState: "ready",
    error,
    isReady: true,
    joinMeeting,
  }

  return <ZoomContext.Provider value={contextValue}>{children}</ZoomContext.Provider>
}

/**
 * Fallback context when SDK is not available
 */
const ZoomFallbackProvider: FC<{
  children: ReactNode
  initState: ZoomInitState
  error: string | null
}> = ({ children, initState, error }) => {
  const joinMeeting = useCallback(async () => {
    throw new Error("Zoom SDK not initialized - use external app fallback")
  }, [])

  const contextValue: ZoomContextValue = {
    initState,
    error,
    isReady: false,
    joinMeeting,
  }

  return <ZoomContext.Provider value={contextValue}>{children}</ZoomContext.Provider>
}

/**
 * Zoom Meeting Provider
 *
 * Wraps children with Zoom SDK context. Handles JWT generation
 * and SDK initialization automatically.
 *
 * @example
 * ```tsx
 * <ZoomMeetingProvider>
 *   <App />
 * </ZoomMeetingProvider>
 * ```
 */
export const ZoomMeetingProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [jwtToken, setJwtToken] = useState<string | null>(null)
  const [initState, setInitState] = useState<ZoomInitState>("idle")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    console.log("=== ZOOM SDK INITIALIZATION ===")

    // Check if SDK is configured
    const configured = isZoomConfigured()
    console.log(`[ZoomProvider] isZoomConfigured: ${configured}`)

    if (!configured) {
      log.warn("Zoom SDK keys not configured - SDK features disabled")
      console.warn("[ZoomProvider] ❌ SDK NOT CONFIGURED - will use external Zoom app fallback")
      setInitState("error")
      setError("Zoom SDK keys not configured")
      return
    }

    console.log("[ZoomProvider] ✓ SDK keys found, initializing...")
    log.info("Initializing Zoom SDK")
    setInitState("initializing")

    // Generate initial JWT token (meeting number "0" for initialization)
    generateZoomJwt("0", 0)
      .then((token) => {
        log.info("Zoom JWT generated, SDK ready")
        console.log("[ZoomProvider] ✓ JWT generated successfully")
        console.log(`[ZoomProvider] JWT preview: ${token.slice(0, 20)}...`)
        setJwtToken(token)
        setInitState("ready")
        console.log("[ZoomProvider] ✓ SDK READY - native meetings enabled")
        console.log("===============================")
      })
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : "JWT generation failed"
        log.error("Zoom SDK initialization failed", { error: errorMessage })
        console.error("[ZoomProvider] ❌ JWT generation failed:", errorMessage)
        console.log("===============================")
        setError(errorMessage)
        setInitState("error")
      })
  }, [])

  // If SDK not ready, use fallback provider
  if (!jwtToken || initState !== "ready") {
    return (
      <ZoomFallbackProvider initState={initState} error={error}>
        {children}
      </ZoomFallbackProvider>
    )
  }

  const config = getZoomConfig()

  return (
    <ZoomSDKProvider
      config={{
        jwtToken,
        domain: config.domain,
        enableLog: config.enableLog,
        logSize: config.logSize,
      }}
    >
      <ZoomSDKConsumer>{children}</ZoomSDKConsumer>
    </ZoomSDKProvider>
  )
}
