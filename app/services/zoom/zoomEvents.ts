/**
 * Zoom SDK Event System
 *
 * Provides event subscriptions for native Zoom SDK callbacks.
 * Events are emitted from native iOS/Android code via NativeEventEmitter.
 */

import { useEffect, useRef } from "react"
import { NativeEventEmitter, NativeModules } from "react-native"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "ZoomEvents" })

// Get the native module
const { RNZoomSDK } = NativeModules

// Create event emitter - only if native module exists
const zoomEventEmitter = RNZoomSDK ? new NativeEventEmitter(RNZoomSDK) : null

log.trace("Zoom event module loaded", {
  hasNativeModule: !!RNZoomSDK,
  hasEmitter: !!zoomEventEmitter,
  nativeModuleKeys: RNZoomSDK ? Object.keys(RNZoomSDK).join(",") : "none",
})

// ============================================================================
// Event Types
// ============================================================================

/** Meeting state names (mapped from native enum values) */
export type ZoomMeetingStateName =
  | "idle"
  | "connecting"
  | "waitingForHost"
  | "inMeeting"
  | "disconnecting"
  | "reconnecting"
  | "failed"
  | "ended"
  | "locked"
  | "unlocked"
  | "inWaitingRoom"
  | "webinarPromote"
  | "webinarDePromote"
  | "joinBreakoutRoom"
  | "leaveBreakoutRoom"
  | "unknown"

/** Meeting end reasons (mapped from native enum values) */
export type ZoomMeetingEndReason =
  | "selfLeave"
  | "removedByHost"
  | "endedByHost"
  | "joinBeforeHostTimeout"
  | "freeMeetingTimeout"
  | "noAttendee"
  | "hostStartedAnotherMeeting"
  | "connectionBroken"
  | "unknown"

/** Event payload for meeting state changes */
export interface ZoomMeetingStateEvent {
  /** Native state code */
  state: number
  /** Human-readable state name */
  stateName: ZoomMeetingStateName
  /** Error code (Android only, 0 = no error) */
  errorCode?: number
  /** Internal error code (Android only) */
  internalErrorCode?: number
}

/** Event payload for meeting errors */
export interface ZoomMeetingErrorEvent {
  /** Error code */
  errorCode: number
  /** Error message */
  message: string
}

/** Event payload for meeting end reasons */
export interface ZoomMeetingEndedEvent {
  /** Native reason code */
  reason: number
  /** Human-readable reason name */
  reasonName: ZoomMeetingEndReason
}

/** Event payload for auth returns */
export interface ZoomAuthEvent {
  /** Error code (0 = success) */
  errorCode: number
  /** Whether auth was successful */
  success: boolean
  /** Status message */
  message: string
}

/** All supported Zoom events */
export type ZoomEventName =
  | "onMeetingStateChange"
  | "onMeetingError"
  | "onMeetingJoinConfirmed"
  | "onMeetingEndedReason"
  | "onAuthReturn"

/** Event handler types */
export interface ZoomEventHandlers {
  onMeetingStateChange?: (event: ZoomMeetingStateEvent) => void
  onMeetingError?: (event: ZoomMeetingErrorEvent) => void
  onMeetingJoinConfirmed?: () => void
  onMeetingEndedReason?: (event: ZoomMeetingEndedEvent) => void
  onAuthReturn?: (event: ZoomAuthEvent) => void
}

// ============================================================================
// Low-level Event Subscription
// ============================================================================

/**
 * Subscribe to a Zoom SDK event
 * @returns Cleanup function to unsubscribe
 */
export function subscribeToZoomEvent<T>(
  eventName: ZoomEventName,
  handler: (event: T) => void,
): () => void {
  if (!zoomEventEmitter) {
    log.warn("Zoom event emitter not available - native module missing")
    return () => {}
  }

  log.trace("Subscribing to Zoom event", { eventName })

  // Chokepoint trace: every native→JS event goes through here.
  // Logs the raw payload before delegating to the user handler so we have
  // ground truth about what the native SDK is emitting, independent of
  // any branching in downstream code.
  const wrapped = (event: T) => {
    try {
      log.trace("Native Zoom event", {
        eventName,
        payload: JSON.stringify(event ?? null),
      })
    } catch {
      log.trace("Native Zoom event (unserializable)", { eventName })
    }
    handler(event)
  }

  const subscription = zoomEventEmitter.addListener(eventName, wrapped)

  return () => {
    log.trace("Unsubscribing from Zoom event", { eventName })
    subscription.remove()
  }
}

