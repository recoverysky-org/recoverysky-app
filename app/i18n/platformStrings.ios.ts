/**
 * Platform-specific i18n overrides (iOS)
 *
 * Empty on purpose — Android-only strings (the guest entry "Just join
 * meetings", spec 2026-09-27) must never enter the iOS bundle: iOS requires an
 * authenticated account, and App Store review rejected an earlier build for
 * shipping a no-account login string.
 */
export const platformStrings: Record<string, Record<string, Record<string, string>>> = {}
