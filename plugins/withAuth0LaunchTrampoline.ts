import {
  AndroidConfig,
  ConfigPlugin,
  withAndroidManifest,
  withDangerousMod,
} from "@expo/config-plugins"
import fs from "fs"
import path from "path"

/**
 * Android launcher trampoline so a home-screen tap during sign-in no longer
 * kills the Auth0 Custom Tab. Tracks RS-005 (git.rso app#4). Design: §D of
 * docs/superpowers/specs/2026-09-12-next-native-build-design.md — read it
 * before changing anything here; the audit of everything that reaches the app
 * through the launcher intent (expo-notifications above all) lives there.
 *
 * === Why ===
 *
 * `A0Auth0Module.onNewIntent` (react-native-auth0, 5.6.0 line 544, unchanged
 * through 5.11.1) rejects any pending web-auth promise with
 * `a0.session.browser_terminated` on ANY new intent that reaches
 * `MainActivity`. `MainActivity` is `singleTask` (Expo default, kept — see the
 * spec's §A non-goals), so a launcher-icon tap while the Custom Tab is open
 * does two things at once: Android clears every activity above `MainActivity`
 * in the task (the tab and Auth0's `AuthenticationActivity` both live in our
 * task, which is why the tab vanishes) and delivers the launch intent through
 * `onNewIntent`, which the SDK turns into the error. The Auth0 callback URI is
 * owned by `RedirectActivity`, and push taps require a signed-in user, so the
 * launcher tap is the only trigger — a user coming back to the app by tapping
 * its icon, which is exactly what "seven attempts in four minutes" looks like.
 *
 * With passwordless email sign-in (the recorded auth direction) every sign-up
 * sends the user to their mail app for a code, and the ones who return via the
 * app icon hit this by default. Hence a native fix, in the binary before
 * passwordless ships on top of it.
 *
 * === How ===
 *
 * Auth0's FAQ ("Auth0 web browser gets killed when going to the background on
 * Android") is the reference. The launcher no longer targets `MainActivity`;
 * it targets a throwaway `LaunchActivity` in `standard` launch mode. When the
 * app's task already exists, Android brings the task forward and stacks
 * `LaunchActivity` on top of whatever is there — the Custom Tab included — and
 * `LaunchActivity` simply `finish()`es, revealing the tab. No intent reaches
 * `MainActivity`, so `onNewIntent` never fires. On a true cold start
 * `LaunchActivity` is the task root, starts `MainActivity`, and finishes.
 *
 * Two deliberate departures from the FAQ text (spec §D "How it works"):
 *   1. `isTaskRoot()` instead of back-stack bookkeeping on `MainApplication`,
 *      so this plugin edits one generated file fewer and cannot drift from an
 *      Expo template change to either activity.
 *   2. The launch intent's action/data/extras are forwarded on cold start.
 *      expo-notifications opens the app from a notification tap with
 *      `getLaunchIntentForPackage()` plus the response in extras, and on a
 *      cold start reads those extras from the activity's intent. When the app
 *      is already running the response is delivered in-process and the intent
 *      only brings the task forward — the not-root branch, which forwards
 *      nothing. Both push-tap cases are on the device checklist.
 *
 * One more, not in the spec: `LaunchActivity` is locked to portrait like
 * `MainActivity`. It is on screen for a frame; without the lock a landscape
 * tablet would draw that frame in landscape and then rotate into the app.
 *
 * === Manifest ===
 *
 * The `MAIN`/`LAUNCHER` intent-filter MOVES from `.MainActivity` to
 * `.LaunchActivity` (same splash theme, so a cold start is visually identical;
 * `exported="true"` because the launcher is another process). Nothing about
 * `launchMode`, `taskAffinity`, `RedirectActivity`, or `MainActivity`'s
 * `VIEW exp+recoverysky-app` filter changes. No `noHistory` /
 * `excludeFromRecents` on the trampoline — `finish()` handles it and those
 * flags change Recents behaviour.
 *
 * This is the first plugin that MOVES an Expo-generated filter rather than
 * adding to the manifest. If a future Expo template puts `LAUNCHER` somewhere
 * new, the failure is loud (two launcher icons, or none): after every
 * `prebuild:clean`, check that the merged manifest has exactly ONE `LAUNCHER`
 * filter and that it is on `.LaunchActivity`. Idempotent — prebuild runs mods
 * on a fresh tree, but nothing here breaks if it runs twice.
 *
 * Plugin edits are native-shape changes: bump `runtimeVersion`. This one is
 * queued for the 4.11.0 native build (TODO.md "Next native build", §D).
 */

const LAUNCH_ACTIVITY_NAME = ".LaunchActivity"
const MAIN_ACTIVITY_NAME = ".MainActivity"
const SPLASH_THEME = "@style/Theme.App.SplashScreen"

