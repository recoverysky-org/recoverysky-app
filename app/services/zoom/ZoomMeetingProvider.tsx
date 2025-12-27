/**
 * Zoom Meeting Provider
 *
 * Wraps the app with Zoom SDK context, handling:
 * - JWT token generation and refresh
 * - SDK initialization
 * - Meeting join functionality
 * - Native SDK event subscriptions
 * - Attendance tracking data collection
 *
 * Falls back gracefully when SDK keys are not configured.
 */

import { FC, ReactNode, useState, useEffect, createContext, useContext, useCallback, useRef } from "react"
import { ZoomSDKProvider, useZoom } from "@zoom/meetingsdk-react-native"
import * as Crypto from "expo-crypto"

import { attendanceRepo, type AttendanceEvent } from "@/db"
import { useAuthenticationStore } from "@/models"
import { logger } from "@/utils/logger"

import { generateZoomJwt } from "./generateJwt"
import { getZoomConfig, isZoomConfigured } from "./zoomConfig"
import {
  useZoomEvents,
  type ZoomMeetingStateName,
  type ZoomMeetingStateEvent,
  type ZoomMeetingErrorEvent,
  type ZoomMeetingEndedEvent,
  type ZoomAuthEvent,
} from "./zoomEvents"
import type { ZoomInitState, ZoomJoinConfig } from "./zoomTypes"

const log = logger.child({ module: "ZoomMeetingProvider" })

/** Minimum credit time in milliseconds (5 minutes) */
const MIN_CREDIT_MS = 5 * 60 * 1000

