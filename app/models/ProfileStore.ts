import { Instance, SnapshotOut, types } from "mobx-state-tree"
import { withSetPropAction } from "./helpers/withSetPropAction"
import { translate } from "@/i18n"

/**
 * Pronoun options as an MST enumeration
 */
const PronounsEnum = types.enumeration("Pronouns", [
  "he/him",
  "she/her",
  "they/them",
  "em/ers",
])

export const ProfileStoreModel = types
  .model("ProfileStore")
  .props({
    // Profile display settings
    shortName: "Joe B.",
    pronouns: types.maybeNull(PronounsEnum),
    showCleanDate: true,
    showCleanDays: true,
    showPronouns: true,

    // Recovery info
    recoveryDate: types.optional(types.string, new Date().toISOString().split("T")[0]),
    fellowship: "AA",

    // Account info
    subscription: "Free",
    subscriptionExpires: types.maybeNull(types.string),

    // Appearance
    themeColor: types.optional(types.string, ""), // empty = use default tint

    // Onboarding
    onboardingCompleted: types.optional(types.boolean, false),
  })
  .views((self) => ({
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

      if (self.showPronouns && self.pronouns) {
        // Use the raw pronoun value for display name (not translated)
        parts.push(self.pronouns)
      }
      if (self.showCleanDate) {
        parts.push(self.recoveryDate)
      }
      if (self.showCleanDays) {
        const days = Math.floor(
          Math.abs(new Date().getTime() - new Date(self.recoveryDate).getTime()) /
            (1000 * 60 * 60 * 24)
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
  .actions((self) => ({
    setShortName(value: string) {
      self.shortName = value
    },

    setPronouns(value: "he/him" | "she/her" | "they/them" | "em/ers" | null) {
      self.pronouns = value
    },

    setShowCleanDate(value: boolean) {
      self.showCleanDate = value
    },

    setShowCleanDays(value: boolean) {
      self.showCleanDays = value
    },

    setShowPronouns(value: boolean) {
      self.showPronouns = value
    },

    setRecoveryDate(date: Date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, "0")
      const day = String(date.getDate()).padStart(2, "0")
      self.recoveryDate = `${year}-${month}-${day}`
    },

    setFellowship(value: string) {
      self.fellowship = value
    },

    setSubscription(value: string) {
      self.subscription = value
    },

    setThemeColor(value: string) {
      self.themeColor = value
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
    },

    /**
     * Reset profile to defaults
     */
    reset() {
      self.shortName = "Joe B."
      self.pronouns = null
      self.showCleanDate = true
      self.showCleanDays = true
      self.showPronouns = true
      self.recoveryDate = new Date().toISOString().split("T")[0]
      self.fellowship = "AA"
      self.subscription = "Free"
      self.subscriptionExpires = null
      self.themeColor = ""
      self.onboardingCompleted = false
    },
  }))

export interface ProfileStore extends Instance<typeof ProfileStoreModel> {}
export interface ProfileStoreSnapshot extends SnapshotOut<typeof ProfileStoreModel> {}