type ManifestActivity = AndroidConfig.Manifest.ManifestActivity
type ManifestIntentFilter = AndroidConfig.Manifest.ManifestIntentFilter

function launchActivityKotlin(packageName: string): string {
  return `package ${packageName}

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * GENERATED by plugins/withAuth0LaunchTrampoline.ts — do not edit; edit the
 * plugin and run \`npm run prebuild:clean\`.
 *
 * Launcher trampoline (RS-005). The home-screen icon targets this activity
 * instead of the singleTask MainActivity, so a tap while the Auth0 Custom Tab
 * is open no longer clears the tab and no longer delivers an intent that
 * react-native-auth0's onNewIntent turns into "browser_terminated".
 *
 * - Task already exists: Android stacks this on top of whatever is showing
 *   (the Custom Tab included); finishing reveals it. Nothing reaches
 *   MainActivity.
 * - True cold start (task root): start MainActivity, forwarding the launch
 *   intent's action, data and extras so an expo-notifications cold-start tap
 *   still finds its response in MainActivity's intent.
 */
class LaunchActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (isTaskRoot) {
      val launch = intent
      startActivity(
        Intent(this, MainActivity::class.java).apply {
          action = launch.action
          data = launch.data
          launch.extras?.let { putExtras(it) }
        }
      )
    }
    finish()
  }
}
`
}

function isLauncherFilter(filter: ManifestIntentFilter): boolean {
  const hasMain = (filter.action ?? []).some(
    (a) => a.$["android:name"] === "android.intent.action.MAIN",
  )
  const hasLauncher = (filter.category ?? []).some(
    (c) => c.$["android:name"] === "android.intent.category.LAUNCHER",
  )
  return hasMain && hasLauncher
}

function launcherFilter(): ManifestIntentFilter {
  return {
    action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
    category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }],
  }
}

/**
 * The manifest mutation, exported on its own so it can be exercised against a
 * real generated manifest without running prebuild (see
 * `plugins/withAuth0LaunchTrampoline.check.ts`).
 */
export function applyLaunchTrampolineToManifest(
  manifest: AndroidConfig.Manifest.AndroidManifest,
): AndroidConfig.Manifest.AndroidManifest {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest)
  const activities: ManifestActivity[] = application.activity ?? []
  application.activity = activities

  // 1) Take the launcher filter OFF MainActivity. Everything else on it (the
  //    dev-client VIEW filter, launchMode, theme, orientation) stays.
  const main = activities.find((a) => a.$["android:name"] === MAIN_ACTIVITY_NAME)
  if (!main) {
    throw new Error(
      "withAuth0LaunchTrampoline: no .MainActivity in the manifest — the Expo template changed; re-read spec §D before adapting this plugin.",
    )
  }
  if (main["intent-filter"]) {
    main["intent-filter"] = main["intent-filter"].filter((f) => !isLauncherFilter(f))
  }

  // 2) Declare LaunchActivity, once, and give it the launcher filter, once.
  let launch = activities.find((a) => a.$["android:name"] === LAUNCH_ACTIVITY_NAME)
  if (!launch) {
    launch = {
      "$": {
        "android:name": LAUNCH_ACTIVITY_NAME,
        "android:exported": "true",
        "android:theme": SPLASH_THEME,
        "android:screenOrientation": "portrait",
      },
      "intent-filter": [],
    }
    activities.push(launch)
  }
  const filters = launch["intent-filter"] ?? []
  if (!filters.some(isLauncherFilter)) filters.push(launcherFilter())
  launch["intent-filter"] = filters

  // 3) Invariant the whole design rests on: exactly one LAUNCHER filter in
  //    the manifest, and it is on the trampoline. A second one means two
  //    icons in the drawer; none means the app cannot be launched.
  const launcherOwners = activities.filter((a) => (a["intent-filter"] ?? []).some(isLauncherFilter))
  if (launcherOwners.length !== 1 || launcherOwners[0] !== launch) {
    throw new Error(
      `withAuth0LaunchTrampoline: expected exactly one LAUNCHER filter on ${LAUNCH_ACTIVITY_NAME}, found ${launcherOwners.length}`,
    )
  }
  return manifest
}

const withLaunchActivitySource: ConfigPlugin = (config) => {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const packageName = config.android?.package
      if (!packageName) {
        throw new Error("withAuth0LaunchTrampoline: android.package is not set in app.json")
      }
      const dir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...packageName.split("."),
      )
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, "LaunchActivity.kt"), launchActivityKotlin(packageName))
      return config
    },
  ])
}

const withAuth0LaunchTrampoline: ConfigPlugin = (config) => {
  config = withLaunchActivitySource(config)
  return withAndroidManifest(config, (config) => {
    config.modResults = applyLaunchTrampolineToManifest(config.modResults)
    return config
  })
}

export default withAuth0LaunchTrampoline
