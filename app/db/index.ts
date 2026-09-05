/**
 * Database exports for the RecoverySky Hybrid app
 *
 * This module provides SQLite database access using Drizzle ORM with expo-sqlite.
 * All data is stored locally for offline-first access, with sync capabilities.
 *
 * @example
 * import { db, meetingRepo, syncQueueRepo } from "@/db"
 *
 * // Query meetings
 * const result = await meetingRepo.findAll()
 * if (result.ok) {
 *   console.log("Found", result.value.length, "meetings")
 * }
 *
 * // Queue an offline operation
 * await syncQueueRepo.enqueue({
 *   tableName: "meetings",
 *   recordId: "123",
 *   operation: "update",
 *   payload: JSON.stringify({ name: "Updated" }),
 * })
 */

export { getDb, openDb } from "./provider"
export { openDbEarly } from "./earlyOpen"
export { DatabaseProvider, useDatabase, useDatabaseReady } from "./DatabaseProvider"
export { DatabaseLoadingOverlay } from "./DatabaseLoadingOverlay"
export { ProfileHydrator } from "./ProfileHydrator"
export { ChatHydrator } from "./ChatHydrator"
export { ReportPollingResumer } from "./ReportPollingResumer"
export { TimerSessionResumer } from "./TimerSessionResumer"
export { SyncResumer } from "./SyncResumer"
// FavoritesMigrator is deliberately NOT re-exported here: its service chain
// (services/favorites → services/api and → db/feedbackCache → repositories →
// models) leads back into this barrel, so exporting it would hand depcruise a
// fresh set of no-circular warnings. app.tsx imports it from its own module.
export {
  meetingRepo,
  scheduleRepo,
  syncQueueRepo,
  attendanceRepo,
  attendanceReportRepo,
  feedbackRepo,
  chatMessageRepo,
  profileRepository,
  configCacheRepository,
  reminderRepo,
  findAllTrexes,
  findTrexById,
  findTrexesByIds,
  type TrexRow,
  type AttendanceCreateInput,
  type AttendanceUpdateInput,
  type AttendanceRecord,
  type AttendanceEvent,
  type AttendanceReportRecord,
  type AttendanceReportCreateInput,
  type AttendanceReportUpdateInput,
  type FeedbackRecord,
  type FeedbackInput,
  type ChatMessageRecord,
  type ChatMessageInput,
  type ReminderRecord,
  type ReminderCreateInput,
  type ReminderUpdateInput,
  type ConfigCacheRecord,
} from "./repositories"
export { feedbackCache } from "./feedbackCache"
export { attendanceEvents } from "./attendanceEvents"
export { liveEvents } from "./liveEvents"
export { reminderEvents } from "./reminderEvents"
