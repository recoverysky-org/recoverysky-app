#!/usr/bin/env node
/**
 * EAS Build pre-install hook.
 *
 * Runs in the EAS Build environment BEFORE `npm install` (and therefore
 * before Expo's autolinking scans the workspace). When the build profile
 * is "production", we mutate `package.json` to add expo-dev-client and
 * its sibling packages to `expo.autolinking.exclude`, so they don't get
 * autolinked into the production AAB/IPA.
 *
 * Why: expo-dev-launcher transitively depends on
 * `com.google.mlkit:barcode-scanning` and
 * `com.google.android.gms:play-services-code-scanner`. Those drag in:
 *   - `DevLauncherExpoActivityConfigurator.setColor` — calls deprecated
 *     `Window.setStatusBarColor()` (Android 15 edge-to-edge warning).
 *   - `GmsBarcodeScanningDelegateActivity` declared with
 *     `android:screenOrientation="PORTRAIT"` (Android 16 large-screen
 *     warning).
 * Both classes/activities are unreachable at runtime in production
 * (the dev-launcher activity never runs in a production binary), but
 * Play Console's static bytecode analysis flags them anyway.
 *
 * R8 doesn't strip them because dev-launcher carries reflection-friendly
 * `@DoNotStrip` annotations. The cleanest fix is to never ship the
 * native modules in the first place.
 *
 * The mutation only happens in the EAS build's ephemeral checkout —
 * it never touches the repo's committed package.json. For development
 * and preview profiles, this script is a no-op so the dev menu /
 * QR-scan / Network inspector all keep working.
 *
 * Verify locally with:
 *   EAS_BUILD_PROFILE=production node scripts/eas-pre-install.js
 *   git diff package.json   # inspect, then `git checkout` to revert
 */

const fs = require("fs")
const path = require("path")

const PACKAGES_TO_EXCLUDE = [
  "expo-dev-client",
  "expo-dev-launcher",
  "expo-dev-menu",
]

const profile = process.env.EAS_BUILD_PROFILE
if (profile !== "production") {
  console.log(
    `[eas-pre-install] Skipping dev-client exclusion (EAS_BUILD_PROFILE=${profile || "<unset>"})`,
  )
  process.exit(0)
}

const pkgPath = path.join(__dirname, "..", "package.json")
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))

pkg.expo = pkg.expo || {}
pkg.expo.autolinking = pkg.expo.autolinking || {}
const existing = new Set(pkg.expo.autolinking.exclude || [])
for (const name of PACKAGES_TO_EXCLUDE) existing.add(name)
pkg.expo.autolinking.exclude = Array.from(existing).sort()

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8")
console.log(
  `[eas-pre-install] Excluded from autolinking for production: ${PACKAGES_TO_EXCLUDE.join(", ")}`,
)
