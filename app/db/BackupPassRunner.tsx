/**
 * BackupPassRunner Component
 *
 * Runs the one-off cloud-backup pass once per launch, once the database is
 * open and RevenueCat has answered. Headless (renders null).
 *
 * The decision is the pure, vitest-covered `decideBackupPass()` in
 * app/services/sync/backupPassLogic.ts — read its header for why the pass
 * exists. This file is only the I/O: gather the inputs, show the prompt, kick
 * off the backup, record the pass as done.
 *
 * Ordering matters here and is easy to get wrong:
 * - `useSubscription().isLoading` must be false before deciding. Until
 *   RevenueCat answers, `hasAttendance` is false, and an early decision would
 *   read every entitled user as "not entitled" and skip. Skipping does not
 *   consume the pass, so the only cost would be a missed launch — but it would
 *   be missed on EVERY launch, which is the same as never running.
 * - The pass is consumed (`saveString`) only on `prompt` and `backup`. A
 *   `skip` deliberately leaves it open — see the type doc on BackupPassAction.
 * - A ref guard makes this once-per-launch: `hasAttendance` and `isLoading`
 *   both change during startup, and each change re-runs the effect.
 *
 * Skipped entirely on web: react-native-web's Alert is a no-op (the prompt
 * would never render), and RevenueCat entitlements aren't wired there.
 *
 * Place inside DatabaseProvider, AFTER <SyncResumer /> — the order doesn't
 * affect correctness (both ticks have reentrancy guards and the outbox is
 * durable), it just keeps the cheap incremental catch-up first:
 * <DatabaseProvider>
 *   <SyncResumer />
 *   <BackupPassRunner />
 *   ...
 * </DatabaseProvider>
 */

import { useEffect, useRef } from "react"
import { Alert, Platform } from "react-native"
import { observer } from "mobx-react-lite"

import { useSubscription } from "@/context/SubscriptionContext"
import { translate } from "@/i18n"
import { useStores } from "@/models"
import { attendanceSync } from "@/services/sync"
import { BACKUP_PASS_ID, decideBackupPass } from "@/services/sync/backupPassLogic"
import { trackEvent } from "@/services/tracking"
import { logger } from "@/utils/logger"
import { loadString, saveString } from "@/utils/storage"

import { useDatabase } from "./DatabaseProvider"

const log = logger.child({ module: "BackupPassRunner" })

/** MMKV key holding the id of the last pass that ran on this device. */
const BACKUP_PASS_DONE_KEY = "sync.backupPass.done"

function markPassDone(): void {
  saveString(BACKUP_PASS_DONE_KEY, BACKUP_PASS_ID)
}

export const BackupPassRunner = observer(function BackupPassRunner(): null {
  const { status } = useDatabase()
  const { isLoading, hasAttendance } = useSubscription()
  const { authenticationStore, profileStore, networkStore, configStore } = useStores()
  const hasRun = useRef(false)

  useEffect(() => {
    if (Platform.OS === "web") return
    if (status !== "open" && status !== "seeded") return
    if (isLoading) return
    if (hasRun.current) return
    hasRun.current = true

    const action = decideBackupPass({
      donePassId: loadString(BACKUP_PASS_DONE_KEY) ?? null,
      signedIn: authenticationStore.isAuthenticated,
      anonymous: authenticationStore.isAnonymous,
      entitled: hasAttendance,
      syncEnabled: profileStore.syncEnabled,
      offline: networkStore.isOffline,
      maintenanceMode: configStore.maintenanceMode,
    })
    log.info("Backup pass decision", { passId: BACKUP_PASS_ID, action })

    if (action === "skip") return

    if (action === "backup") {
      markPassDone()
      trackEvent("cloud_backup_pass", { action: "backup" })
      // Fire-and-forget, same contract as the Settings toggle: initialBackup()
      // never rejects, progress is visible on SyncStatusLine, and an
      // interrupted run leaves its rows in the durable outbox for the next
      // trigger to drain. Marked done BEFORE it runs — this is a one-shot
      // kick, not a guarantee of completion; the outbox is the guarantee.
      void attendanceSync.initialBackup()
      return
    }

    // action === "prompt". Either answer consumes the pass — "ask once,
    // never again" is the product decision (2026-09-14). Settings → Cloud
    // Backup stays available for anyone who declines.
    markPassDone()
    Alert.alert(
      translate("settingsScreen:cloudBackupPassTitle"),
      translate("settingsScreen:cloudBackupPassMessage"),
      [
        {
          text: translate("settingsScreen:cloudBackupPromptDecline"),
          style: "cancel",
          onPress: () => trackEvent("cloud_backup_pass", { action: "declined" }),
        },
        {
          text: translate("settingsScreen:cloudBackupPromptAccept"),
          onPress: () => {
            // Mirrors SettingsScreen's handleSyncToggle(true) — kept in step
            // by hand because that handler is a screen-local useCallback. If
            // the enable path ever grows a third step, extract it into
            // app/services/sync and call it from both places.
            profileStore.setSyncEnabled(true)
            trackEvent("cloud_backup_toggle", { enabled: true })
            trackEvent("cloud_backup_pass", { action: "accepted" })
            void attendanceSync.initialBackup()
          },
        },
      ],
      // Android: a back-press dismissal still counts as "asked" — the pass is
      // already marked done above, so there is nothing to settle here.
      { cancelable: true },
    )
  }, [
    status,
    isLoading,
    hasAttendance,
    authenticationStore,
    profileStore,
    networkStore,
    configStore,
  ])

  return null
})
