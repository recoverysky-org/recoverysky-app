#!/bin/bash
# Patch iOS native configuration after expo prebuild
# Applies settings that Expo doesn't handle automatically

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Patching iOS configuration..."

PBXPROJ="$PROJECT_DIR/ios/recoveryskyapp.xcodeproj/project.pbxproj"

if [ ! -f "$PBXPROJ" ]; then
  echo "Error: project.pbxproj not found at $PBXPROJ"
  echo "Run 'npx expo prebuild' first"
  exit 1
fi

# Fix OneSignal extension DEVELOPMENT_TEAM
# onesignal-expo-plugin sets DEVELOPMENT_TEAM to literal "undefined"
# instead of inheriting from the main target
if grep -q 'DEVELOPMENT_TEAM = undefined;' "$PBXPROJ"; then
  sed -i '' 's/DEVELOPMENT_TEAM = undefined;/DEVELOPMENT_TEAM = 75W22YQP29;/g' "$PBXPROJ"
  echo "Fixed DEVELOPMENT_TEAM for OneSignal extension"
else
  echo "DEVELOPMENT_TEAM already set"
fi

echo "iOS patches complete!"
