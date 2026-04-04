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

import { FC, ReactNode, useState, useEffect, createContext, useContext, useCallback } from "react"
import { Alert, Platform } from "react-native"
import * as Crypto from "expo-crypto"
import * as Device from "expo-device"
import { ZoomSDKProvider, useZoom } from "@zoom/meetingsdk-react-native"

import {
  attendanceRepo,
  attendanceEvents,
  zoomAuthRepo,
  type AttendanceEvent,
  type ZoomAuthRecord,
} from "@/db"
import { translate } from "@/i18n"
import { useAuthenticationStore, useConfigStore, useProfileStore } from "@/models"
import { meetingEvents } from "@/db/meetingEvents"
import { getZakToken } from "@/services/zak"
import { logger } from "@/utils/logger"

import { trackEvent } from "@/services/tracking"

import { generateZoomJwt } from "./generateJwt"
import { checkMediaPermissions, requestMediaPermissions } from "./permissions"
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

/** Minimum credit time in milliseconds */
const MIN_CREDIT_MS = (Number(process.env.EXPO_PUBLIC_MIN_CREDIT_MINUTES) || 1) * 60 * 1000

/** Architectures supported by the Zoom SDK */
const ZOOM_SUPPORTED_ARCHS = ["arm64-v8a", "armeabi-v7a"]

/**
 * Check if the current device architecture supports the Zoom SDK.
 * Zoom SDK only ships ARM libraries (no x86_64 for emulators).
 */
const isArchitectureSupported = (): boolean => {
  // iOS always supported
  if (Platform.OS === "ios") return true

  // Web not supported
  if (Platform.OS === "web") return false

  // Android: check CPU architecture
  if (Platform.OS === "android") {
    const archs = Device.supportedCpuArchitectures || []
    // Check if any supported arch is available
    const hasSupported = archs.some((arch) =>
      ZOOM_SUPPORTED_ARCHS.some((supported) =>
        arch.toLowerCase().includes(supported.toLowerCase()),
      ),
    )
    log.info("Architecture check", { archs: archs.join(","), hasSupported })
    return hasSupported
  }

  return false
}

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
 * Module-level meeting context — survives provider remounts.
 * If ZoomSDKConsumer remounts (e.g., SDK reinit), event listeners on the new
 * instance still see the context that was set by the old instance's joinMeeting.
 */