/**
 * Subscribe to multiple Zoom SDK events at once
 * @returns Cleanup function to unsubscribe from all
 */
export function subscribeToZoomEvents(handlers: ZoomEventHandlers): () => void {
  const cleanupFns: Array<() => void> = []

  if (handlers.onMeetingStateChange) {
    cleanupFns.push(
      subscribeToZoomEvent<ZoomMeetingStateEvent>(
        "onMeetingStateChange",
        handlers.onMeetingStateChange,
      ),
    )
  }

  if (handlers.onMeetingError) {
    cleanupFns.push(
      subscribeToZoomEvent<ZoomMeetingErrorEvent>("onMeetingError", handlers.onMeetingError),
    )
  }

  if (handlers.onMeetingJoinConfirmed) {
    cleanupFns.push(subscribeToZoomEvent("onMeetingJoinConfirmed", handlers.onMeetingJoinConfirmed))
  }

  if (handlers.onMeetingEndedReason) {
    cleanupFns.push(
      subscribeToZoomEvent<ZoomMeetingEndedEvent>(
        "onMeetingEndedReason",
        handlers.onMeetingEndedReason,
      ),
    )
  }

  if (handlers.onAuthReturn) {
    cleanupFns.push(subscribeToZoomEvent<ZoomAuthEvent>("onAuthReturn", handlers.onAuthReturn))
  }

  return () => {
    cleanupFns.forEach((cleanup) => cleanup())
  }
}

// ============================================================================
// React Hook
// ============================================================================

/**
 * React hook to subscribe to Zoom SDK events
 *
 * @example
 * ```tsx
 * useZoomEvents({
 *   onMeetingStateChange: (event) => {
 *     console.log('Meeting state:', event.stateName)
 *   },
 *   onMeetingError: (event) => {
 *     console.error('Meeting error:', event.message)
 *   },
 * })
 * ```
 */
export function useZoomEvents(handlers: ZoomEventHandlers): void {
  // Use refs to avoid re-subscribing when handlers change
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!zoomEventEmitter) {
      log.warn("useZoomEvents: Native module not available")
      return
    }

    log.info("Setting up Zoom event listeners")
    log.trace("useZoomEvents mount", {
      hasMeetingStateChange: !!handlersRef.current.onMeetingStateChange,
      hasMeetingError: !!handlersRef.current.onMeetingError,
      hasJoinConfirmed: !!handlersRef.current.onMeetingJoinConfirmed,
      hasEndedReason: !!handlersRef.current.onMeetingEndedReason,
      hasAuthReturn: !!handlersRef.current.onAuthReturn,
    })

    const stableHandlers: ZoomEventHandlers = {
      onMeetingStateChange: (event) => handlersRef.current.onMeetingStateChange?.(event),
      onMeetingError: (event) => handlersRef.current.onMeetingError?.(event),
      onMeetingJoinConfirmed: () => handlersRef.current.onMeetingJoinConfirmed?.(),
      onMeetingEndedReason: (event) => handlersRef.current.onMeetingEndedReason?.(event),
      onAuthReturn: (event) => handlersRef.current.onAuthReturn?.(event),
    }

    const cleanup = subscribeToZoomEvents(stableHandlers)

    return () => {
      log.info("Cleaning up Zoom event listeners")
      cleanup()
    }
  }, [])
}

// ============================================================================
// Debugging Utility
// ============================================================================

/**
 * Enable verbose logging of all Zoom SDK events
 * Useful for debugging native SDK behavior
 */
export function enableZoomEventDebugging(): () => void {
  log.info("Enabling Zoom SDK event debugging")

  return subscribeToZoomEvents({
    onMeetingStateChange: (event) => {
      log.debug("Meeting state changed", { state: event.state, stateName: event.stateName })
    },
    onMeetingError: (event) => {
      log.error("Meeting error", { errorCode: event.errorCode, message: event.message })
    },
    onMeetingJoinConfirmed: () => {
      log.info("Meeting join confirmed")
    },
    onMeetingEndedReason: (event) => {
      log.info("Meeting ended", { reason: event.reason, reasonName: event.reasonName })
    },
    onAuthReturn: (event) => {
      log.info("Auth return", { success: event.success, message: event.message })
    },
  })
}

/**
 * Check if Zoom event emitter is available
 */
export function isZoomEventsAvailable(): boolean {
  return zoomEventEmitter !== null
}
