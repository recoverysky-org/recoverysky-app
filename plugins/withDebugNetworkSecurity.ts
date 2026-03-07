import { ConfigPlugin, withAndroidManifest, withDangerousMod } from "@expo/config-plugins"
import fs from "fs"
import path from "path"

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`

const DEBUG_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>

    <application android:usesCleartextTraffic="true" android:networkSecurityConfig="@xml/network_security_config" tools:targetApi="28" tools:ignore="GoogleAppIndexingWarning" tools:replace="android:usesCleartextTraffic,android:networkSecurityConfig" />
</manifest>
`

/**
 * Adds tools:replace="android:usesCleartextTraffic" to the main manifest
 * to override the Zoom SDK's mobilertc AAR which sets it to false.
 */
const withMainManifestToolsReplace: ConfigPlugin = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults
    const app = manifest.manifest.application?.[0]
    if (app) {
      app.$["tools:replace"] = [
        app.$["tools:replace"],
        "android:usesCleartextTraffic",
      ]
        .filter(Boolean)
        .join(",")
    }
    return config
  })
}

/**
 * Writes debug-only network security config and manifest overrides.
 * Also patches the main manifest to win the merge against mobilertc AAR.
 */
const withDebugNetworkSecurity: ConfigPlugin = (config) => {
  // Patch main manifest for release builds
  config = withMainManifestToolsReplace(config)

  // Write debug-specific files
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot

      // Write network_security_config.xml
      const xmlDir = path.join(projectRoot, "android/app/src/debug/res/xml")
      fs.mkdirSync(xmlDir, { recursive: true })
      fs.writeFileSync(
        path.join(xmlDir, "network_security_config.xml"),
        NETWORK_SECURITY_CONFIG,
      )

      // Write debug AndroidManifest.xml with networkSecurityConfig + tools:replace
      const manifestPath = path.join(
        projectRoot,
        "android/app/src/debug/AndroidManifest.xml",
      )
      fs.writeFileSync(manifestPath, DEBUG_MANIFEST)

      return config
    },
  ])
}

export default withDebugNetworkSecurity
