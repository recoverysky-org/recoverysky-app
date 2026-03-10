/**
 * useReminders Hook
 *
 * Manages reminder CRUD for a meeting, with local SQLite persistence
 * and fire-and-forget API sync for server-side push notification scheduling.
 */

import { useState, useEffect, useCallback, useMemo } from "react"
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
  /** Find existing reminder covering the given cell ID (direct, row, or all scope) */
  findExistingReminder: (cellId?: string) => ReminderRecord | null
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

  // Collect all meeting IDs visible in the schedule grid
  const gridMids = useMemo(() => {
    const ids = new Set<string>()
    if (meeting?.scheduleData) {
      for (const row of meeting.scheduleData) {
        for (const cell of row) {
          if (cell !== null) ids.add(cell.id)
        }
      }
    }
    return ids
  }, [meeting?.scheduleData])

  // Load reminders for all meetings visible in the grid
  const loadReminders = useCallback(async () => {
    if (!uid || gridMids.size === 0) {
      setReminders([])
      return
    }

    setIsLoading(true)
    try {
      const byUser = await reminderRepo.findByUserId(uid)
      if (byUser.ok) {
        setReminders(
          byUser.value.filter((r) => gridMids.has(r.mid) || (sid && r.sid === sid)),
        )
      } else {
        setReminders([])
      }
    } catch (error) {
      log.error("Failed to load reminders", { error: String(error), mid: meeting?.id })
    } finally {
      setIsLoading(false)
    }
  }, [uid, gridMids, sid, meeting?.id])

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

  const findExistingReminder = useCallback(
    (cellId?: string): ReminderRecord | null => {
      if (!meeting?.scheduleData) return null

      const mid = cellId ?? meeting.id

      // Exact match — single-scope reminder on this cell
      const direct = reminders.find((r) => r.mid === mid)
      if (direct) return direct

      // Row/all scope — find a reminder whose mid is in the same row as the tapped cell
      for (const row of meeting.scheduleData) {
        const tappedInRow = row.some((c) => c !== null && c.id === mid)
        if (!tappedInRow) continue
        // Look for a reminder whose mid is anywhere in this row
        for (const cell of row) {
          if (cell === null) continue
          const match = reminders.find(
            (r) => r.mid === cell.id && (r.scope === "row" || r.scope === "all"),
          )
          if (match) return match
        }
      }

      // Schedule-wide reminder (all scope not tied to a specific row)
      return reminders.find((r) => r.scope === "all") ?? null
    },
    [reminders, meeting?.id, meeting?.scheduleData],
  )

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
 * Each cell in scheduleData now carries an `id` (meeting/trex ID).
 * Uses the explicit `scope` field on each reminder:
 *   single → highlight only the cell whose id matches reminder.mid
 *   row    → find the cell matching reminder.mid, highlight its entire row
 *   all    → highlight every non-null cell
 */
function computeReminderCells(
  reminders: ReminderRecord[],
  meeting: MeetingWithTrex | null,
): Set<string> {
  const cells = new Set<string>()
  if (!meeting?.scheduleData || reminders.length === 0) return cells

  const enabled = reminders.filter((r) => r.enabled)
  if (enabled.length === 0) return cells

  for (const r of enabled) {
    if (r.scope === "all") {
      // Entire schedule
      meeting.scheduleData.forEach((row, ri) => {
        row.forEach((cell, ci) => {
          if (cell !== null) cells.add(`${ri}-${ci}`)
        })
      })
    } else if (r.scope === "row") {
      // Find the row containing the reminder's meeting ID, highlight entire row
      for (let ri = 0; ri < meeting.scheduleData.length; ri++) {
        const row = meeting.scheduleData[ri]
        if (row.some((cell) => cell !== null && cell.id === r.mid)) {
          row.forEach((cell, ci) => {
            if (cell !== null) cells.add(`${ri}-${ci}`)
          })
          break
        }
      }
    } else {
      // Single — highlight only the exact cell matching reminder.mid
      for (let ri = 0; ri < meeting.scheduleData.length; ri++) {
        const row = meeting.scheduleData[ri]
        for (let ci = 0; ci < row.length; ci++) {
          const cell = row[ci]
          if (cell !== null && cell.id === r.mid) {
            cells.add(`${ri}-${ci}`)
          }
        }
      }
    }
  }

  return cells
}
