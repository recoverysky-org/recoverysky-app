#!/bin/bash
# Full clean rebuild of the Expo React Native project
# Clears all caches, node_modules, and regenerates native ios/ and android/ folders
#
# Usage:
#   ./scripts/clean-rebuild.sh              # Clean + prebuild only
#   ./scripts/clean-rebuild.sh --ios        # Also build + install iOS simulator dev client
#   ./scripts/clean-rebuild.sh --android    # Also build + install Android emulator dev client
#   ./scripts/clean-rebuild.sh --all        # Build + install both platforms
#   ./scripts/clean-rebuild.sh --xcode      # Also clear Xcode caches (DerivedData, CocoaPods, uninstall app)
#   ./scripts/clean-rebuild.sh --xcode --nuke  # Nuclear option: also erase all simulators

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Parse flags
BUILD_IOS=false
BUILD_ANDROID=false
CLEAN_XCODE=false
NUKE_SIMULATORS=false

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
    --xcode|-x)
      CLEAN_XCODE=true
      ;;
    --nuke|-n)
      NUKE_SIMULATORS=true
      ;;
  esac
done

echo "🧹 Starting full clean rebuild..."
if [ "$BUILD_IOS" = true ] || [ "$BUILD_ANDROID" = true ]; then
  echo "   (with development builds + simulator install)"
fi
if [ "$CLEAN_XCODE" = true ]; then
  echo "   (with Xcode cache cleaning)"
fi
if [ "$NUKE_SIMULATORS" = true ] && [ "$CLEAN_XCODE" = true ]; then
  echo "   (with simulator nuke ☢️)"
fi
echo ""

# 0. Clean Xcode caches if requested
if [ "$CLEAN_XCODE" = true ]; then
  echo "🍎 Clearing Xcode DerivedData..."
  rm -rf ~/Library/Developer/Xcode/DerivedData

  echo "🍎 Uninstalling app from simulator..."
  xcrun simctl uninstall booted com.recoveryskyhybrid 2>/dev/null || true

  echo "🍎 Cleaning CocoaPods cache..."
  pod cache clean --all 2>/dev/null || true
  rm -rf ~/Library/Caches/CocoaPods

  # Nuclear option: erase all simulators
  if [ "$NUKE_SIMULATORS" = true ]; then
    echo "☢️  Erasing ALL simulators (nuclear option)..."
    xcrun simctl erase all
  fi

  echo ""
fi

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
pnpm install

# 7. Regenerate native folders with prebuild + patches
echo "🔧 Running expo prebuild --clean..."
npx expo prebuild --clean

echo "🩹 Running patch:splash..."
npm run patch:splash

echo "🩹 Running patch:android..."
pnpm patch:android

# 8. Build and install development clients if requested
if [ "$BUILD_IOS" = true ]; then
  echo ""
  echo "🍎 Building iOS development client (simulator)..."
  pnpm build:ios:sim

  echo ""
  echo "📲 Installing iOS app to simulator..."
  pnpm install:ios:sim

  echo "🚀 Launching iOS app..."
  pnpm launch:ios:sim
fi

if [ "$BUILD_ANDROID" = true ]; then
  echo ""
  echo "🤖 Building Android development client (emulator)..."
  pnpm build:android:sim

  echo ""
  echo "📲 Installing Android app to emulator..."
  # Find the most recent APK and install it
  APK_FILE=$(ls -t build*.apk 2>/dev/null | head -1)
  if [ -n "$APK_FILE" ]; then
    adb install -r "$APK_FILE"
    echo "🚀 Launching Android app..."
    adb shell am start -n com.recoveryskyhybrid/.MainActivity
  else
    echo "⚠️  No APK found. You may need to install manually."
  fi
fi

echo ""
echo "✅ Clean rebuild complete!"
echo ""
echo "Run 'npm start -- --clear' to start the dev server"
