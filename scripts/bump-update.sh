#!/bin/bash
# bump-update.sh - Bump the OTA update counter in package.json and publish.
# Mirrors bump-version.sh (patch/minor/major) but for JS-only OTA releases:
# the version stays put, only the `update` field increments.
# Usage: ./scripts/bump-update.sh

set -e

# Preflight. `eas update` publishes straight to production users, and nothing
# else in this pipeline type-checks or tests first — so a broken bundle would
# reach every device on a matching runtimeVersion within minutes. Run before the
# counter bump, not after: a failure here must leave package.json, the tag, and
# the remote completely untouched, so re-running after the fix is clean.
#
# This CANNOT catch everything. app/services/sync/index.ts (the sync gate and
# queue-ownership machinery) has no automated coverage — vitest can't resolve
# its `@/` imports — so the attendance account-switch path is still only
# verified by the manual checklist in docs/BACKUP.md. Green here means "nothing
# obviously broken", not "safe to ship".
echo "Preflight: type-check..."
npm run compile

echo "Preflight: unit tests..."
npx vitest run

# Config gate. `release:ota` below publishes with `--environment production`,
# which means the bundle's EXPO_PUBLIC_* values come from the EAS server-side
# environment — NOT eas.json, NOT .env. Those three drift silently: on
# 2026-08-04 EXPO_PUBLIC_FELLOWSHIPS gained RD in .env and eas.json but not on
# EAS, so for nine days every OTA shipped an app missing Recovery Dharma from
# all five fellowship pickers, while the store binary built from the same commit
# had it. Nothing failed; nothing warned. This is that warning.
#
# `--eas-only` on purpose: the script's other half (.env vs eas.json) reports
# drift on any dev machine pointed at localhost, and a gate that always fails is
# a gate everyone learns to skip. Exit 2 (EAS unreadable — offline, logged out)
# blocks too: "couldn't verify" must not read as "verified".
echo "Preflight: OTA config (eas.json vs EAS production env)..."
node scripts/check-env-sync.js --eas-only

echo "Preflight passed."
echo ""

# Get current version + update counter from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
CURRENT_UPDATE=$(node -p "require('./package.json').update || '0'")
NEW_UPDATE=$((CURRENT_UPDATE + 1))

echo "Current: v$CURRENT_VERSION-$CURRENT_UPDATE"
echo "New:     v$CURRENT_VERSION-$NEW_UPDATE"

# Update package.json (`update` field is a string in the source — keep that)
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.update = '$NEW_UPDATE';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "Updated package.json"

# Git operations
echo "Committing OTA bump..."
git add package.json

git commit -m "$(cat <<EOF
🔖 ota: v$CURRENT_VERSION-$NEW_UPDATE

Bump OTA counter from $CURRENT_UPDATE to $NEW_UPDATE on v$CURRENT_VERSION

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"

TAG="v$CURRENT_VERSION-$NEW_UPDATE"
echo "Creating tag $TAG..."
git tag -a "$TAG" -m "OTA $TAG"

echo "Pushing to remote..."
git push && git push --tags

# Publish OTA last — only reaches users on a matching runtimeVersion native build.
echo "Publishing OTA via release:ota..."
npm run release:ota

# Upload source maps to Sentry so JS stack traces in the new OTA bundle
# decode to readable file:line frames. Native EAS builds handle this
# automatically via the Sentry config plugin; OTA bundles don't, so we
# trigger the upload explicitly here.
#
# Auth comes from SENTRY_AUTH_TOKEN. Org and project are read from the
# @sentry/react-native/expo plugin config in app.json. Failure is non-fatal —
# a missing source map upload doesn't warrant rolling back an OTA that already
# shipped.
#
# CHANGED 2026-07-13: token now comes from the EAS server-side `production`
# environment via `eas env:exec` instead of local $SENTRY_AUTH_TOKEN / .env.
# This is the same source `release:ota` (--environment production) uses for the
# bundle, so the whole OTA pipeline has ONE source of truth and no longer
# depends on whatever happens to be in the developer's local .env.
#
# The `dist` arg is REQUIRED: the uploader needs the directory `eas update`
# exported the bundles + .hbc.map sourcemaps into. Without it the tool just
# prints usage and exits non-zero (this silently failed every OTA until
# 4.5.0-7, where the maps had to be uploaded by hand). `release:ota` above
# leaves `dist/` in place, so it's available here.
echo "Uploading source maps to Sentry (token from EAS production env)..."
eas env:exec production "npx sentry-expo-upload-sourcemaps dist" || \
  echo "⚠️  Sentry source map upload failed (non-fatal). Stack traces will lack line numbers until the next successful upload."

echo ""
echo "✅ OTA $TAG bumped, pushed, and published!"
