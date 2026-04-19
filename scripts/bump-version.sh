#!/bin/bash
# bump-version.sh - Bump semver version in package.json and app.json
# Usage: ./scripts/bump-version.sh [patch|minor|major]

set -e

BUMP_TYPE="${1:-patch}"

if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Error: Invalid bump type '$BUMP_TYPE'. Use: patch, minor, or major"
  exit 1
fi

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

# Parse semver components
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Calculate new version
case "$BUMP_TYPE" in
  patch)
    NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
    ;;
  minor)
    NEW_VERSION="$MAJOR.$((MINOR + 1)).0"
    ;;
  major)
    NEW_VERSION="$((MAJOR + 1)).0.0"
    ;;
esac

echo "New version: $NEW_VERSION"

# Update package.json — bump version AND reset the OTA `update` counter to "0".
# Each native version starts a fresh OTA series; the counter is restarted so
# the in-app version display (`v{version}-{update}` in Settings) doesn't carry
# the previous native build's OTA count forward.
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$NEW_VERSION';
pkg.update = '0';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "Updated package.json (version + update counter reset)"

# Update app.json
node -e "
const fs = require('fs');
const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
app.version = '$NEW_VERSION';
fs.writeFileSync('app.json', JSON.stringify(app, null, 2) + '\n');
"
echo "Updated app.json"

# Update package-lock.json
if [ -f "package-lock.json" ]; then
  node -e "
const fs = require('fs');
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
lock.version = '$NEW_VERSION';
if (lock.packages && lock.packages['']) {
  lock.packages[''].version = '$NEW_VERSION';
}
fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
"
  echo "Updated package-lock.json"
fi

# Git operations
echo "Committing version bump..."
git add package.json app.json package-lock.json

git commit -m "$(cat <<EOF
🔖 release: v$NEW_VERSION

Bump version from $CURRENT_VERSION to $NEW_VERSION
Reset OTA update counter to 0

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"

echo "Creating tag v$NEW_VERSION..."
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

echo "Pushing to remote..."
git push && git push --tags

# Run prebuild last
echo "Running prebuild:clean..."
npm run prebuild:clean

echo ""
echo "✅ Version bumped to v$NEW_VERSION, pushed, and prebuilt!"
