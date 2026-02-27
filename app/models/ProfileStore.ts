import { Instance, SnapshotOut, types } from "mobx-state-tree"

import { liveEvents } from "@/db"
import { profileRepository } from "@/db/repositories"
import { changeLanguage, translate } from "@/i18n"
import { logger } from "@/utils/logger"

import { withSetPropAction } from "./helpers/withSetPropAction"

const log = logger.child({ module: "ProfileStore" })

/**
 * Pronoun options type
 */
type Pronouns = "none" | "he/him" | "she/her" | "they/them" | "em/ers" | null

/**
 * Profile data stored in encrypted SQLite
 * Only truly sensitive personal data goes here
 */
export interface SecureProfileData {
  shortName?: string
  pronouns?: Pronouns
  recoveryDate?: string
  fellowship?: string
  language?: string
}

/**
 * ProfileStore - User profile and preferences
 *
 * SECURITY: Sensitive personal data is stored in `volatile` state (not in snapshots).
 * - Volatile data is persisted to encrypted SQLite (shortName, pronouns, recoveryDate, fellowship, language)
 * - Non-sensitive preferences go to MMKV via snapshots (props)
 */
export const ProfileStoreModel = types
  .model("ProfileStore")
  .props({
    // === NON-SENSITIVE (stored in MMKV via snapshots) ===

    // Display toggles (preferences, not personal data)
    showCleanDate: types.optional(types.boolean, false),
    showCleanDays: types.optional(types.boolean, false),
    showPronouns: types.optional(types.boolean, false),

    // Account info
    subscription: types.optional(types.string, "Free"),
    subscriptionExpires: types.maybeNull(types.string),

    // Appearance
    themeColor: types.optional(types.string, ""), // empty = use default tint

    // Onboarding & UX
    onboardingCompleted: types.optional(types.boolean, false),
    dontShowShortMeetingWarning: types.optional(types.boolean, false),

    // Attendance settings
    attendanceEnabled: types.optional(types.boolean, true),
    reportEmail: types.optional(types.string, ""),

    // Zoom
    zoomConnected: types.optional(types.boolean, false),

    // Notifications
    notificationsEnabled: types.optional(types.boolean, true),

    // Import
    imported: types.optional(types.boolean, false),

    // AI consent (Apple Guideline 5.1.2(i))
    aiConsentAccepted: types.optional(types.boolean, false),

    // Home screen help cards
    dismissedHomeCards: types.optional(types.array(types.string), []),
  })
  .volatile(() => ({
    // === SENSITIVE (stored in encrypted SQLite, NOT in snapshots) ===
    shortName: "Anonymous",
    pronouns: null as Pronouns,
    recoveryDate: new Date().toISOString().split("T")[0],
    fellowship: "AA",
    language: "", // empty = use device locale

    // Hydration flag
    _isHydrated: false,
  }))
  .views((self) => ({
    /**
     * Check if secure data has been loaded from SQLite
     */
    get isHydrated(): boolean {
      return self._isHydrated
    },

    /**
     * Calculate clean days from recovery date
     */
    get cleanDays(): number {
      // Use T12:00:00 to avoid timezone boundary issues
      const recovery = new Date(self.recoveryDate + "T12:00:00")
      const today = new Date()
      today.setHours(12, 0, 0, 0) // Normalize to noon for consistent day calculation
      const diffTime = Math.abs(today.getTime() - recovery.getTime())
      return Math.floor(diffTime / (1000 * 60 * 60 * 24))
    },

    /**
     * Get the recovery date as a Date object (in local timezone)
     * Note: We append T12:00:00 to avoid timezone boundary issues
     */
    get recoveryDateAsDate(): Date {
      return new Date(self.recoveryDate + "T12:00:00")
    },

    /**
     * Get translated pronoun label
     */
    get pronounsLabel(): string {
      switch (self.pronouns) {
        case "none":
          return translate("settingsScreen:pronounNone")
        case "he/him":
          return translate("settingsScreen:pronounHeHim")
        case "she/her":
          return translate("settingsScreen:pronounSheHer")
        case "they/them":
          return translate("settingsScreen:pronounTheyThem")
        case "em/ers":
          return translate("settingsScreen:pronounEmErs")
        default:
          return translate("settingsScreen:selectPronouns")
      }
    },

    /**
     * Generate display name based on toggle settings
     */
    get displayName(): string {
      const parts: string[] = []

      if (self.showPronouns && self.pronouns && self.pronouns !== "none") {
        // Use the raw pronoun value for display name (not translated)
        parts.push(self.pronouns)
      }
      if (self.showCleanDate) {
        parts.push(self.recoveryDate)
      }
      if (self.showCleanDays) {
        const days = Math.floor(
          Math.abs(new Date().getTime() - new Date(self.recoveryDate).getTime()) /
            (1000 * 60 * 60 * 24),
        )
        parts.push(`${days}d`)
      }

      if (parts.length > 0) {
        return `${self.shortName} (${parts.join(" ")})`
      }
      return self.shortName
    },

    /**
     * Check if user has premium subscription
     */
    get isPremium(): boolean {
      return self.subscription === "Premium"
    },
  }))
  .actions(withSetPropAction)
  .actions((self) => {
    // Helper to persist sensitive data to SQLite
    const persistSecure = (data: SecureProfileData) => {
      // Fire-and-forget - don't await
      profileRepository.save(data).catch((err) => {
        log.error("Failed to persist to SQLite", { error: String(err) })
      })
    }

    return {
      /**
       * Hydrate sensitive data from SQLite on app startup
       * Called from ProfileHydrator after database is ready
       */
      hydrateFromSQLite(data: SecureProfileData) {
        if (data.shortName !== undefined) self.shortName = data.shortName
        if (data.pronouns !== undefined) self.pronouns = data.pronouns
        if (data.recoveryDate !== undefined) self.recoveryDate = data.recoveryDate
        if (data.fellowship !== undefined) self.fellowship = data.fellowship
        if (data.language !== undefined) {
          self.language = data.language
          // Sync to i18n if a language preference was stored
          if (data.language) {
            changeLanguage(data.language)
          }
        }

        self._isHydrated = true
      },

      // === VOLATILE SETTERS (persist to SQLite) ===

      /** Update volatile only (for real-time display name) — no SQLite write */
      setShortNameLocal(value: string) {
        self.shortName = value
      },

      /** Update volatile + persist to SQLite */
      setShortName(value: string) {
        self.shortName = value
        persistSecure({ shortName: value })
      },

      setPronouns(value: Pronouns) {
        self.pronouns = value
        persistSecure({ pronouns: value })
      },

      setRecoveryDate(date: Date) {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, "0")
        const day = String(date.getDate()).padStart(2, "0")
        const dateStr = `${year}-${month}-${day}`
        self.recoveryDate = dateStr
        persistSecure({ recoveryDate: dateStr })
      },

      setFellowship(value: string) {
        self.fellowship = value
        persistSecure({ fellowship: value })
        // Notify Live page to refresh with new fellowship filter
        liveEvents.preferencesChanged("fellowship")
      },

      /**
       * Set language and sync to i18n
       */
      setLanguage(value: string) {
        self.language = value
        persistSecure({ language: value })
        changeLanguage(value)
      },

      /** Batch-update multiple secure fields in a single SQLite write */
      setSecureProfile(data: SecureProfileData) {
        if (data.shortName !== undefined) self.shortName = data.shortName
        if (data.pronouns !== undefined) self.pronouns = data.pronouns
        if (data.recoveryDate !== undefined) self.recoveryDate = data.recoveryDate
        if (data.fellowship !== undefined) self.fellowship = data.fellowship
        if (data.language !== undefined) {
          self.language = data.language
          if (data.language) changeLanguage(data.language)
        }
        persistSecure(data)
      },

      // === PROP SETTERS (auto-persist to MMKV via snapshots) ===

      setShowCleanDate(value: boolean) {
        self.showCleanDate = value
      },

      setShowCleanDays(value: boolean) {
        self.showCleanDays = value
      },

      setShowPronouns(value: boolean) {
        self.showPronouns = value
      },

      setSubscription(value: string) {
        self.subscription = value
      },

      setSubscriptionExpires(value: string | null) {
        self.subscriptionExpires = value
      },

      setThemeColor(value: string) {
        self.themeColor = value
      },

      setAttendanceEnabled(value: boolean) {
        self.attendanceEnabled = value
      },

      setZoomConnected(value: boolean) {
        self.zoomConnected = value
      },

      setNotificationsEnabled(value: boolean) {
        self.notificationsEnabled = value
      },

      setReportEmail(value: string) {
        self.reportEmail = value
      },

      setImported(value: boolean) {
        self.imported = value
      },

      setAiConsentAccepted(value: boolean) {
        self.aiConsentAccepted = value
      },

      /**
       * Mark onboarding as completed
       */
      completeOnboarding() {
        self.onboardingCompleted = true
      },

      /**
       * Reset onboarding (for testing or re-onboarding)
       */
      resetOnboarding() {
        self.onboardingCompleted = false
        self.imported = false
      },

      /**
       * Set "don't show short meeting warning" preference
       */
      setDontShowShortMeetingWarning(value: boolean) {
        self.dontShowShortMeetingWarning = value
      },

      /**
       * Dismiss a home screen help card
       */
      dismissHomeCard(cardId: string) {
        if (!self.dismissedHomeCards.includes(cardId)) {
          self.dismissedHomeCards.push(cardId)
        }
      },

      /**
       * Reset home screen help cards (show all again)
       */
      resetHomeCards() {
        self.dismissedHomeCards.clear()
      },

      /**
       * Reset profile to defaults
       */
      reset() {
        // Reset volatile (sensitive) data
        self.shortName = "Joe B."
        self.pronouns = null
        self.recoveryDate = new Date().toISOString().split("T")[0]
        self.fellowship = "AA"
        self.language = ""

        // Reset props (non-sensitive) data
        self.showCleanDate = false
        self.showCleanDays = false
        self.showPronouns = false
        self.subscription = "Free"
        self.subscriptionExpires = null
        self.themeColor = ""
        self.onboardingCompleted = false
        self.dontShowShortMeetingWarning = false
        self.zoomConnected = false
        self.notificationsEnabled = true
        self.attendanceEnabled = false
        self.reportEmail = ""
        self.imported = false
        self.aiConsentAccepted = false
        self.dismissedHomeCards.clear()

        // Persist reset to SQLite
        persistSecure({
          shortName: self.shortName,
          pronouns: self.pronouns,
          recoveryDate: self.recoveryDate,
          fellowship: self.fellowship,
          language: self.language,
        })
      },
    }
  })

export interface ProfileStore extends Instance<typeof ProfileStoreModel> {}
export interface ProfileStoreSnapshot extends SnapshotOut<typeof ProfileStoreModel> {}
