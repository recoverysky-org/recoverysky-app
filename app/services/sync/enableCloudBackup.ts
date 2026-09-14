/**
 * The one "turn Cloud Backup on" step, shared by every entry point that can
 * flip the toggle: the Settings switch, the post-purchase / post-restore
 * prompt (`useCloudBackupPrompt`), and the one-off `BackupPassRunner`.
 *
 * ADDED 2026-09-14: this used to be hand-copied between SettingsScreen's
 * `handleSyncToggle` and BackupPassRunner, with a comment promising to
 * extract it once a third caller appeared. The restore-purchases prompt is
 * that third caller.
 */

import { trackEvent } from "@/services/tracking"

import { attendanceSync } from "./index"

/** The slice of ProfileStore this needs — keeps callers and tests decoupled from MST. */
export interface CloudBackupToggleStore {
  setSyncEnabled(value: boolean): void
}

/**
 * Persist the opt-in, record the analytics event, and kick the initial backup.
 *
 * Fire-and-forget on purpose: initialBackup() is a full pull of both
 * resources, then a report-body backfill, then a paced push of the entire
 * local attendance history. For a big history that's minutes, not seconds —
 * the user must be free to navigate away while it runs. Progress is visible
 * via SyncStatusLine (phase + pendingCount), which reads
 * attendanceSync.syncState directly, so nothing is awaited or stored here.
 * Re-enabling after a pause safely re-runs the whole thing: the pull resumes
 * from the persisted per-account cursors, and the push deliberately
 * re-enqueues every local record — the server's last-write-wins upsert turns
 * a re-push of unchanged rows into a harmless no-op. The bare `void` is safe
 * because initialBackup() never rejects — it logs and flips phase to "error"
 * internally (see its doc comment).
 */
export function enableCloudBackup(profileStore: CloudBackupToggleStore): void {
  profileStore.setSyncEnabled(true)
  trackEvent("cloud_backup_toggle", { enabled: true })
  void attendanceSync.initialBackup()
}
