/**
 * useReminders Hook
 *
 * Manages reminder CRUD for a meeting, with local SQLite persistence
 * and fire-and-forget API sync for server-side push notification scheduling.
 */

import { useState, useEffect, useCallback } from "react"
import * as Crypto from "expo-crypto"

import type { MeetingWithTrex } from "@/context/MeetingContext"
import {
  reminderRepo,
  reminderEvents,
  type ReminderRecord,
  type ReminderCreateInput,
  type ReminderUpdateInput,
} from "@/db"
import { useAuthenticationStore } from "@/models"
import { api } from "@/services/api"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "useReminders" })

interface UseRemindersResult {
  /** All reminders for this meeting (including schedule-level) */
  reminders: ReminderRecord[]
  /** Set of "rowIndex-colIndex" keys for cells with active reminders */
  reminderCells: Set<string>
  /** Whether reminders are being loaded */
  isLoading: boolean
  /** Create a new reminder */
  createReminder: (input: Omit<ReminderCreateInput, "uid">) => Promise<ReminderRecord | null>
  /** Update an existing reminder */
  updateReminder: (id: string, input: ReminderUpdateInput) => Promise<void>
  /** Delete a reminder */
  deleteReminder: (id: string) => Promise<void>
  /** Find existing reminder for this meeting (direct or via schedule) */
  findExistingReminder: () => ReminderRecord | null
}

/**
 * Hook for managing reminders for a specific meeting.
 *
 * Loads reminders from SQLite on mount and subscribes to reminder events
 * for real-time updates. CRUD operations write locally first, then
 * fire-and-forget sync to the API.
 */
export function useReminders(meeting: MeetingWithTrex | null, sid: string): UseRemindersResult {
  const authStore = useAuthenticationStore()
  const [reminders, setReminders] = useState<ReminderRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const uid = authStore.userId ?? ""

  // Load reminders when meeting changes
  const loadReminders = useCallback(async () => {
    if (!meeting?.id || !uid) {
      setReminders([])
      return
    }

    setIsLoading(true)
    try {
      // Load reminders for this specific meeting
      const byMeeting = await reminderRepo.findByMeetingId(meeting.id)
      const meetingReminders = byMeeting.ok ? byMeeting.value : []

      // Also load schedule-level reminders if we have a sid
      let scheduleReminders: ReminderRecord[] = []
      if (sid) {
        const byUser = await reminderRepo.findByUserId(uid)
        if (byUser.ok) {
          scheduleReminders = byUser.value.filter((r) => r.sid === sid && r.mid !== meeting.id)
        }
      }

      setReminders([...meetingReminders, ...scheduleReminders])
    } catch (error) {
      log.error("Failed to load reminders", { error: String(error), mid: meeting.id })
    } finally {
      setIsLoading(false)
    }
  }, [meeting?.id, uid, sid])

  useEffect(() => {
    loadReminders()
  }, [loadReminders])

  // Subscribe to reminder events for live updates
  useEffect(() => {
    const unsub = reminderEvents.subscribe(() => {
      loadReminders()
    })
    return unsub
  }, [loadReminders])

  // Compute which grid cells have reminders
  const reminderCells = computeReminderCells(reminders, meeting)

  const createReminder = useCallback(
    async (input: Omit<ReminderCreateInput, "uid">): Promise<ReminderRecord | null> => {
      if (!uid) return null

      const id = Crypto.randomUUID()
      const fullInput: ReminderCreateInput = { ...input, uid, id }
      const result = await reminderRepo.create(fullInput)

      if (!result.ok) {
        log.error("Failed to create reminder", { error: "create failed" })
        return null
      }

      const record = await reminderRepo.findById(id)
      const created = record.ok ? record.value : null

      if (created) {
        reminderEvents.emit({
          type: "created",
          id,
          record: created,
          mid: created.mid,
          sid: created.sid || undefined,
        })

        // Fire-and-forget API sync
        api
          .createReminder({
            id,
            mid: created.mid,
            sid: created.sid || undefined,
            name: created.name,
            timezone: created.timezone,
            minutes_before: created.minutes_before,
            at_start: created.at_start,
            enabled: created.enabled,
          })
          .catch((e) => log.warn("API sync failed for createReminder", { error: String(e) }))
      }

      return created
    },
    [uid],
  )

  const updateReminder = useCallback(async (id: string, input: ReminderUpdateInput) => {
    const result = await reminderRepo.update(id, input)
    if (!result.ok) {
      log.error("Failed to update reminder", { id })
      return
    }

    const record = await reminderRepo.findById(id)
    const updated = record.ok ? record.value : null

    reminderEvents.emit({
      type: "updated",
      id,
      record: updated ?? undefined,
      mid: updated?.mid,
      sid: updated?.sid || undefined,
    })

    // Fire-and-forget API sync
    api
      .updateReminder(id, {
        id,
        mid: updated?.mid ?? "",
        timezone: updated?.timezone ?? "",
        minutes_before: updated?.minutes_before ?? 15,
        at_start: updated?.at_start ?? false,
        enabled: updated?.enabled ?? true,
        ...input,
      })
      .catch((e) => log.warn("API sync failed for updateReminder", { error: String(e) }))
  }, [])

  const deleteReminder = useCallback(async (id: string) => {
    // Read before deleting for event data
    const record = await reminderRepo.findById(id)
    const existing = record.ok ? record.value : null

    const result = await reminderRepo.delete(id)
    if (!result.ok) {
      log.error("Failed to delete reminder", { id })
      return
    }

    reminderEvents.emit({
      type: "deleted",
      id,
      mid: existing?.mid,
      sid: existing?.sid || undefined,
    })

    // Fire-and-forget API sync
    api
      .deleteReminder(id)
      .catch((e) => log.warn("API sync failed for deleteReminder", { error: String(e) }))
  }, [])

  const findExistingReminder = useCallback((): ReminderRecord | null => {
    if (!meeting?.id) return null
    // Direct meeting reminder first
    const direct = reminders.find((r) => r.mid === meeting.id)
    if (direct) return direct
    // Schedule-level reminder
    if (sid) {
      const schedule = reminders.find((r) => r.sid === sid)
      if (schedule) return schedule
    }
    return null
  }, [reminders, meeting?.id, sid])

  return {
    reminders,
    reminderCells,
    isLoading,
    createReminder,
    updateReminder,
    deleteReminder,
    findExistingReminder,
  }
}

