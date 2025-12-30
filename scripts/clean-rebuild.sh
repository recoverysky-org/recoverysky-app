#!/bin/bash
# Full clean rebuild of the Expo React Native project
# Clears all caches, node_modules, and regenerates native ios/ and android/ folders
#
# Usage:
#   ./scripts/clean-rebuild.sh              # Clean + prebuild only
#   ./scripts/clean-rebuild.sh --ios        # Also build iOS simulator dev client
#   ./scripts/clean-rebuild.sh --android    # Also build Android emulator dev client
#   ./scripts/clean-rebuild.sh --all        # Build both platforms

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Parse flags
BUILD_IOS=false
BUILD_ANDROID=false

for arg in "$@"; do
  case $arg in
    --ios|-i)
      BUILD_IOS=true
      ;;
    --android|-a)
      BUILD_ANDROID=true
      ;;
    --all)
      BUILD_IOS=true
      BUILD_ANDROID=true
      ;;
  esac
done

echo "🧹 Starting full clean rebuild..."
if [ "$BUILD_IOS" = true ] || [ "$BUILD_ANDROID" = true ]; then
  echo "   (with development builds)"
fi
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

# 8. Build development clients if requested
if [ "$BUILD_IOS" = true ]; then
  echo ""
  echo "🍎 Building iOS development client (simulator)..."
  npm run build:ios:sim
fi

if [ "$BUILD_ANDROID" = true ]; then
  echo ""
  echo "🤖 Building Android development client (emulator)..."
  npm run build:android:sim
fi

echo ""
echo "✅ Clean rebuild complete!"
echo ""

if [ "$BUILD_IOS" = false ] && [ "$BUILD_ANDROID" = false ]; then
  echo "Run 'npm start -- --clear' to start the dev server"
  echo ""
  echo "To build development clients:"
  echo "  npm run build:ios:sim      # iOS simulator"
  echo "  npm run build:android:sim  # Android emulator"
else
  echo "Run 'npm start -- --clear' to start the dev server"
  if [ "$BUILD_IOS" = true ]; then
    echo ""
    echo "Install iOS build to simulator:"
    echo "  npm run install:ios:sim && npm run launch:ios:sim"
  fi
fi
