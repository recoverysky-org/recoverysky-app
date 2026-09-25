import { Instance, SnapshotOut, types } from "mobx-state-tree"

import { ANNOUNCEMENTS } from "@/config/announcements"
import { liveEvents } from "@/db"
import { profileRepository } from "@/db/repositories"
import { changeLanguage, translate } from "@/i18n"
import { todayLocalISODate } from "@/utils/localDate"
import { getLocalDay } from "@/utils/localDay"
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
    // Cloud backup opt-in — default OFF. Attendance data reveals meeting
    // attendance; backing it up to the server is explicit user consent
    // (Settings toggle), never automatic. See the 2026-07-09 sync spec.
    syncEnabled: types.optional(types.boolean, false),
    enableMeetingTopic: types.optional(types.boolean, true),
    reportEmail: types.optional(types.string, ""),

    // Notifications
    // CHANGED 2026-08-08: default flipped true → false. Push is now gated on
    // the premium entitlement and a non-premium user cannot turn it off from
    // Settings (every tap routes to the paywall), so defaulting it ON would
    // trap them receiving notifications. Only affects NEW installs — existing
    // users have a persisted MMKV value that wins over this default.
    notificationsEnabled: types.optional(types.boolean, false),

    // Location — default OFF. Nothing in the app may read a position until
    // the user turns this on, and the In-Person segment gate is what asks
    // (app/utils/locationGateLogic.ts). Kept separate from the OS permission
    // on purpose: an app cannot revoke its own OS grant, so this is the only
    // switch that can actually mean "stop using my location".
    locationEnabled: types.optional(types.boolean, false),

    // Import
    imported: types.optional(types.boolean, false),

    // AI consent (Apple Guideline 5.1.2(i))
    aiConsentAccepted: types.optional(types.boolean, false),

    // Home screen help cards
    dismissedHomeCards: types.optional(types.array(types.string), []),

    // Ids of announcements the user has already seen (one-time popup).
    // Device-scoped: intentionally NOT cleared on logout/reset — clearing it
    // would re-pop the modal after every re-login.
    seenAnnouncementIds: types.optional(types.array(types.string), []),

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
    // CHANGED 2026-08-13: was "Anon M.". A pre-filled placeholder-looking value
    // reads as a name the user already chose, so it survived onboarding and
    // ended up printed on attendance reports. Empty lets the input show its
    // real placeholder ("e.g., Jane D.") and makes "unset" detectable.
    // NOTE: "Anon M." is still persisted in existing installs' SQLite — any
    // "has the user set a name?" check must treat BOTH values as unset. See
    // OnboardingImport's Firebase import guard.
    shortName: "",
    pronouns: null as Pronouns,
    // Device-LOCAL today, NOT `toISOString()` (UTC) — a user behind UTC in the
    // evening would otherwise default to *tomorrow*. See todayLocalISODate.
    recoveryDate: todayLocalISODate(),
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
      // Normalize to noon for consistent day calculation.
      // CHANGED 2026-09-22: "today" comes from the observable getLocalDay()
      // instead of `new Date()`. A computed is cached while observed and the
      // clock isn't a dependency, so the count froze at the cold-start day
      // for as long as the app stayed alive in the background.
      const today = new Date(getLocalDay() + "T12:00:00")
      const diffTime = Math.abs(today.getTime() - recovery.getTime())
      // CHANGED 2026-09-25: was Math.floor. Noon to noon is 1 h short of a whole
      // number of days whenever a spring-forward DST change sits between the
      // two dates without its matching fall-back, and flooring dropped a day
      // for most of the year (US: Jan 1 → Sep 25 read 266, not 267) — the
      // `(Nd)` in displayName then disagreed with CleanTimeCard's exact count.
      return Math.round(diffTime / (1000 * 60 * 60 * 24))
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
        // CHANGED 2026-09-22: was an inline `new Date()` diff, which froze with
        // the computed cache (see cleanDays) and parsed recoveryDate as UTC
        // midnight — off by one for devices behind UTC. cleanDays fixes both.
        parts.push(`${this.cleanDays}d`)
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

      setSyncEnabled(value: boolean) {
        self.syncEnabled = value
      },

      setEnableMeetingTopic(value: boolean) {
        self.enableMeetingTopic = value
      },

      setNotificationsEnabled(value: boolean) {
        self.notificationsEnabled = value
      },

      setLocationEnabled(value: boolean) {
        self.locationEnabled = value
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
        // Fresh install caught-up baseline: a user finishing onboarding never
        // wants "NEW feature!" popups for features that shipped WITH their
        // install. Mark every currently-bundled announcement as already seen.
        // Existing users (already onboarded in a prior build) never hit this
        // path, so their empty seen-set lets the current announcement show.
        // Inlined (not a sibling action call) because MST doesn't type sibling
        // actions on `self` within the same .actions() block.
        for (const id of ANNOUNCEMENTS.map((a) => a.id)) {
          if (!self.seenAnnouncementIds.includes(id)) {
            self.seenAnnouncementIds.push(id)
          }
        }
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
       * Mark an announcement as seen so its one-time popup never shows again.
       */
      markAnnouncementSeen(id: string) {
        if (!self.seenAnnouncementIds.includes(id)) {
          self.seenAnnouncementIds.push(id)
        }
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

      /**
       * Atomically set the 90-in-90 start using a real historical epoch
       * (NOT Date.now()). Used when importing legacy Firebase data so the
       * imported start is preserved exactly — `setNinetyStartDate` would
       * stamp `ninetyStartEpoch` with "now", which would skew downstream
       * attendance-window filters and the days-elapsed display. Input is
       * Unix milliseconds; the Firebase preferences.ninetyStart field is
       * documented as epoch-ms. Returns the resolved ISO date so callers
       * can log it.
       */
      importNinetyStart(epochMs: number): string | null {
        if (epochMs <= 0) return null
        const iso = new Date(epochMs).toISOString().split("T")[0] ?? ""
        if (!iso) return null
        self.ninetyStartDate = iso
        self.ninetyStartEpoch = epochMs
        return iso
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
        // Keep in sync with the volatile default above so a reset profile
        // matches a fresh install (CHANGED 2026-08-13: was "Anon M.").
        self.shortName = ""
        self.pronouns = null
        // Device-LOCAL today (not UTC) — keep in sync with the volatile default
        // above so a freshly reset profile matches a fresh install.
        self.recoveryDate = todayLocalISODate()
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
        // CHANGED 2026-08-08: was `true`. A reset that re-enabled push would
        // hand a non-premium user notifications they cannot switch off, since
        // the Settings row routes to the paywall instead of toggling.
        self.notificationsEnabled = false
        self.locationEnabled = false
        self.attendanceEnabled = true
        self.syncEnabled = false // opt-in resets with the profile — consent doesn't survive a reset
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
