/**
 * Announcement registry — content for the one-time announcement popup.
 *
 * To publish an announcement: append an entry here, add its strings to the
 * i18n files (see `announcements` namespace), and ship an OTA (`npm run
 * update`). This is a JS-only change — do NOT bump `runtimeVersion`.
 *
 * Ordering is by array position (oldest first). The gate shows the FIRST
 * unseen entry, so append new announcements at the END.
 *
 * Purity: this module is imported by vitest via `announcementLogic`, so it
 * must stay free of runtime `@/` imports and native-module value imports.
 * `TxKeyPath` is a type-only import (erased at build). `icon` is a plain
 * string (a valid Ionicons glyph name) rather than a typed union, precisely
 * to avoid a value import of `@expo/vector-icons` that would break vitest.
 */
import type { TxKeyPath } from "@/i18n"

export interface AnnouncementCta {
  /** Button label (i18n key). */
  labelTx: TxKeyPath
  /**
   * When true, the CTA button renders ONLY for users with the
   * recoverysky-attendance entitlement (hasAttendance). Non-entitled users
   * still see the announcement — just without this button.
   */
  requiresAttendance: boolean
  /**
   * Named destination, resolved to a concrete navigation call by the gate.
   * Keeping it a string keeps this file free of navigation imports.
   */
  target: "cloudBackupSettings"
}

export interface Announcement {
  /** Stable, unique, human-readable slug. Never reused. Never compared. */
  id: string
  titleTx: TxKeyPath
  bodyTx: TxKeyPath
  /** Ionicons glyph name for the header icon. Defaults to "megaphone-outline". */
  icon?: string
  cta?: AnnouncementCta
}

export const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    id: "cloud-backup-sync-2026-07",
    titleTx: "announcements:cloudBackupTitle",
    bodyTx: "announcements:cloudBackupBody",
    icon: "cloud-outline",
    cta: {
      labelTx: "announcements:cloudBackupCta",
      requiresAttendance: true,
      target: "cloudBackupSettings",
    },
  },
] as const
