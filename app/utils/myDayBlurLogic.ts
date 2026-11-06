/**
 * Which Android blur implementation My Day's glass uses (spec D5, §4.6).
 *
 * Pure on purpose: no runtime `@/` or react-native import, so vitest can cover it.
 * `os` / `version` arrive as plain values (Platform.OS / Platform.Version) from MyDayBlur.
 *
 * ADDED 2026-11-04: the native blur (dimezisBlurView) is only dependable on Android 12 (API 31)
 * and later; below that we ask for "none", which expo-blur renders as a plain translucent overlay.
 * iOS and web return undefined so the prop is simply omitted there.
 */
export type AndroidBlurMethod = "none" | "dimezisBlurView"

export function decideAndroidBlurMethod(i: {
  os: string
  version: number | string
}): AndroidBlurMethod | undefined {
  if (i.os !== "android") return undefined
  return Number(i.version) >= 31 ? "dimezisBlurView" : "none"
}
