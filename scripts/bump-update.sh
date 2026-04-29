#!/bin/bash
# bump-update.sh - Bump the OTA update counter in package.json and publish.
# Mirrors bump-version.sh (patch/minor/major) but for JS-only OTA releases:
# the version stays put, only the `update` field increments.
# Usage: ./scripts/bump-update.sh

set -e

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
# Auth comes from SENTRY_AUTH_TOKEN (env or eas.json -> base.env). Org and
# project are read from the @sentry/react-native/expo plugin config in
# app.json. Failure is non-fatal — a missing source map upload doesn't
# warrant rolling back an OTA that already shipped.
if [ -n "$SENTRY_AUTH_TOKEN" ]; then
  echo "Uploading source maps to Sentry..."
  npx sentry-expo-upload-sourcemaps || \
    echo "⚠️  Sentry source map upload failed (non-fatal). Stack traces will lack line numbers until the next successful upload."
else
  echo "⚠️  SENTRY_AUTH_TOKEN not set — skipping Sentry source map upload."
  echo "    Set it in .env or your shell to enable: stack traces will lack line numbers without it."
fi

echo ""
echo "✅ OTA $TAG bumped, pushed, and published!"
