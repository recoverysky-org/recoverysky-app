/**
 * Live Page Events
 *
 * Simple pub/sub for Live page refresh triggers.
 * Components emit events when user preferences change that affect Live view.
 * LiveScreen subscribes to refresh when needed.
 */

export type LiveEventType =
  | "preferences_changed"  // User changed fellowship, language, etc.
  | "refresh_requested"    // Manual refresh trigger
  | "data_updated"         // Meeting data was updated

export interface LiveEvent {
  type: LiveEventType
  /** Optional reason for debugging */
  reason?: string
}

type LiveEventListener = (event: LiveEvent) => void

const listeners = new Set<LiveEventListener>()

/**
 * Emit a live event to all subscribers
 */
function emit(event: LiveEvent): void {
  listeners.forEach((listener) => listener(event))
}

/**
 * Subscribe to live events
 * @returns Unsubscribe function
 */
function subscribe(listener: LiveEventListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Convenience: emit preferences changed event
 */
function preferencesChanged(reason?: string): void {
  emit({ type: "preferences_changed", reason })
}

/**
 * Convenience: request a refresh
 */
function requestRefresh(reason?: string): void {
  emit({ type: "refresh_requested", reason })
}

export const liveEvents = {
  emit,
  subscribe,
  preferencesChanged,
  requestRefresh,
}
