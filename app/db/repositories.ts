/**
 * Repository instances for the app
 *
 * Pre-instantiated repositories using the app's database connection.
 * Import these directly for data access throughout the app.
 *
 * @example
 * import { meetingRepo, syncQueueRepo } from "@/db"
 *
 * // Find all meetings
 * const meetings = await meetingRepo.findAll()
 *
 * // Queue an offline operation
 * await syncQueueRepo.enqueue({
 *   tableName: "meetings",
 *   recordId: "123",
 *   operation: "create",
 *   payload: JSON.stringify(meetingData),
 * })
 */

import {
  MeetingSqliteRepository,
  ScheduleSqliteRepository,
  SyncQueueRepository,
} from "@common/sqlite"
import { db } from "./provider"

/**
 * Meeting repository instance
 * Handles CRUD operations for meetings with junction tables
 */
export const meetingRepo = new MeetingSqliteRepository(db as any)

/**
 * Schedule repository instance
 * Handles CRUD operations for schedules with meeting relationships
 */
export const scheduleRepo = new ScheduleSqliteRepository(db as any)

/**
 * Sync queue repository instance
 * Manages offline operation queue for server synchronization
 */
export const syncQueueRepo = new SyncQueueRepository(db as any)