/** Current meeting context for attendance tracking */
interface MeetingContext {
  attendanceId: string // SQLite attendance record ID
  uid: string // User ID
  mid: string // Our internal meeting ID
  zid: string // Zoom meeting ID
  userName: string
  joinedAt: number // Timestamp when join was initiated
  inMeetingAt: number | null // Timestamp when actually in meeting
  events: AttendanceEvent[] // Buffered events
}

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
  /** Current meeting state from native SDK events */
  meetingState: ZoomMeetingStateName
  /** Last meeting error from native SDK */
  lastMeetingError: ZoomMeetingErrorEvent | null
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
  const authStore = useAuthenticationStore()
  const [error, setError] = useState<string | null>(null)
  const [meetingState, setMeetingState] = useState<ZoomMeetingStateName>("idle")
  const [lastMeetingError, setLastMeetingError] = useState<ZoomMeetingErrorEvent | null>(null)

  // Track current meeting context for attendance
  const meetingContextRef = useRef<MeetingContext | null>(null)

  // Helper to create an attendance event
  const createEvent = (message: string, data: Record<string, unknown>): AttendanceEvent => ({
    timestamp: Date.now(),
    message,
    json: JSON.stringify(data),
  })

  // Helper to add event to context and persist async
  const addEvent = (message: string, data: Record<string, unknown>) => {
    const ctx = meetingContextRef.current
    if (!ctx) return

    const event = createEvent(message, data)
    ctx.events.push(event)

    // Persist event async (fire and forget)
    attendanceRepo.addEvent(ctx.attendanceId, event).catch(() => {
      // Silently fail - events are also in memory
    })
  }

  // Process attendance record when meeting ends
  const processAttendance = async () => {
    const ctx = meetingContextRef.current
    if (!ctx) return

    const now = Date.now()
    const start = ctx.inMeetingAt || ctx.joinedAt
    const end = now
    const credit = end - start
    const valid = credit >= MIN_CREDIT_MS
    const creditMins = Math.round(credit / 60000)

    log.info("Processing attendance", { creditMins, valid, events: ctx.events.length })

    try {
      await attendanceRepo.markProcessed(ctx.attendanceId, { start, end, credit, valid })
      log.info("Attendance saved", { valid, creditMins })
    } catch (err) {
      log.error("Attendance save failed", { error: String(err) })
    }
  }

  // Subscribe to native SDK events
  useZoomEvents({
    onMeetingStateChange: (event: ZoomMeetingStateEvent) => {
      log.info("Meeting state", { state: event.stateName, code: event.state })
      addEvent("Meeting state", { state: event.stateName, code: event.state })
      setMeetingState(event.stateName)

      // Track when we actually enter the meeting
      if (event.stateName === "inMeeting" && meetingContextRef.current) {
        meetingContextRef.current.inMeetingAt = Date.now()
      }

      // Process and clear when meeting ends
      if (event.stateName === "ended" || event.stateName === "idle") {
        if (meetingContextRef.current) {
          processAttendance().finally(() => {
            meetingContextRef.current = null
          })
        }
      }
    },
    onMeetingError: (event: ZoomMeetingErrorEvent) => {
      // Error code 0 means success - don't log as error
      if (event.errorCode === 0) {
        log.info("Meeting status", { code: event.errorCode })
        addEvent("Meeting status", { code: event.errorCode, message: event.message })
      } else {
        log.error("Meeting error", { code: event.errorCode, message: event.message })
        addEvent("Meeting error", { code: event.errorCode, message: event.message })
        setLastMeetingError(event)
        setError(event.message)
      }
    },
    onMeetingJoinConfirmed: () => {
      log.info("Join confirmed")
      addEvent("Join confirmed", {})
    },
    onMeetingEndedReason: (event: ZoomMeetingEndedEvent) => {
      log.info("Meeting ended", { reason: event.reasonName, code: event.reason })
      addEvent("Meeting ended", { reason: event.reasonName, code: event.reason })
      setMeetingState("idle")
    },
    onAuthReturn: (event: ZoomAuthEvent) => {
      log.info("Auth", { success: event.success })
      addEvent("Auth", { success: event.success, message: event.message })
    },
  })

  const joinMeeting = useCallback(
    async (config: ZoomJoinConfig) => {
      // Check for override meeting ID (for testing)
      const overrideZid = process.env.EXPO_PUBLIC_JOIN_MEETING_ZID
      const zidToJoin = overrideZid || config.meetingNumber
      const now = Date.now()
      const uid = authStore.userId || "anonymous"

      // Create attendance record in SQLite
      const attendanceId = Crypto.randomUUID()
      try {
        const result = await attendanceRepo.create({
          id: attendanceId,
          uid,
          mid: config.meetingId,
          zid: zidToJoin,
          created: now,
          events: [createEvent("Join initiated", { userName: config.userName })],
        })
        if (!result.ok) throw new Error("Failed to create attendance record")
        log.info("Attendance created", { id: attendanceId })
      } catch (err) {
        log.error("Attendance create failed", { error: String(err) })
      }

      // Set up meeting context for attendance tracking
      meetingContextRef.current = {
        attendanceId,
        uid,
        mid: config.meetingId,
        zid: zidToJoin,
        userName: config.userName,
        joinedAt: now,
        inMeetingAt: null,
        events: [],
      }

      log.info("Joining meeting", { zid: zidToJoin, userName: config.userName })
      addEvent("Calling SDK", { zid: zidToJoin })

      try {
        await generateZoomJwt(zidToJoin, 0)

        const statusCode = await zoom.joinMeeting({
          meetingNumber: zidToJoin,
          userName: config.userName,
          password: config.password || "",
        })

        log.info("Join sent", { statusCode: statusCode ?? 0 })
        addEvent("Join sent", { statusCode: statusCode ?? 0 })

        if (statusCode !== undefined && statusCode !== 0) {
          const errorMsg = `SDK error: ${statusCode}`
          log.error("Join failed", { statusCode })
          addEvent("Join failed", { statusCode })
          setError(errorMsg)
          throw new Error(errorMsg)
        }

        log.info("Join accepted")
        addEvent("Join accepted", {})
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to join"
        log.error("Join exception", { error: errorMessage })
        addEvent("Join exception", { error: errorMessage })
        setError(errorMessage)

        await processAttendance()
        meetingContextRef.current = null
        throw err
      }
    },
    [zoom, authStore.userId]
  )

  const contextValue: ZoomContextValue = {
    initState: "ready",
    error,
    isReady: true,
    joinMeeting,
    meetingState,
    lastMeetingError,
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
    meetingState: "idle",
    lastMeetingError: null,
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
