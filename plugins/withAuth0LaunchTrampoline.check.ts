/**
 * Exercise the manifest half of withAuth0LaunchTrampoline against the LAST
 * generated manifest, without running prebuild:
 *
 *   npx tsx plugins/withAuth0LaunchTrampoline.check.ts [path/to/AndroidManifest.xml]
 *
 * Prints the launcher-relevant activities before and after, and applies the
 * mutation twice to prove idempotence. It is a check script, not a test:
 * `android/` is git-ignored, so there is nothing for vitest to load in CI.
 */
import { AndroidConfig } from "@expo/config-plugins"
import path from "path"

import { applyLaunchTrampolineToManifest } from "./withAuth0LaunchTrampoline"

async function main() {
  const file =
    process.argv[2] ??
    path.join(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml")
  const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(file)
  const describe = (m: AndroidConfig.Manifest.AndroidManifest) =>
    (AndroidConfig.Manifest.getMainApplicationOrThrow(m).activity ?? []).map((a) => ({
      name: a.$["android:name"],
      launchMode: a.$["android:launchMode"],
      theme: a.$["android:theme"],
      filters: (a["intent-filter"] ?? []).map((f) => ({
        actions: (f.action ?? []).map((x) => x.$["android:name"]),
        categories: (f.category ?? []).map((x) => x.$["android:name"]),
        data: (f.data ?? []).map((x) => x.$["android:scheme"] ?? JSON.stringify(x.$)),
      })),
    }))

  console.log("BEFORE", JSON.stringify(describe(manifest), null, 2))
  applyLaunchTrampolineToManifest(manifest)
  applyLaunchTrampolineToManifest(manifest) // idempotence
  console.log("AFTER (applied twice)", JSON.stringify(describe(manifest), null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
