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
   *
   * CHANGED 2026-08-13: widened from the lone "cloudBackupSettings" to a union
   * when the In-Person announcement needed a second destination. Every value
   * here needs a matching branch in AnnouncementGate.handleCta — a target with
   * no branch silently marks the announcement seen and navigates nowhere.
   */
  target: "cloudBackupSettings" | "inPersonMeetings"
}

export interface Announcement {
  /** Stable, unique, human-readable slug. Never reused. Never compared. */
  id: string
  titleTx: TxKeyPath
  bodyTx: TxKeyPath
  /** Ionicons glyph name for the header icon. Defaults to "megaphone-outline". */
  icon?: string
  cta?: AnnouncementCta
  /**
   * ADDED 2026-10-06: show only on this platform (`Platform.OS`). Omitted =
   * every platform.
   */
  platform?: "android" | "ios" | "web"
  /**
   * ADDED 2026-10-06: a repeating notice. Instead of showing once, it shows on
   * every cold start (once per JS session) while the installed store build is
   * below this version, and stops by itself once the user installs it, so it
   * needs no cleanup even if the entry is still in that build's embedded bundle.
   * Dismissing it is NOT recorded as seen. Because it is never seen, an entry
   * appended after it waits behind it until it expires: keep these short-lived.
   */
  repeatUntilNativeVersion?: string
  /**
   * ADDED 2026-10-06: a named before/after artwork pair rendered under the
   * body. A name rather than `require()`d images, because this module is
   * imported by vitest, which can't load PNGs; the gate maps the name to the
   * assets. Every value needs a matching entry in AnnouncementGate's ART map.
   */
  art?: "androidIconChange"
}

export const ANNOUNCEMENTS: readonly Announcement[] = [
  // {
  //   id: "cloud-backup-sync-2026-07",
  //   titleTx: "announcements:cloudBackupTitle",
  //   bodyTx: "announcements:cloudBackupBody",
  //   icon: "cloud-outline",
  //   cta: {
  //     labelTx: "announcements:cloudBackupCta",
  //     requiresAttendance: true,
  //     target: "cloudBackupSettings",
  //   },
  // },
  {
    id: "in-person-meetings-2026-08",
    titleTx: "announcements:inPersonTitle",
    bodyTx: "announcements:inPersonBody",
    icon: "location-outline",
    cta: {
      labelTx: "announcements:inPersonCta",
      // Browsing in-person meetings, the map, directions and "I'm Here" are all
      // free — nothing in InPersonScreen reads an entitlement. (Only reminders
      // from InPersonPopup are premium.) So every viewer gets the button.
      requiresAttendance: false,
      target: "inPersonMeetings",
    },
  },
  {
    // Android installs show the pink meeting-circle adaptive icon; the 4.11.0
    // store build replaces it with the RecoverySky sky icon. Shown on every
    // cold start until the user is on 4.11.0 so nobody goes hunting for a
    // "missing" app after the update.
    id: "android-icon-change-4.11.0",
    titleTx: "announcements:androidIconTitle",
    bodyTx: "announcements:androidIconBody",
    icon: "phone-portrait-outline",
    platform: "android",
    repeatUntilNativeVersion: "4.11.0",
    art: "androidIconChange",
  },
] as const
