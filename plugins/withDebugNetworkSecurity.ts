import { ConfigPlugin, withDangerousMod } from "@expo/config-plugins"
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

const withDebugNetworkSecurity: ConfigPlugin = (config) => {
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
