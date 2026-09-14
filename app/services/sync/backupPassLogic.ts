/**
 * Pure decision logic for the one-off cloud-backup pass.
 *
 * ZERO runtime imports from `@/` — vitest-tested (see backupPassLogic.test.ts)
 * and vitest has no path-alias config. The I/O half lives in
 * app/db/BackupPassRunner.tsx.
 *
 * Why this exists (2026-09-14): cloud backup is a per-device MMKV toggle, and
 * the only prompt to turn it on fired on the device where the subscription was
 * purchased. Users with the entitlement on a second device, or who declined at
 * purchase time, never got asked again — so their attendance sat unbacked-up.
 * Separately, an initial backup that failed mid-flight (offline, API outage)
 * had no retry beyond the incremental fullSync(), which only drains what is
 * queued and never re-enqueues the full history. One pass fixes both: prompt
 * the entitled-but-off users once, and run a full initialBackup() for everyone
 * entitled-and-on.
 */

/**
 * Identifier of the current pass. The runner records this value in MMKV once
 * the pass has run on a device; a later launch skips while the stored value
 * matches. BUMP THIS (any new string — the date convention is just for
 * readability) to run another pass for every user on their next cold start.
 */
export const BACKUP_PASS_ID = "2026-09-14"

export interface BackupPassInput {
  /** The pass id recorded in MMKV, or null if no pass has ever completed. */
  donePassId: string | null
  signedIn: boolean
  anonymous: boolean
  /** RevenueCat `recoverysky-attendance` entitlement — the one /sync requires. */
  entitled: boolean
  /** profileStore.syncEnabled — the per-device Cloud Backup toggle. */
  syncEnabled: boolean
  offline: boolean
  maintenanceMode: boolean
}

/**
 * - `"prompt"`  — entitled, backup off: ask once; either answer consumes the pass.
 * - `"backup"`  — entitled, backup on: run a full initialBackup(); consumes the pass.
 * - `"skip"`    — do nothing AND leave the pass unconsumed. This covers three
 *   different situations on purpose:
 *     1. Already done for this pass id.
 *     2. Not eligible yet (signed out, anonymous, not entitled). Leaving the
 *        pass open means a user who subscribes next month gets prompted on
 *        their first launch after that, on every device — which closes the
 *        second-device gap the purchase-time prompt can't reach.
 *     3. Offline or in maintenance. initialBackup()'s gate() would no-op
 *        silently and there is no signal back, so consuming the pass here
 *        would burn the one shot. Deferring costs nothing.
 */
export type BackupPassAction = "skip" | "prompt" | "backup"

export function decideBackupPass(input: BackupPassInput): BackupPassAction {
  if (input.donePassId === BACKUP_PASS_ID) return "skip"
  if (!input.signedIn || input.anonymous) return "skip"
  if (!input.entitled) return "skip"
  if (input.offline || input.maintenanceMode) return "skip"
  return input.syncEnabled ? "backup" : "prompt"
}
