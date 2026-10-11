/**
 * Does the persisted `userId` hold the device id instead of an Auth0 sub?
 *
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md).
 * The removed device-id login stored `deviceId` in `userId`. An install that
 * used it (Android, 2025-12-26 → 2026-05-14) still carries that value in MMKV,
 * and every identity consumer would treat it as a signed-in user — RevenueCat
 * logged in as the device id, the exact customer split that stranded 81
 * subscriptions. A real sub always has a provider prefix ("email|", "auth0|",
 * "google-oauth2|", "apple|"), so equality with the device id is unambiguous.
 *
 * Pure, no `@/` imports (CLAUDE.md "Test Runner Split").
 */
export function isLegacyDeviceIdUserId(i: {
  userId: string | undefined
  deviceId: string | undefined
}): boolean {
  return !!i.userId && !!i.deviceId && i.userId === i.deviceId
}
