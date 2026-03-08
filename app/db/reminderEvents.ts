/**
 * Reminder Events
 *
 * Simple pub/sub for reminder changes.
 * Components subscribe to receive updates when reminders are created, updated, or deleted.
 */

import type { ReminderRecord } from "./repositories"

export type ReminderChangeType = "created" | "updated" | "deleted"

export interface ReminderChange {
  type: ReminderChangeType
  id: string
  /** The full record (available on 'created' and 'updated' events) */
  record?: ReminderRecord
  /** Meeting ID */
  mid?: string
  /** Schedule ID (set when reminder covers all meetings at a time) */
  sid?: string
}

type ReminderChangeListener = (event: ReminderChange) => void

const listeners = new Set<ReminderChangeListener>()

/**
 * Emit a reminder change to all subscribers
 */
function emit(event: ReminderChange): void {
  listeners.forEach((listener) => listener(event))
}

/**
 * Subscribe to reminder changes
 * @returns Unsubscribe function
 */
function subscribe(listener: ReminderChangeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const reminderEvents = {
  emit,
  subscribe,
}