let meetingContext: MeetingContext | null = null
let wasInMeeting = false

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
  /** Reinitialize the SDK (used after permission changes) */
  reinitializeSDK: () => void
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
const ZoomSDKConsumer: FC<{ children: ReactNode; reinitializeSDK: () => void }> = ({
  children,
  reinitializeSDK,
}) => {
  const zoom = useZoom()
  const authStore = useAuthenticationStore()
  const configStore = useConfigStore()
  const profileStore = useProfileStore()
  const [error, setError] = useState<string | null>(null)
  const [meetingState, setMeetingState] = useState<ZoomMeetingStateName>("idle")
  const [lastMeetingError, setLastMeetingError] = useState<ZoomMeetingErrorEvent | null>(null)

  // Helper to create an attendance event
  const createEvent = (message: string, data: Record<string, unknown>): AttendanceEvent => ({
    timestamp: Date.now(),
    message,
    json: JSON.stringify(data),
  })

  // Helper to add event to context and persist async
  const addEvent = (message: string, data: Record<string, unknown>) => {
    const ctx = meetingContext
    if (!ctx) {
      log.debug("addEvent: no context", { message })
      return
    }

    const event = createEvent(message, data)
    ctx.events.push(event)

    // Persist event async (fire and forget)
    attendanceRepo.addEvent(ctx.attendanceId, event).catch(() => {
      // Silently fail - events are also in memory
    })
  }

  // Show dialog when meeting is too short for credit (only if attendance tracking is enabled)
  const showShortMeetingWarning = useCallback(
    (creditMins: number) => {
      if (!profileStore.attendanceEnabled) return
      if (profileStore.dontShowShortMeetingWarning) return

      const minMinutes = Math.ceil(MIN_CREDIT_MS / 60000)
      Alert.alert(
        translate("zoomMeeting:shortMeetingTitle"),
        translate("zoomMeeting:shortMeetingMessage", { minutes: creditMins, required: minMinutes }),
        [
          { text: translate("common:ok"), style: "default" },
          {
            text: translate("common:dontShowAgain"),
            style: "cancel",
            onPress: () => profileStore.setDontShowShortMeetingWarning(true),
          },
        ],
      )
    },
    [profileStore.attendanceEnabled, profileStore.dontShowShortMeetingWarning],
  )

  // Process attendance record when meeting ends
  // Note: attendanceEnabled is checked at creation time in joinMeeting().
  // No re-check here — if the record was created, it should be processed.
  const processAttendance = async (ctx: MeetingContext) => {
    const eventMessages = ctx.events.map((e) => e.message)
    log.debug("Processing attendance events", {
      attendanceId: ctx.attendanceId,
      mid: ctx.mid,
      eventCount: ctx.events.length,
      events: eventMessages.join(", "),
      joinedAt: ctx.joinedAt,
      inMeetingAt: ctx.inMeetingAt ?? "never",
    })

    // Find start event: first "inMeeting" — waiting room cycles never produce this
    // state, so first match is always from the real meeting. Using find() (not
    // findLast) preserves the original join time across reconnections.
    const startEvent = ctx.events.find((e) => {
      if (e.message !== "Meeting state") return false
      try {
        const data = JSON.parse(e.json)
        return data.state === "inMeeting"
      } catch {
        return false
      }
    })

    // Find end event: last "Meeting ended" (must be after start to avoid
    // picking up stale end events from waiting room cycles)
    const endEvent = ctx.events.findLast((e) => e.message === "Meeting ended")

    // Both events required for valid attendance
    if (!startEvent || !endEvent) {
      log.warn("Missing attendance events — marking invalid", {
        attendanceId: ctx.attendanceId,
        hasStart: !!startEvent,
        hasEnd: !!endEvent,
        startTimestamp: startEvent?.timestamp ?? "none",
        endTimestamp: endEvent?.timestamp ?? "none",
      })
      try {
        const fallbackStart = startEvent?.timestamp || ctx.joinedAt
        const fallbackEnd = endEvent?.timestamp || Date.now()
        await attendanceRepo.markProcessed(ctx.attendanceId, {
          start: fallbackStart,
          end: fallbackEnd,
          credit: 0,
          valid: false,
        })
        log.info("Attendance marked invalid (missing events)", { attendanceId: ctx.attendanceId })
        attendanceEvents.emit({
          type: "processed",
          id: ctx.attendanceId,
          mid: ctx.mid,
          valid: false,
        })
      } catch (err) {
        log.error("Attendance save failed (missing events path)", {
          attendanceId: ctx.attendanceId,
          error: String(err),
        })
      }
      return
    }

    const start = startEvent.timestamp
    const end = endEvent.timestamp
    const credit = end - start
    const valid = credit >= MIN_CREDIT_MS
    const creditMins = Math.round(credit / 60000)

    log.info("Processing attendance", {
      attendanceId: ctx.attendanceId,
      mid: ctx.mid,
      creditMins,
      valid,
      start,
      end,
      creditMs: credit,
    })

    try {
      await attendanceRepo.markProcessed(ctx.attendanceId, { start, end, credit, valid })
      log.info("Attendance saved", { attendanceId: ctx.attendanceId, valid, creditMins })
      attendanceEvents.emit({ type: "processed", id: ctx.attendanceId, mid: ctx.mid, valid })

      if (!valid) {
        log.debug("Meeting too short for credit", { attendanceId: ctx.attendanceId, creditMins })
        showShortMeetingWarning(creditMins)
      }
    } catch (err) {
      log.error("Attendance save failed", {
        attendanceId: ctx.attendanceId,
        error: String(err),
      })
    }
  }

  // Subscribe to native SDK events
  useZoomEvents({
    onMeetingStateChange: (event: ZoomMeetingStateEvent) => {
      log.info("Meeting state", { state: event.stateName, code: event.state })
      addEvent("Meeting state", { state: event.stateName, code: event.state })
      setMeetingState(event.stateName)

      // Track when we actually enter the meeting
      if (event.stateName === "inMeeting") {
        wasInMeeting = true
        if (meetingContext) {
          // Only set on first inMeeting — preserve original join time across reconnections
          if (!meetingContext.inMeetingAt) {
            meetingContext.inMeetingAt = Date.now()
            log.debug("inMeeting", { attendanceId: meetingContext.attendanceId })
          } else {
            log.debug("inMeeting (reconnect, keeping original timestamp)", {
              attendanceId: meetingContext.attendanceId,
            })
          }
        } else {
          log.debug("inMeeting but no context")
        }
      }

      // Process and clear when meeting ends
      if (event.stateName === "ended" || event.stateName === "idle") {
        log.debug("End state received", {
          state: event.stateName,
          hasContext: !!meetingContext,
          inMeetingAt: meetingContext?.inMeetingAt ?? "none",
          attendanceId: meetingContext?.attendanceId ?? "none",
        })
        if (meetingContext) {
          // If user was never actually in the meeting (e.g. waiting room cycle),
          // keep the context alive for the next SDK cycle instead of processing
          if (!meetingContext.inMeetingAt) {
            log.debug("Meeting ended before inMeeting, keeping context for next cycle")
            return
          }

          // Capture and null immediately — prevents double processing if
          // "ended" and "idle" fire in quick succession
          const ctx = meetingContext
          meetingContext = null

          // Inject synthetic end event — guarantees processAttendance() always
          // has an end event regardless of onMeetingEndedReason timing.
          // Push directly to ctx.events since meetingContext is already nulled
          // (addEvent would no-op without a live meetingContext).
          const syntheticEnd = createEvent("Meeting ended", {
            reason: 0,
            reasonName: "*selfLeave",
          })
          ctx.events.push(syntheticEnd)
          attendanceRepo.addEvent(ctx.attendanceId, syntheticEnd).catch(() => {})

          log.debug("Starting processAttendance", { attendanceId: ctx.attendanceId })
          processAttendance(ctx).catch((err) => {
            log.error("processAttendance failed", {
              attendanceId: ctx.attendanceId,
              error: String(err),
            })
          })
        } else {
          log.debug("End state but no context to process")
        }
      }
    },
    onMeetingError: (event: ZoomMeetingErrorEvent) => {
      // Error code 0 means success - don't log as error
      if (event.errorCode === 0) {
        log.info("Meeting status", { code: event.errorCode, message: event.message })
        addEvent("Meeting status", { code: event.errorCode, message: event.message })
      } else {
        log.error("Meeting error", { code: event.errorCode, message: event.message })
        addEvent("Meeting error", { code: event.errorCode, message: event.message })
        setLastMeetingError(event)
        setError(event.message)
      }
    },
    onMeetingJoinConfirmed: () => {
      log.info("Join confirmed", { code: 0 })
      addEvent("Join confirmed", { code: 0 })
    },
    onMeetingEndedReason: (event: ZoomMeetingEndedEvent) => {
      log.debug("Meeting ended", {
        reason: event.reasonName,
        code: event.reason,
        hasContext: !!meetingContext,
        attendanceId: meetingContext?.attendanceId ?? "none",
      })
      addEvent("Meeting ended", { reason: event.reasonName, code: event.reason })
      setMeetingState("idle")

      if (wasInMeeting) {
        wasInMeeting = false
        log.info("Meeting completed, emitting housekeeping event", { reason: event.reasonName })
        meetingEvents.completed(event.reasonName)
      }
    },
    onAuthReturn: (event: ZoomAuthEvent) => {
      log.info("Auth", { success: event.success })
      addEvent("Auth", { success: event.success, message: event.message })
    },
  })

  // Send periodic heartbeat events to Umami while in a meeting
  // so analytics reports the user as active in the app
  useEffect(() => {
    if (meetingState !== "inMeeting") return

    const HEARTBEAT_MS = 5 * 60 * 1000
    const interval = setInterval(() => {
      const elapsed = meetingContext?.inMeetingAt
        ? Math.floor((Date.now() - meetingContext.inMeetingAt) / 1000)
        : 0
      trackEvent("meeting_heartbeat", { elapsed_seconds: elapsed })
    }, HEARTBEAT_MS)

    return () => clearInterval(interval)
  }, [meetingState])

  const joinMeeting = useCallback(
    async (config: ZoomJoinConfig) => {
      // Check and request media permissions BEFORE joining
      // This prevents the black screen issue when permissions are granted after SDK init
      const perms = await checkMediaPermissions()
      log.info("Pre-join permission check", {
        camera: perms.camera,
        audio: perms.audio,
        anyUndetermined: perms.anyUndetermined,
      })

      if (perms.anyUndetermined) {
        log.info("Requesting media permissions before join")
        const result = await requestMediaPermissions()

        if (result.justGranted) {
          // Permissions just granted — do NOT reinitialize SDK here.
          // reinitializeSDK() remounts the provider which disrupts the join flow.
          // Modern Zoom SDK picks up newly granted permissions without reinit.
          // meetingContext is module-level as an additional safeguard against remounts.
          log.info("Permissions just granted, proceeding without SDK reinit")
        }

        if (!result.camera.granted || !result.audio.granted) {
          log.warn("Media permissions denied", {
            camera: result.camera.granted,
            audio: result.audio.granted,
          })
          // Continue anyway - user can still join audio-only or with limited features
        }
      }

      // Optional overrides for testing: join a specific ZID with a specific password
      const overrideZid = process.env.EXPO_PUBLIC_JOIN_MEETING_ZID
      const overridePw = process.env.EXPO_PUBLIC_JOIN_MEETING_PW
      const zidToJoin = overrideZid || config.meetingNumber
      const now = Date.now()
      const uid = authStore.userId || "anonymous"

      // Only track attendance if user has enabled it
      if (profileStore.attendanceEnabled) {
        // Create attendance record in SQLite
        const attendanceId = Crypto.randomUUID()
        log.debug("Creating attendance record", {
          attendanceId,
          uid,
          mid: config.meetingId,
          zid: zidToJoin,
          meetingName: config.meetingName ?? "",
        })
        let createOk = false
        try {
          const result = await attendanceRepo.create({
            id: attendanceId,
            uid,
            mid: config.meetingId,
            zid: zidToJoin,
            meetingName: config.meetingName ?? "",
            created: now,
            events: [createEvent("Join initiated", { userName: config.userName })],
          })
          if (!result.ok) throw new Error("Failed to create attendance record")
          createOk = true
          log.info("Attendance created", { attendanceId, mid: config.meetingId, zid: zidToJoin })
          attendanceEvents.emit({ type: "created", id: attendanceId })
        } catch (err) {
          log.error("Attendance create failed", {
            attendanceId,
            mid: config.meetingId,
            error: String(err),
          })
        }

        // Only set up meeting context if the SQLite record was created successfully.
        // Without a DB row, processAttendance() would silently fail on markProcessed().
        if (createOk) {
          const prevContext = meetingContext
          if (prevContext) {
            log.warn("Overwriting existing meeting context", {
              prevAttendanceId: prevContext.attendanceId,
              newAttendanceId: attendanceId,
            })
          }
          meetingContext = {
            attendanceId,
            uid,
            mid: config.meetingId,
            zid: zidToJoin,
            userName: config.userName,
            joinedAt: now,
            inMeetingAt: null,
            events: [],
          }
          log.debug("Meeting context set", { attendanceId })
        }
      } else {
        log.debug("Attendance tracking disabled, skipping record creation")
      }

      log.info("Joining meeting", {
        zid: zidToJoin,
        userName: config.userName,
        attendanceEnabled: profileStore.attendanceEnabled,
      })
      addEvent("Calling SDK", { zid: zidToJoin })

      try {
        // Check SDK initialization state
        const isInit = await zoom.isInitialized()
        log.info("SDK init check", { isInitialized: isInit })
        if (!isInit) {
          throw new Error("Zoom SDK not initialized")
        }

        await generateZoomJwt(zidToJoin, 0, configStore.zoomSdkKey, configStore.zoomSdkSecret)

        // Check if ZAK usage is enabled via environment variable
        const useZak = process.env.EXPO_PUBLIC_USE_ZAK !== "false"

        // Get ZAK token via unified /zak/me endpoint
        // Handles both authenticated (user's Zoom account) and anonymous (service account) flows
        let zakToken: string | undefined = config.zak
        if (!zakToken && useZak) {
          // Get stored Zoom auth if available (null for anonymous users)
          let zoomAuth: ZoomAuthRecord | null = null
          if (authStore.deviceId) {
            const zoomAuthResult = await zoomAuthRepo.findById(authStore.deviceId)
            if (zoomAuthResult.ok && zoomAuthResult.value) {
              zoomAuth = zoomAuthResult.value
            }
          }

          // Fetch ZAK from /zak/me endpoint (works for both authenticated and anonymous)
          const zak = await getZakToken(
            zoomAuth,
            authStore.deviceId ?? undefined,
            configStore.zakApiKey,
          )
          if (zak) {
            zakToken = zak
            log.info("ZAK token obtained", {
              mode: zoomAuth ? "authenticated" : "anonymous",
              zoomEmail: zoomAuth?.zoomEmail,
            })
          } else {
            log.warn("ZAK fetch failed, joining without ZAK")
          }
        } else if (!useZak) {
          log.info("ZAK disabled via EXPO_PUBLIC_USE_ZAK=false")
        }

        // Pass both password and ZAK — they serve different purposes:
        // ZAK identifies the user, password grants access to the meeting.
        const sdkPassword = overridePw || config.password || ""

        log.info("Calling SDK joinMeeting", {
          meetingNumber: zidToJoin,
          userName: config.userName,
          password: sdkPassword ? "SET" : "empty",
          useZak,
          hasZak: !!zakToken,
          zakPreview: zakToken ? zakToken.slice(0, 20) + "..." : "none",
        })

        const statusCode = await zoom.joinMeeting({
          meetingNumber: zidToJoin,
          userName: config.userName,
          password: sdkPassword,
          zoomAccessToken: zakToken,
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
        const errorStack = err instanceof Error ? err.stack : undefined
        log.error("Join exception", { error: errorMessage, stack: errorStack })
        addEvent("Join exception", { error: errorMessage })
        setError(errorMessage)

        if (meetingContext) {
          const ctx = meetingContext
          meetingContext = null
          await processAttendance(ctx)
          log.debug("Join error path: context processed", { attendanceId: ctx.attendanceId })
        }
        throw err
      }
    },
    [zoom, authStore.userId, profileStore.attendanceEnabled, reinitializeSDK],
  )

  const contextValue: ZoomContextValue = {
    initState: "ready",
    error,
    isReady: true,
    joinMeeting,
    meetingState,
    lastMeetingError,
    reinitializeSDK,
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

  const reinitializeSDK = useCallback(() => {
    // No-op in fallback mode
  }, [])

  const contextValue: ZoomContextValue = {
    initState,
    error,
    isReady: false,
    joinMeeting,
    meetingState: "idle",
    lastMeetingError: null,
    reinitializeSDK,
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
// Check architecture and device type once at module load time
const ARCH_SUPPORTED = isArchitectureSupported()
const IS_SIMULATOR = !Device.isDevice

export const ZoomMeetingProvider: FC<{ children: ReactNode }> = ({ children }) => {
  // Zoom SDK crashes on iOS simulator — skip initialization entirely
  if (IS_SIMULATOR) {
    return (
      <ZoomFallbackProvider initState="error" error="Zoom SDK disabled on simulator">
        {children}
      </ZoomFallbackProvider>
    )
  }

  // Early return for unsupported architectures - before any hooks
  // This prevents ZoomSDKProvider from ever being rendered on unsupported devices
  if (!ARCH_SUPPORTED) {
    return (
      <ZoomFallbackProvider
        initState="error"
        error="Zoom SDK not supported on this device architecture"
      >
        {children}
      </ZoomFallbackProvider>
    )
  }

  return <ZoomMeetingProviderInner>{children}</ZoomMeetingProviderInner>
}

/**
 * Inner provider that only renders on supported architectures
 */
const ZoomMeetingProviderInner: FC<{ children: ReactNode }> = ({ children }) => {
  const configStore = useConfigStore()
  const [jwtToken, setJwtToken] = useState<string | null>(null)
  const [initState, setInitState] = useState<ZoomInitState>("idle")
  const [error, setError] = useState<string | null>(null)
  // SDK version key - incrementing this forces ZoomSDKProvider to remount
  // Used to reinitialize SDK after permissions are granted
  const [sdkVersion, setSdkVersion] = useState(0)

  const { zoomSdkKey, zoomSdkSecret } = configStore

  // Callback to reinitialize SDK (e.g., after permissions granted)
  const reinitializeSDK = useCallback(() => {
    log.info("Reinitializing SDK", { previousVersion: sdkVersion })
    setSdkVersion((v) => v + 1)
  }, [sdkVersion])

  useEffect(() => {
    // Check if SDK is configured
    const configured = isZoomConfigured(zoomSdkKey, zoomSdkSecret)
    log.info("Zoom SDK init check", {
      configured,
      hasKey: !!zoomSdkKey,
      hasSecret: !!zoomSdkSecret,
    })

    if (!configured) {
      log.warn("Zoom SDK not configured - using external app fallback")
      setInitState("error")
      setError("Zoom SDK keys not configured")
      return
    }

    log.info("Initializing Zoom SDK")
    setInitState("initializing")

    // Generate initial JWT token (meeting number "0" for initialization)
    generateZoomJwt("0", 0, zoomSdkKey, zoomSdkSecret)
      .then((token) => {
        log.info("Zoom SDK ready", { jwtPreview: token.slice(0, 8) + "..." })
        setJwtToken(token)
        setInitState("ready")
      })
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : "JWT generation failed"
        log.error("Zoom SDK initialization failed", { error: errorMessage })
        setError(errorMessage)
        setInitState("error")
      })
  }, [zoomSdkKey, zoomSdkSecret])

  // If SDK not ready, use fallback provider
  if (!jwtToken || initState !== "ready") {
    return (
      <ZoomFallbackProvider initState={initState} error={error}>
        {children}
      </ZoomFallbackProvider>
    )
  }

  const config = getZoomConfig(zoomSdkKey, zoomSdkSecret)

  return (
    <ZoomSDKProvider
      key={sdkVersion}
      config={{
        jwtToken,
        domain: config.domain,
        enableLog: config.enableLog,
        logSize: config.logSize,
      }}
    >
      <ZoomSDKConsumer reinitializeSDK={reinitializeSDK}>{children}</ZoomSDKConsumer>
    </ZoomSDKProvider>
  )
}
