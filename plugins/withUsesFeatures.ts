import { ConfigPlugin, withAndroidManifest } from "@expo/config-plugins"

/**
 * Restore broad device coverage AND prune Expo's default-template
 * permissions that we don't actually use.
 *
 * Two jobs in one plugin because both operations work on the same
 * `<manifest>` node and the same `withAndroidManifest` hook:
 *
 *   1. Declare hardware features as NOT REQUIRED so Google Play
 *      doesn't filter cellular-less tablets, Chromebooks, Android Auto,
 *      or Android XR. Background below.
 *   2. Strip OS-level permissions Expo's base mod template injects by
 *      default ("OPTIONAL PERMISSIONS, REMOVE WHATEVER YOU DO NOT NEED"
 *      per the upstream comment in
 *      `@expo/config-plugins/.../withAndroidBaseMods.js`). These end
 *      up in the merged manifest even though `app.json.android.permissions`
 *      doesn't list them, and Play Console will flag SYSTEM_ALERT_WINDOW
 *      in particular as a sensitive permission requiring justification.
 *
 * === Feature non-requirement, the long story ===
 *
 * Android's manifest merger implicitly upgrades any permission-implied
 * feature to `required="true"` unless an explicit
 * `<uses-feature required="false" />` declaration appears. Concretely,
 * with the permission list this app carries:
 *
 *   - `RECORD_AUDIO` → implies `android.hardware.microphone` required
 *
 * On top of that, `android.hardware.touchscreen` is implicitly required
 * for every Android app unless explicitly opted out — this is the
 * silent filter that excludes clamshell Chromebooks.
 *
 * Before 4.5.0, the Zoom Meeting SDK's AAR contributed
 * `<uses-feature required="false">` declarations for all of these as
 * part of its manifest, and manifest merging propagated them into our
 * final APK. That kept the app available on cellular-less tablets,
 * Chromebooks, Android Auto, and Android XR.
 *
 * When the SDK was ripped out in 4.5.0, those friendly defaults
 * disappeared with it, and Play Console reported a -60% tablet
 * coverage loss, -100% Chromebook / Auto / XR loss, and a -3% phone
 * loss. None of these features are actually used by our app — all
 * meeting hardware (camera, mic, telephony, GPS) is the **external
 * Zoom app's** responsibility now, not ours. Joining a Zoom meeting
 * via `Linking.openURL` does not consume our process's permission
 * surface.
 *
 * This plugin restores the previous (Zoom-AAR-provided) coverage by
 * declaring the same set explicitly. The list intentionally mirrors
 * what Zoom shipped, plus `touchscreen` which the SDK also opted out
 * of, and keeps several entries (`telephony`, `camera`, `bluetooth_le`,
 * `location.gps`) defensively — even though the *permissions* that
 * implied them are no longer in `app.json`, leaving the declarations
 * in is harmless and protects against future libraries adding those
 * permissions back via manifest merging.
 *
 * Removing this plugin re-introduces the device-filter regression.
 */
const FEATURES_NOT_REQUIRED = [
  // Telephony filter — single biggest Chromebook/tablet exclusion.
  "android.hardware.telephony",
  // Camera filter — affects budget tablets and clamshell Chromebooks.
  "android.hardware.camera",
  "android.hardware.camera.autofocus",
  "android.hardware.camera.front",
  // Microphone — minor filter but pairs with RECORD_AUDIO permission.
  "android.hardware.microphone",
  // Location — neither GPS nor coarse location is required by our flows.
  "android.hardware.location",
  "android.hardware.location.gps",
  "android.hardware.location.network",
  // Bluetooth — declared so Bluetooth-less devices aren't excluded.
  "android.hardware.bluetooth",
  "android.hardware.bluetooth_le",
  // Touchscreen — silent Chromebook killer; clamshell laptops without
  // touchscreens fail the implicit default of required="true".
  "android.hardware.touchscreen",
  // Faketouch — Android Auto / TV; tied to touchscreen handling.
  "android.hardware.faketouch",
]

/**
 * Permissions Expo's base-mod template injects by default that we don't
 * actually use. They reach the merged manifest because Expo's upstream
 * `withAndroidBaseMods` template includes them as "OPTIONAL PERMISSIONS,
 * REMOVE WHATEVER YOU DO NOT NEED" — and we don't.
 *
 * NOTE: `VIBRATE` is intentionally NOT stripped. expo-notifications adds
 * it via its own AndroidManifest contribution; vibrating on a push is a
 * legitimate use. Leaving it in.
 */
const PERMISSIONS_TO_REMOVE = [
  // Sensitive permission ("draw over other apps") that Play Console flags.
  // We don't render any overlay outside our own activities.
  "android.permission.SYSTEM_ALERT_WINDOW",
  // Deprecated storage permissions on target SDK 29+ (we target 35). They
  // do nothing functionally and just bloat the permission list.
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
]

const withUsesFeatures: ConfigPlugin = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest

    // 1) Add uses-feature required="false" declarations.
    manifest["uses-feature"] = manifest["uses-feature"] ?? []
    const existingFeatures = new Set(
      manifest["uses-feature"].map((f) => f.$["android:name"]),
    )
    for (const name of FEATURES_NOT_REQUIRED) {
      if (existingFeatures.has(name)) continue
      manifest["uses-feature"].push({
        $: {
          "android:name": name,
          "android:required": "false",
        },
      })
    }

    // 2) Strip permissions Expo's base mod added by default but we don't use.
    if (manifest["uses-permission"]) {
      manifest["uses-permission"] = manifest["uses-permission"].filter(
        (p) => !PERMISSIONS_TO_REMOVE.includes(p.$["android:name"]),
      )
    }

    return config
  })
}

export default withUsesFeatures
