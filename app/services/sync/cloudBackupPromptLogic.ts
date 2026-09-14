/**
 * Pure decision logic for the "turn on Cloud Backup?" opt-in prompt.
 *
 * Kept free of runtime `@/` imports so vitest can cover it (see CLAUDE.md
 * "Test Runner Split"). The dialog itself lives in
 * `app/hooks/useCloudBackupPrompt.ts`.
 *
 * ADDED 2026-09-14: the prompt used to be a screen-local closure in Settings
 * that only the purchase paths called. Restoring a subscription — from
 * Settings or from onboarding — never asked, so a subscriber's second device
 * silently stayed unbacked-up. Both restore handlers now share this decision
 * with the purchase paths.
 */

export type CloudBackupPromptDecision = "prompt" | "skip"

export interface CloudBackupPromptInput {
  /** `Platform.OS === "web"`. */
  web: boolean
  /**
   * Live attendance entitlement, re-read from RevenueCat by the caller —
   * NOT the `hasAttendance` React state, which is stale right after a
   * purchase/restore (see the hook's comment).
   */
  entitled: boolean
  /** `profileStore.syncEnabled`. */
  syncEnabled: boolean
}

/**
 * Prompt only when the user can act on it: the attendance entitlement is live
 * (the /sync API requires it and the Cloud Backup section is gated on it) AND
 * backup is still off. Web is skipped because react-native-web's `Alert` is a
 * no-op — an awaited dialog there would never settle.
 */
export function decideCloudBackupPrompt(input: CloudBackupPromptInput): CloudBackupPromptDecision {
  if (input.web) return "skip"
  if (!input.entitled) return "skip"
  if (input.syncEnabled) return "skip"
  return "prompt"
}
