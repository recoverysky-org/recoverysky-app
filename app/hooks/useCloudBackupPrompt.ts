/**
 * useCloudBackupPrompt — the "turn on Cloud Backup?" opt-in dialog.
 *
 * One hook, four callers: the two purchase paths in Settings (where it doubles
 * as the success dialog) and the two Restore Purchases buttons (Settings and
 * onboarding import). Decision logic is the vitest-covered
 * `decideCloudBackupPrompt()`; the enable step is the shared
 * `enableCloudBackup()`.
 *
 * History: split out of Settings' `showPurchaseSuccessAlert` on 2026-08-08 and
 * made awaitable so every purchase path could run it, not just the one that
 * ended on Settings.
 * ADDED 2026-09-14: extracted from a SettingsScreen-local `useCallback` so the
 * restore handlers could share it. Before this, restoring on a second device
 * never asked, and the launch-time BackupPassRunner could not catch it either
 * (it runs once per launch and had already decided "skip" before the restore).
 */
import { useCallback } from "react"
import { Alert, Platform } from "react-native"

import { translate, type TxKeyPath } from "@/i18n"
import { useProfileStore } from "@/models"
import { ENTITLEMENTS, hasEntitlement } from "@/services/purchases"
import { decideCloudBackupPrompt } from "@/services/sync/cloudBackupPromptLogic"
import { enableCloudBackup } from "@/services/sync/enableCloudBackup"
import { trackEvent } from "@/services/tracking"

export interface CloudBackupPromptCopy {
  /** Dialog title. Defaults to the post-purchase "Welcome to Premium!" title. */
  title?: TxKeyPath
  /** Dialog body. Defaults to the post-purchase thank-you + backup pitch. */
  message?: TxKeyPath
}

/**
 * Copy for the restore paths. "Welcome to Premium!" would read oddly after a
 * restore, so they reuse the launch-pass strings, which already say "your
 * subscription includes cloud backup, but it isn't on for this device".
 */
export const RESTORE_BACKUP_PROMPT_COPY: CloudBackupPromptCopy = {
  title: "settingsScreen:cloudBackupPassTitle",
  message: "settingsScreen:cloudBackupPassMessage",
}

export function useCloudBackupPrompt() {
  const profileStore = useProfileStore()

  /**
   * Returns whether it actually showed, so purchase callers can fall back to
   * the plain success Alert.
   *
   * ENTITLEMENT IS RE-READ, NOT TAKEN FROM `hasAttendance`. That context value
   * is React state captured in the caller's closure when the screen last
   * rendered, so immediately after `await showPaywall()` / `await restore()`
   * it still holds the PRE-purchase value — the user has just gained the
   * entitlement and the closure would say they don't have it, silently
   * skipping the prompt in the one case it exists for. `hasEntitlement()`
   * reads RevenueCat's customer info, which both of those already refreshed
   * via `loadSubscriptionInfo()`.
   *
   * `profileStore.syncEnabled` needs no such care: it's read off the MobX
   * store object at call time, so it's always live.
   *
   * AWAITS THE USER'S TAP. The returned promise resolves on dismissal, not on
   * presentation, because Settings' `handleUpgrade` navigates away afterwards
   * on the `returnTo` path and the destination must not race the dialog.
   * `cancelable: false` plus `onDismiss` guarantee it always settles; an
   * Android back-press that stranded the promise would strand that
   * navigation with it.
   */
  const promptCloudBackup = useCallback(
    async (copy: CloudBackupPromptCopy = {}): Promise<boolean> => {
      const entitled = await hasEntitlement(ENTITLEMENTS.ATTENDANCE)
      const decision = decideCloudBackupPrompt({
        web: Platform.OS === "web",
        entitled,
        syncEnabled: profileStore.syncEnabled,
      })
      if (decision === "skip") return false

      await new Promise<void>((resolve) => {
        Alert.alert(
          translate(copy.title ?? "settingsScreen:subscriptionSuccess"),
          translate(copy.message ?? "settingsScreen:subscriptionSuccessBackupMessage"),
          [
            {
              text: translate("settingsScreen:cloudBackupPromptDecline"),
              style: "cancel",
              onPress: () => {
                trackEvent("cloud_backup_prompt", { accepted: false })
                resolve()
              },
            },
            {
              text: translate("settingsScreen:cloudBackupPromptAccept"),
              onPress: () => {
                trackEvent("cloud_backup_prompt", { accepted: true })
                // Not awaited (the enable step is fire-and-forget by design),
                // so navigating away immediately after is safe.
                enableCloudBackup(profileStore)
                resolve()
              },
            },
          ],
          // Android-only options. Belt and braces: `cancelable: false` blocks
          // the back-press/outside-tap dismissal, and `onDismiss` settles the
          // promise anyway if one ever gets through.
          { cancelable: false, onDismiss: () => resolve() },
        )
      })

      return true
    },
    [profileStore],
  )

  return { promptCloudBackup }
}
