# Production Release Checklist

Step-by-step checklist for preparing and publishing a production release.

## Pre-Release

- [ ] **1. Set API URL in `.env`**
  - Ensure `EXPO_PUBLIC_API_URL` points to the production server
  - Verify it is **not** a localhost or development IP address

- [ ] **2. Verify all values in `.env`**
  - `EXPO_PUBLIC_API_URL` — production API
  - `EXPO_PUBLIC_AGENT_URL` — production agent
  - `EXPO_PUBLIC_ZOOM_SDK_KEY` — production Zoom SDK key
  - `EXPO_PUBLIC_ZOOM_SDK_SECRET` — production Zoom SDK secret
  - Cross-reference with `eas.json` `build.base.env` for consistency

## Commit & Version

- [ ] **3. Commit all changes** — `/git-commit`
  - Ensure working tree is clean before versioning
  - All features, fixes, and config changes committed

- [ ] **4. Bump version** — `npm run patch`, `npm run minor`, or `npm run major`
  - Updates `package.json` and `app.json`
  - Auto-creates a release commit (`🔖 release: vX.Y.Z`)
  - Auto-creates a git tag (`vX.Y.Z`)
  - Auto-pushes commit and tag to remote
  - Auto-runs `npm run prebuild:clean`

> **Note:** The bump script (`scripts/bump-version.sh`) handles commit, tag, push, and prebuild automatically. Steps 5–7 below are only needed if running the process manually or if the script is modified to skip those steps.

## Push (manual flow only)

- [ ] **5. Commit version bump** — `/git-commit` (if script didn't auto-commit)
- [ ] **6. Push to remote** — `git push`
- [ ] **7. Push version tag** — `git push origin vX.Y.Z`

## Post-Release

- [ ] Verify the tag appears on the remote
- [ ] Trigger EAS build if not automated
- [ ] Smoke test the production build
