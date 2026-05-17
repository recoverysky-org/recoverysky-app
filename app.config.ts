import { ExpoConfig, ConfigContext } from "@expo/config"

/**
 * Use tsx/cjs here so we can use TypeScript for our Config Plugins
 * and not have to compile them to JavaScript.
 *
 * See https://docs.expo.dev/config-plugins/plugins/#add-typescript-support-and-convert-to-dynamic-app-config
 */
import "tsx/cjs"

/**
 * @param config ExpoConfig coming from the static config app.json if it exists
 *
 * You can read more about Expo's Configuration Resolution Rules here:
 * https://docs.expo.dev/workflow/configuration/#configuration-resolution-rules
 */
module.exports = ({ config }: ConfigContext): Partial<ExpoConfig> => {
  const existingPlugins = config.plugins ?? []

  return {
    ...config,
    ios: {
      ...config.ios,
      // This privacyManifests is to get you started.
      // See Expo's guide on apple privacy manifests here:
      // https://docs.expo.dev/guides/apple-privacy/
      // You may need to add more privacy manifests depending on your app's usage of APIs.
      // More details and a list of "required reason" APIs can be found in the Apple Developer Documentation.
      // https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
      privacyManifests: {
        NSPrivacyAccessedAPITypes: [
          {
            NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
            NSPrivacyAccessedAPITypeReasons: ["CA92.1"], // CA92.1 = "Access info from same app, per documentation"
          },
        ],
      },
    },
    plugins: [
      ...existingPlugins,
      // Debug-only: allow cleartext traffic so Metro can reach a physical
      // device over plaintext HTTP during dev. Also adds a defensive
      // tools:replace on the main manifest so our cleartext attribute wins
      // any future library-manifest merge conflict.
      "./plugins/withDebugNetworkSecurity",
      // Eliminate the white flash between Android system splash and JS first
      // paint by setting AppTheme's windowBackground to a layered drawable
      // that mirrors the splash (logo centered on splash background color).
      "./plugins/withSplashScreenWindowBackground",
      // Declare hardware features as required="false" so Play doesn't
      // filter cellular-less tablets / Chromebooks / Android Auto / Android
      // XR. See plugin source for the full story — short version: the Zoom
      // SDK's AAR used to contribute these declarations and we lost them
      // when we ripped the SDK out in 4.5.0.
      "./plugins/withUsesFeatures",
    ],
  }
}
