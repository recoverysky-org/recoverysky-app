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
  // ADDED 2026-09-28: the react-native-auth0 plugin bakes its `domain` into
  // the native redirect handler (Android's RedirectActivity intent-filter
  // host). The browser login's callback is
  // recoverysky-app://<auth0 domain>/android/<package>/callback, so the baked
  // host must equal the tenant the JS talks to, or Android never hands the
  // callback back to the app and the login hangs on Auth0's page (iOS matches
  // on the scheme alone and doesn't care). Taking it from
  // EXPO_PUBLIC_AUTH0_DOMAIN keeps native and JS on the same tenant: EAS
  // builds get auth.recoverysky.app from eas.json (identical output to the
  // static value), local dev builds get whatever .env points at (the dev
  // tenant). app.json's value is the fallback when the variable is unset.
  // Beware: a stale EXPO_PUBLIC_AUTH0_DOMAIN exported in your shell (the
  // .envrc runs `dotenv`) wins over .env here, same as for the JS bundle.
  const auth0Domain = process.env.EXPO_PUBLIC_AUTH0_DOMAIN
  const existingPlugins = (config.plugins ?? []).map(
    (plugin): NonNullable<ExpoConfig["plugins"]>[number] =>
      auth0Domain && Array.isArray(plugin) && plugin[0] === "react-native-auth0"
        ? [plugin[0], { ...(plugin[1] as Record<string, unknown>), domain: auth0Domain }]
        : plugin,
  )

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
      // Target SDK 36 makes Android ignore `screenOrientation="portrait"` on
      // any sw600dp+ display (tablets, foldables, Chromebooks). This declares
      // Google's temporary opt-out property so our tablet users keep the
      // portrait-locked app they have today. The property STOPS WORKING at
      // targetSdk 37 (~Aug 2027) — see the plugin source and TODO.md.
      "./plugins/withRestrictedResizability",
      // Android: the launcher icon targets a throwaway LaunchActivity instead
      // of the singleTask MainActivity, so a home-screen tap while the Auth0
      // Custom Tab is open no longer kills the sign-in (RS-005). See the
      // plugin header and spec §D. Native-shape change: 4.11.0.
      "./plugins/withAuth0LaunchTrampoline",
    ],
  }
}