/**
 * Compute which grid cells have active reminders.
 * Returns a Set of "rowIndex-colIndex" keys.
 *
 * Since mid identifies the recurring meeting and the schedule grid shows
 * all occurrences, a reminder for a mid highlights ALL cells for that meeting.
 */
function computeReminderCells(
  reminders: ReminderRecord[],
  meeting: MeetingWithTrex | null,
): Set<string> {
  const cells = new Set<string>()
  if (!meeting?.scheduleData || reminders.length === 0) return cells

  const enabledReminders = reminders.filter((r) => r.enabled)
  if (enabledReminders.length === 0) return cells

  // Scope detection from stored fields:
  //   single: no sid        → no grid highlighting
  //   row:    sid + mid      → highlight cells matching meeting.millis
  //   all:    sid + no mid   → highlight all non-null cells
  const allScopeReminder = enabledReminders.find((r) => r.sid && r.sid !== "" && !r.mid)
  const rowScopeReminder = enabledReminders.find((r) => r.sid && r.sid !== "" && r.mid)

  if (allScopeReminder) {
    // Entire schedule — highlight every non-null cell
    meeting.scheduleData.forEach((row, rowIndex) => {
      row.forEach((millis, colIndex) => {
        if (millis !== null) cells.add(`${rowIndex}-${colIndex}`)
      })
    })
  } else if (rowScopeReminder) {
    // All at this time — find the row containing this meeting, highlight entire row
    meeting.scheduleData.forEach((row, rowIndex) => {
      const rowHasMeeting = row.some((m) => m !== null && m === meeting.millis)
      if (rowHasMeeting) {
        row.forEach((millis, colIndex) => {
          if (millis !== null) cells.add(`${rowIndex}-${colIndex}`)
        })
      }
    })
  }

  return cells
}
