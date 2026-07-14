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
  - Convention: encode the version as `M|mm|pp|bbb` (e.g. 4.6.0 → `40600000`).

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
