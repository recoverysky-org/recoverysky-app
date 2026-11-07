/**
 * The phone's own contact picker, limited to one phone number, with no contacts permission
 * on either platform (support contacts spec D2). `null` on web and on any build that does not
 * link the module, so callers can hide the feature instead of crashing.
 *
 * ADDED 2026-11-06: a local module instead of expo-contacts. expo-contacts adds the contacts
 * read and write permissions to the Android manifest (and wants an iOS usage string), because
 * it re-queries the contacts provider by id. The pickers below need neither:
 * supportPolicy.test.ts greps this directory, app.json and plugins/ to keep it that way.
 * Autolinking finds this directory by its expo-module.config.json (Expo scans ./modules/*).
 *
 * `requireOptionalNativeModule`, not `requireNativeModule`: an OTA can reach a binary built
 * before this module existed, and there the lookup must yield null rather than throw at import.
 */
import { requireOptionalNativeModule } from "expo"

export interface PickedPhoneContactPayload {
  name: string
  number: string
}

export interface PhoneContactPickerNativeModule {
  /** Resolves `null` when the person cancels. Rejects with code ERR_NO_PICKER, ERR_NO_NUMBER or ERR_IN_PROGRESS. */
  pickPhoneContact(): Promise<PickedPhoneContactPayload | null>
}

const PhoneContactPicker =
  requireOptionalNativeModule<PhoneContactPickerNativeModule>("PhoneContactPicker")

export default PhoneContactPicker
