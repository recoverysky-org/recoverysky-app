#!/bin/bash
# Full clean rebuild of the Expo React Native project
# Clears all caches, node_modules, and regenerates native ios/ and android/ folders
#
# Usage:
#   ./scripts/clean-rebuild.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "🧹 Starting full clean rebuild..."
echo ""

# 1. Clear node_modules
echo "📦 Removing node_modules..."
rm -rf node_modules

# 2. Clear Expo cache
echo "📱 Clearing Expo cache..."
rm -rf .expo

# 3. Clear Metro bundler cache
echo "🚇 Clearing Metro cache..."
rm -rf "$TMPDIR/metro-*" 2>/dev/null || true
rm -rf "$TMPDIR/haste-map-*" 2>/dev/null || true

# 4. Clear watchman
echo "👀 Clearing watchman..."
watchman watch-del-all 2>/dev/null || true

# 5. Delete native folders entirely
echo "🍎 Removing ios/ folder..."
rm -rf ios

echo "🤖 Removing android/ folder..."
rm -rf android

# 6. Reinstall dependencies
echo "📥 Reinstalling dependencies..."
npm install

# 7. Regenerate native folders with prebuild + patches
echo "🔧 Running expo prebuild --clean..."
npx expo prebuild --clean

echo "🩹 Running patch:splash..."
npm run patch:splash

echo "🩹 Running patch:android..."
npm run patch:android

echo ""
echo "✅ Clean rebuild complete!"
echo ""
echo "Run 'npm start -- --clear' to start the dev server"
