import { AndroidConfig, ConfigPlugin, withAndroidManifest } from "@expo/config-plugins"

/**
 * Keep the portrait lock working on large screens under target SDK 36.
 *
 * === Why this exists ===
 *
 * Android 16 (API 36) ships an "adaptive apps" behavior change that applies
 * ONLY to apps targeting 36 or higher: on any display measuring `sw600dp` or
 * larger — tablets, unfolded foldables, Chromebooks, desktop windowing — the
 * platform stops honoring an app's orientation and resizability restrictions
 * entirely. Specifically, these are all ignored:
 *
 *   - `android:screenOrientation`   ← ours; set to "portrait" on MainActivity
 *   - `android:resizableActivity`
 *   - `android:minAspectRatio` / `android:maxAspectRatio`
 *   - `setRequestedOrientation()` / `getRequestedOrientation()` at runtime
 *
 * `app.json` sets `"orientation": "portrait"`, which is what makes Expo emit
 * `android:screenOrientation="portrait"` onto MainActivity during prebuild.
 * Without this opt-out, bumping targetSdkVersion 35 → 36 would silently put
 * every tablet and foldable user into landscape and freeform-resizable
 * windows — layouts this app has never been designed or tested for. There is
 * no responsive/breakpoint logic anywhere in `app/` (no `useWindowDimensions`
 * consumers, no tablet branches), so that is a real regression, not a
 * theoretical one.
 *
 * We DO have tablet users, and `withUsesFeatures` exists specifically to keep
 * the app visible to cellular-less tablets and Chromebooks — so this is not a
 * population we can shrug off.
 *
 * === Why the opt-out is safe but temporary ===
 *
 * `android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` is Google's
 * documented, sanctioned escape hatch for exactly this migration. Declared on
 * `<application>` it covers every activity in the app. It restores pre-36
 * behavior: our portrait lock is honored again on large screens.
 *
 * ⚠️ IT HAS AN EXPIRY. Google states the property has NO effect once the app
 * targets API 37 or higher. Play's rolling "target within 1 year of latest
 * release" rule means targetSdk 37 becomes mandatory around Aug 2027, so this
 * plugin buys roughly one year to do adaptive-layout work properly — it does
 * not remove the need for it. See TODO.md for the queued adaptive work; when
 * that lands, DELETE this plugin rather than trying to carry it to 37.
 *
 * Exemptions we deliberately do NOT rely on: Google exempts apps declaring
 * `android:appCategory="game"` (we are not a game, and mislabeling to dodge a
 * behavior change would be an obvious Play policy problem), and users can
 * individually opt in to an app's default aspect ratio via a system setting
 * (not something we can depend on). Screens under `sw600dp` — i.e. ordinary
 * phones, the vast majority of our installs — are unaffected either way.
 *
 * https://developer.android.com/about/versions/16/behavior-changes-16#adaptive-layouts
 */
const RESTRICTED_RESIZABILITY_PROPERTY =
  "android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY"

/**
 * `<property>` is not in @expo/config-plugins' `ManifestApplication` type — the
 * upstream types cover activity/service/receiver/meta-data/uses-library and
 * stop there. The underlying XML builder is untyped and round-trips arbitrary
 * nodes fine, so we widen locally rather than patching the package.
 */
type ManifestProperty = {
  $: {
    "android:name": string
    "android:value": string
  }
}

type ApplicationWithProperties = AndroidConfig.Manifest.ManifestApplication & {
  property?: ManifestProperty[]
}

const withRestrictedResizability: ConfigPlugin = (config) => {
  return withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults,
    ) as ApplicationWithProperties

    application.property = application.property ?? []

    // Idempotent: prebuild can run repeatedly against a warm android/ dir, and
    // a duplicate <property> with the same name is a manifest merger error.
    const alreadyDeclared = application.property.some(
      (p) => p.$?.["android:name"] === RESTRICTED_RESIZABILITY_PROPERTY,
    )
    if (!alreadyDeclared) {
      application.property.push({
        $: {
          "android:name": RESTRICTED_RESIZABILITY_PROPERTY,
          "android:value": "true",
        },
      })
    }

    return config
  })
}

export default withRestrictedResizability
