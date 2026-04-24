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
  userIdNum?: string | null
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
    enableMeetingTopic: types.optional(types.boolean, true),
    reportEmail: types.optional(types.string, ""),

    // Zoom
    zoomConnected: types.optional(types.boolean, false),

    // Notifications
    notificationsEnabled: types.optional(types.boolean, true),

    // Import
    imported: types.optional(types.boolean, false),

    // AI consent (Apple Guideline 5.1.2(i))
    aiConsentAccepted: types.optional(types.boolean, false),

    // Advanced
    useExternalZoom: types.optional(types.boolean, true),

    // Home screen help cards
    dismissedHomeCards: types.optional(types.array(types.string), []),

    // Money saved
    moneySavedWeekly: types.optional(types.number, 0), // simple weekly total
    moneySavedMon: types.optional(types.number, 0),
    moneySavedTue: types.optional(types.number, 0),
    moneySavedWed: types.optional(types.number, 0),
    moneySavedThu: types.optional(types.number, 0),
    moneySavedFri: types.optional(types.number, 0),
    moneySavedSat: types.optional(types.number, 0),
    moneySavedSun: types.optional(types.number, 0),
    moneySavedTobacco: types.optional(types.number, 0), // daily tobacco, applied to all days

    // 90 in 90 challenge
    ninetyStartDate: types.optional(types.string, ""), // ISO "YYYY-MM-DD" or "" = not started
    ninetyStartEpoch: types.optional(types.number, 0), // Unix ms when challenge was started (for filtering)
    ninetyStrictMode: types.optional(types.boolean, true),
    ninetyCertificatePath: types.optional(types.string, ""),
    ninetyDebugDay: types.optional(types.number, 0), // DEV only: next day offset for debug insert
  })
  .volatile(() => ({
    // === SENSITIVE (stored in encrypted SQLite, NOT in snapshots) ===
    shortName: "Anon M.",
    pronouns: null as Pronouns,
    recoveryDate: new Date().toISOString().split("T")[0],
    fellowship: "AA",
    language: "", // empty = use device locale
    userIdNum: "" as string,

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
        if (data.userIdNum !== undefined) self.userIdNum = data.userIdNum ?? ""

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

      setUserIdNum(value: string) {
        self.userIdNum = value
        persistSecure({ userIdNum: value || null })
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
        if (data.userIdNum !== undefined) self.userIdNum = data.userIdNum ?? ""
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

      setEnableMeetingTopic(value: boolean) {
        self.enableMeetingTopic = value
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

      setUseExternalZoom(_value: boolean) {
        // External Zoom is hard-coded on for all users; setter is a no-op.
        if (!self.useExternalZoom) {
          self.useExternalZoom = true
          liveEvents.preferencesChanged("useExternalZoom")
        }
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

      // === MONEY SAVED ===

      setMoneySavedWeekly(value: number) {
        self.moneySavedWeekly = value
      },

      setMoneySavedDay(day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun", value: number) {
        const key = `moneySaved${day}` as keyof typeof self
        ;(self as any)[key] = value
      },

      setMoneySavedTobacco(value: number) {
        self.moneySavedTobacco = value
      },

      // === 90 IN 90 CHALLENGE ===

      setNinetyStartDate(value: string) {
        self.ninetyStartDate = value
        self.ninetyStartEpoch = value ? Date.now() : 0
      },

      setNinetyStrictMode(value: boolean) {
        self.ninetyStrictMode = value
      },

      setNinetyCertificatePath(value: string) {
        self.ninetyCertificatePath = value
      },

      setNinetyDebugDay(value: number) {
        self.ninetyDebugDay = value
      },

      resetNinetyChallenge() {
        self.ninetyStartDate = ""
        self.ninetyStartEpoch = 0
        self.ninetyStrictMode = true
        self.ninetyCertificatePath = ""
        self.ninetyDebugDay = 0
      },

      /**
       * Reset profile to defaults
       */
      reset() {
        // Reset volatile (sensitive) data
        self.shortName = "Anon M."
        self.pronouns = null
        self.recoveryDate = new Date().toISOString().split("T")[0]
        self.fellowship = "AA"
        self.language = ""
        self.userIdNum = ""

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
        self.attendanceEnabled = true
        self.enableMeetingTopic = true
        self.reportEmail = ""
        self.imported = false
        self.aiConsentAccepted = false
        self.dismissedHomeCards.clear()
        self.moneySavedWeekly = 0
        self.moneySavedMon = 0
        self.moneySavedTue = 0
        self.moneySavedWed = 0
        self.moneySavedThu = 0
        self.moneySavedFri = 0
        self.moneySavedSat = 0
        self.moneySavedSun = 0
        self.moneySavedTobacco = 0
        self.ninetyStartDate = ""
        self.ninetyStartEpoch = 0
        self.ninetyStrictMode = true
        self.ninetyCertificatePath = ""
        self.ninetyDebugDay = 0

        // Persist reset to SQLite
        persistSecure({
          shortName: self.shortName,
          pronouns: self.pronouns,
          recoveryDate: self.recoveryDate,
          fellowship: self.fellowship,
          language: self.language,
          userIdNum: null,
        })
      },
    }
  })

export interface ProfileStore extends Instance<typeof ProfileStoreModel> {}
export interface ProfileStoreSnapshot extends SnapshotOut<typeof ProfileStoreModel> {}
