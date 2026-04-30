import {
  ConfigPlugin,
  withAndroidStyles,
  withDangerousMod,
} from "@expo/config-plugins"
import fs from "fs"
import path from "path"

/**
 * Make the Android post-system-splash phase look like a continuation of the
 * splash, instead of a 2-second white flash followed by the app.
 *
 * Background:
 *   - Android 12+ uses the SplashScreen API for the very first ~500ms (icon
 *     centered on a color, set via the `Theme.App.SplashScreen` theme).
 *   - When the system splash dismisses, the activity transitions to
 *     `AppTheme` (which extends `Theme.EdgeToEdge.Light`) BEFORE React
 *     Native has rendered anything. AppTheme's default `windowBackground`
 *     is white — so users see white for ~2s while the JS bundle loads, the
 *     native modules initialize, and the first frame paints.
 *
 * Fix:
 *   - Generate `res/drawable/splashscreen_window.xml` — a layer-list drawable
 *     that paints `splashscreen_background` (color from app.json) and
 *     centers the splash logo (`splashscreen_logo`, generated from
 *     `app-icon-all.png` per app.json) sized to match the system splash
 *     icon size.
 *   - Set `AppTheme.windowBackground` to `@drawable/splashscreen_window` so
 *     the activity window itself displays the splash visual during the
 *     bootstrap gap. No JS, no race — just a static drawable shown by the
 *     OS until the React root view paints over it.
 *
 * Result:
 *   - System splash (~500ms): centered icon on color.
 *   - Post-system-splash gap: same visual — centered icon on color.
 *   - JS renders: app paints over the windowBackground.
 */

const SPLASH_LOGO_DP = 288

const SPLASHSCREEN_WINDOW_XML = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splashscreen_background"/>
    <item
        android:gravity="center"
        android:width="${SPLASH_LOGO_DP}dp"
        android:height="${SPLASH_LOGO_DP}dp">
        <bitmap android:src="@drawable/splashscreen_logo" />
    </item>
</layer-list>
`

const withSplashscreenWindowDrawable: ConfigPlugin = (config) => {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const drawableDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "drawable",
      )
      fs.mkdirSync(drawableDir, { recursive: true })
      fs.writeFileSync(
        path.join(drawableDir, "splashscreen_window.xml"),
        SPLASHSCREEN_WINDOW_XML,
        "utf8",
      )
      return config
    },
  ])
}

const withAppThemeWindowBackground: ConfigPlugin = (config) => {
  return withAndroidStyles(config, (config) => {
    const styles = config.modResults
    const appTheme = styles.resources.style?.find((s) => s.$.name === "AppTheme")
    if (!appTheme) {
      return config
    }
    const items = appTheme.item ?? []
    const filtered = items.filter((i) => i.$.name !== "android:windowBackground")
    filtered.push({
      $: { name: "android:windowBackground" },
      _: "@drawable/splashscreen_window",
    })
    appTheme.item = filtered
    return config
  })
}

const withSplashScreenWindowBackground: ConfigPlugin = (config) => {
  config = withSplashscreenWindowDrawable(config)
  config = withAppThemeWindowBackground(config)
  return config
}

export default withSplashScreenWindowBackground
