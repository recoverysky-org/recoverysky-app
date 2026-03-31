/**
 * Meeting Events
 *
 * Simple pub/sub for meeting lifecycle events.
 * Emitted once per meeting after the user was in a meeting and has left.
 */

export type MeetingEventType = "completed"

export interface MeetingEvent {
  type: MeetingEventType
  /** Zoom end reason (e.g. "selfLeave", "endedByHost") */
  reason?: string
}

type MeetingEventListener = (event: MeetingEvent) => void

const listeners = new Set<MeetingEventListener>()

function emit(event: MeetingEvent): void {
  listeners.forEach((listener) => listener(event))
}

function subscribe(listener: MeetingEventListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function completed(reason?: string): void {
  emit({ type: "completed", reason })
}

export const meetingEvents = {
  emit,
  subscribe,
  completed,
}
