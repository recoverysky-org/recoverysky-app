import { getLocales } from "expo-localization"

/**
 * The device's region code ("US", "GB"), or null when the OS reports none.
 * ADDED 2026-11-06: the support-contact flow uses it to pick the crisis line.
 * It is the region the person chose in system settings, not a location, and
 * nothing is stored.
 */
export function getDeviceRegion(): string | null {
  return getLocales()[0]?.regionCode ?? null
}
