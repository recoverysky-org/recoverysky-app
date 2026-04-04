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

# Patch Podfile: add ZoomMeetingSDK version pin for dev/production switching
# ZoomMeetingSDK 6.7.5 dropped x86_64 simulator support. Pin to 6.7.2 for
# local dev by default; ZOOM_PRODUCTION=1 pod install resolves to 6.7.5.
PODFILE="$PROJECT_DIR/ios/Podfile"

if [ -f "$PODFILE" ]; then
  if grep -q 'ZOOM_PRODUCTION' "$PODFILE"; then
    echo "ZoomMeetingSDK pod pin already present"
  else
    # Insert the conditional pin block before `use_react_native!`
    sed -i '' '/use_react_native!/i\
\
  # ZoomMeetingSDK 6.7.5 dropped x86_64 simulator support (arm64-simulator only).\
  # Default to 6.7.2 for local dev (ships fat binary with both x86_64 and arm64).\
  # For production builds: ZOOM_PRODUCTION=1 pod install -> resolves to 6.7.5 (~88MB smaller).\
  unless ENV['"'"'ZOOM_PRODUCTION'"'"'] == '"'"'1'"'"'\
    pod '"'"'ZoomMeetingSDK'"'"', '"'"'6.7.2'"'"'\
  end\
' "$PODFILE"
    echo "Added ZoomMeetingSDK conditional pod pin to Podfile"
  fi
else
  echo "Warning: Podfile not found at $PODFILE (run prebuild first)"
fi

echo "iOS patches complete!"
