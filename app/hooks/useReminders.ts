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
  /** Map of "rowIndex-colIndex" keys to reminder state ("enabled" | "disabled") */
  reminderCells: Map<string, "enabled" | "disabled">
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
  /** Check if proposed cells overlap with existing reminders (excludeId skips self) */
  checkOverlap: (proposedCells: Set<string>, excludeId?: string) => ReminderRecord[]
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
            dow: created.dow,
            time: created.time,
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
        dow: updated?.dow ?? 0,
        time: updated?.time ?? 0,
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

  const checkOverlap = useCallback(
    (proposedCells: Set<string>, excludeId?: string): ReminderRecord[] => {
      if (!meeting?.scheduleData) return []
      return reminders.filter((r) => {
        if (excludeId && r.id === excludeId) return false
        const rCells = getCellsForReminder(r, meeting.scheduleData!)
        return rCells.some((key) => proposedCells.has(key))
      })
    },
    [reminders, meeting?.scheduleData],
  )

  return {
    reminders,
    reminderCells,
    isLoading,
    createReminder,
    updateReminder,
    deleteReminder,
    findExistingReminder,
    checkOverlap,
  }
}

/** Get the "row-col" cell keys covered by a single reminder */
function getCellsForReminder(
  r: ReminderRecord,
  scheduleData: (({ millis: number; id: string } | null)[])[],
): string[] {
  const keys: string[] = []
  if (r.scope === "all") {
    scheduleData.forEach((row, ri) => {
      row.forEach((cell, ci) => {
        if (cell !== null) keys.push(`${ri}-${ci}`)
      })
    })
  } else if (r.scope === "row") {
    for (let ri = 0; ri < scheduleData.length; ri++) {
      if (scheduleData[ri].some((c) => c !== null && c.id === r.mid)) {
        scheduleData[ri].forEach((c, ci) => {
          if (c !== null) keys.push(`${ri}-${ci}`)
        })
        break
      }
    }
  } else {
    for (let ri = 0; ri < scheduleData.length; ri++) {
      for (let ci = 0; ci < scheduleData[ri].length; ci++) {
        const c = scheduleData[ri][ci]
        if (c !== null && c.id === r.mid) keys.push(`${ri}-${ci}`)
      }
    }
  }
  return keys
}

/**
 * Compute which grid cells have reminders and their enabled/disabled state.
 * Returns a Map of "rowIndex-colIndex" → "enabled" | "disabled".
 */
function computeReminderCells(
  reminders: ReminderRecord[],
  meeting: MeetingWithTrex | null,
): Map<string, "enabled" | "disabled"> {
  const cells = new Map<string, "enabled" | "disabled">()
  if (!meeting?.scheduleData || reminders.length === 0) return cells

  for (const r of reminders) {
    const state = r.enabled ? "enabled" : "disabled"
    const keys = getCellsForReminder(r, meeting.scheduleData)
    for (const key of keys) {
      if (cells.get(key) !== "enabled") cells.set(key, state)
    }
  }

  return cells
}

/**
 * Check if a meeting's schedule has any reminders set.
 * Matches by cell IDs in scheduleData or by schedule ID (sid).
 */
export function meetingHasReminder(
  meeting: MeetingWithTrex,
  lookup: ReminderLookup,
): boolean {
  if (lookup.sids.has(meeting.sid)) return true
  if (meeting.scheduleData) {
    for (const row of meeting.scheduleData) {
      for (const cell of row) {
        if (cell !== null && lookup.mids.has(cell.id)) return true
      }
    }
  }
  return false
}

export interface ReminderLookup {
  /** Meeting IDs that have reminders */
  mids: Set<string>
  /** Schedule IDs that have reminders (row/all scope) */
  sids: Set<string>
}

/**
 * Lightweight hook that returns Sets of meeting IDs and schedule IDs with reminders.
 * Used by meeting lists to show a bell indicator on rows with reminders.
 *
 * A meeting shows the bell if:
 *   - Any cell ID in its scheduleData is in `mids`, OR
 *   - Its `sid` is in `sids`
 */
export function useReminderLookup(): ReminderLookup {
  const authStore = useAuthenticationStore()
  const uid = authStore.userId ?? ""
  const [lookup, setLookup] = useState<ReminderLookup>({ mids: new Set(), sids: new Set() })

  const load = useCallback(async () => {
    if (!uid) {
      setLookup({ mids: new Set(), sids: new Set() })
      return
    }
    const result = await reminderRepo.findByUserId(uid)
    if (result.ok) {
      const mids = new Set<string>()
      const sids = new Set<string>()
      for (const r of result.value) {
        if (r.mid) mids.add(r.mid)
        if (r.sid) sids.add(r.sid)
      }
      setLookup({ mids, sids })
    }
  }, [uid])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    return reminderEvents.subscribe(() => {
      load()
    })
  }, [load])

  return lookup
}
