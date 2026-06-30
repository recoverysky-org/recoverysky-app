/**
 * Meeting Events
 *
 * Simple pub/sub for meeting lifecycle events.
 * Emitted once per meeting after the user was in a meeting and has left.
 */

import { logger } from "@/utils/logger"

const log = logger.child({ module: "meetingEvents" })

export type MeetingEventType = "completed"

export interface MeetingEvent {
  type: MeetingEventType
  /** Zoom end reason (e.g. "selfLeave", "endedByHost") */
  reason?: string
}

type MeetingEventListener = (event: MeetingEvent) => void

const listeners = new Set<MeetingEventListener>()

function emit(event: MeetingEvent): void {
  // Each listener runs in its own try/catch: a throwing subscriber must NEVER
  // break the emitter or the code that fired the event. `completed()` is invoked
  // synchronously from inside saveTimerAttendance's critical path, so an
  // unhandled listener throw would abort the save and leave the timer modal
  // stuck open. (Regression: the rating engine subscribes with a SYNCHRONOUS
  // recordEvent — unlike the old review service's async handler, whose throws
  // were harmless rejections — so an error there used to propagate into the
  // save. Isolating listeners here makes the save immune to any subscriber bug.)
  listeners.forEach((listener) => {
    try {
      listener(event)
    } catch (err) {
      log.error("meetingEvents listener threw (isolated)", { error: String(err) })
    }
  })
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
