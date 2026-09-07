# Production Release Checklist

Step-by-step checklist for preparing and publishing a **native store release**.
(For JS-only OTA releases use `npm run update` — see CLAUDE.md → "Releasing".)

## Pre-Release

- [ ] **1. Confirm this actually needs a native build**
  - A native/store release is required only when `runtimeVersion` must change
    (new/changed native dependency, `app.json` native config, Podfile/Gradle,
    EAS plugins, Expo SDK). See CLAUDE.md → "Runtime Version & OTA Updates".
  - If the change is JS-only, stop — publish an OTA with `npm run update` instead.

- [ ] **2. Verify production config**
  - Production `EXPO_PUBLIC_*` values live in `eas.json` (`build.base.env`) and
    the EAS `production` environment — **not** `.env`. `.env` is local-dev-only.
  - Run `npm run check:env` to report drift between `.env` and `eas.json`.
  - Sanity-check `EXPO_PUBLIC_API_URL` / `AGENT_URL` point at production, not a
    localhost or dev IP.

- [ ] **3. Commit all feature work and the CHANGELOG**
  - Working tree must be clean before versioning.
  - Move `CHANGELOG.md` `[Unreleased]` content under a new `[X.Y.Z]` heading
    with the date. The bump script does **not** touch the changelog.

- [ ] **In-person nearby routes live in prod** (required since 4.8.0): the
      store build calls `GET /schedules/nearby`; confirm
      https://api.recoverysky.app/api/docs lists `/schedules/nearby` and
      `/meetings/nearby` BEFORE submitting. Dev/TestFlight against dev is
      fine; a store build without the prod routes degrades every located
      user to day-browse (nearbyFailed banner).

- [ ] **Translation review queue cleared** — `docs/translation-review-2026-08-03.md`
      tracks the machine-assisted strings awaiting a native-speaker pass.
      Confirm it's been reviewed (or explicitly waived) before this release
      ships; see `TODO.md` for the same item.
      CHANGED 2026-08-09: this used to restate the total as "133 strings
      (ar/de/fr/pt/ru/th/uk)". That was correct on 2026-08-03 and then drifted
      to 421 across eight locales as more namespaces landed — the same drift
      `TODO.md` had already been corrected for, which is why that entry now
      says to treat the review doc as authoritative and never restate its
      total. A count duplicated into a second file is the thing that goes
      stale; the pointer is the fix. Do not reintroduce a number here.

## Version & Native Config

- [ ] **4. Bump `runtimeVersion` in `app.json`** — MANUAL, most-forgotten step
  - Set `runtimeVersion` to the new `X.Y.Z` so it stays in sync with `version`.
  - `bump-version.sh` does **not** touch `runtimeVersion` — if you skip this, the
    OTA series stays on the old runtime and future OTAs miss the new build.

- [ ] **5. Bump Android `versionCode` in `app.json`** — MANUAL
  - Must be **strictly greater** than the last value uploaded to Play Store; the
    Play Store permanently rejects re-uploads at or below a used value.
  - `appVersionSource` is `local` with no `autoIncrement`, so EAS uses the exact
    value in `app.json`. `bump-version.sh` does **not** touch it.
  - Convention: encode the version as `M|mm|pp|bbb` (e.g. 4.7.0 → `40700000`).

- [ ] **6. Bump semver** — `npm run patch`, `npm run minor`, or `npm run major`
  - Updates `version` in `package.json` / `app.json` / `package-lock.json`.
  - **Resets the OTA `update` counter to `0`** (each native build starts a fresh
    OTA series).
  - Auto-creates the release commit (`🔖 release: vX.Y.Z`), tags `vX.Y.Z`,
    pushes commit + tag, and runs `npm run prebuild:clean`.
  - Because the script commits+tags automatically, do steps 4–5 (and the
    changelog in step 3) **before** running it so the tag captures them.

> **Note:** `scripts/bump-version.sh` handles commit, tag, push, and prebuild
> automatically. The manual push steps below are only needed if the script is
> modified to skip them.

## Push (manual flow only)

- [ ] **7. Commit version bump** — `/git-commit` (if script didn't auto-commit)
- [ ] **8. Push to remote** — `git push`
- [ ] **9. Push version tag** — `git push origin vX.Y.Z`

## Build & Submit

- [ ] **10. Build + submit to stores**
  - `npm run release:ios` — `eas build --profile production` + `eas submit --latest`
  - `npm run release:android` — same for Android
  - For iOS: checkout branch `prod-ios`, rebase `root`.

## Post-Release

- [ ] Verify the tag appears on the remote
- [ ] Smoke test the production build (TestFlight / internal track)
- [ ] Confirm store review submissions

### Network-aware maintenance (2026-09-06)

- [ ] Airplane mode → cold start: "Device Offline" full screen; disabling
      airplane mode recovers into a normal session within ~15s (reload).
- [ ] Airplane mode mid-session: blue-grey offline banner appears; logs show
      "Config poll skipped — device offline" and NO maintenance flip;
      disabling airplane mode clears the banner and logs
      "Network reconnected — immediate config refetch".
- [ ] API down while online (block api host / stop local API): amber
      maintenance banner after one failed poll cycle; cold start in the same
      state shows the "System Maintenance" full screen.
- [ ] Server MAINTENANCE_MODE=true: banner on warm start, full screen on
      cold start — unchanged from before.
- [ ] External-Zoom timer running while toggling airplane mode: timer modal
      survives both banner variants.
- [ ] While the offline banner is up, content underneath (screen headers, top
      list rows) stays readable and tappable — the banner overlays
      `insets.top + ~39pt` for the ENTIRE offline session, not just a
      transient moment, so a partially-hidden header is a real usability
      problem, not a one-frame glitch.
