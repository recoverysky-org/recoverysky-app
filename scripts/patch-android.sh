#!/bin/bash
# Patch Android native configuration after expo prebuild
# Applies settings that Expo doesn't handle automatically

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Patching Android configuration..."

MANIFEST="$PROJECT_DIR/android/app/src/main/AndroidManifest.xml"

if [ ! -f "$MANIFEST" ]; then
  echo "Error: AndroidManifest.xml not found at $MANIFEST"
  echo "Run 'npx expo prebuild' first"
  exit 1
fi

# Add usesCleartextTraffic for Metro bundler HTTP connection
if ! grep -q "usesCleartextTraffic" "$MANIFEST"; then
  sed -i '' 's/android:allowBackup="false"/android:allowBackup="false" android:usesCleartextTraffic="true"/' "$MANIFEST"
  echo "Added usesCleartextTraffic to AndroidManifest.xml"
else
  echo "usesCleartextTraffic already present"
fi

echo "Android patches complete!"
