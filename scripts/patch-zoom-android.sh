#!/bin/bash
# Patch Zoom SDK for Android — use local 6.7.5 AAR instead of Maven 6.7.2
# Idempotent: safe to run after every npm install
#
# What this does:
#   1. Extracts mobilertc.aar from the Zoom SDK 6.7.5 zip
#   2. Strips armeabi-v7a (32-bit ARM) — all modern devices are arm64
#   3. Strips unused feature .so libs (chat, messaging, PDF, ML, phone, etc.)
#   4. Places the slim AAR in android/libs/
#   5. Adds flatDir repository to android/build.gradle
#
# Size reduction: ~300MB original → ~130MB stripped (arm64-only, no bloat)
#
# The patch-package patch separately changes the Zoom RN module's
# build.gradle from Maven `us.zoom.meetingsdk:zoomsdk:6.7.2` to
# the local `mobilertc.aar`.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

ZIP_FILE="$PROJECT_DIR/zoom-sdk-android-6.7.5.37500.zip"
AAR_DEST="$PROJECT_DIR/android/libs/mobilertc.aar"
ROOT_GRADLE="$PROJECT_DIR/android/build.gradle"

# Unused Zoom SDK feature libraries safe to remove for a join-meeting-only app.
# These are loaded lazily by the SDK — removing them won't crash the app
# unless the corresponding feature is actually invoked at runtime.
STRIP_LIBS=(
  # In-meeting chat & messaging (~25MB)
  libzMsgAppCommon.so
  libzMsgUI.so
  libzChatUI.so
  # Phone/PSTN/Team Chat (~14MB)
  libzPTApp.so
  libzAppPTUI.so
  libzPSApp.so
  libzPSUI.so
  # PDF & annotation/whiteboard (~7MB)
  libpdfium_wrap.so
  libzoom_pdfium.so
  libannotate.so
  # ML/AI features (~5MB)
  libtensorflowlite_jni.so
  libtensorflowlite_gpu_jni.so
  # Deep Virtual Filters (~4MB)
  libdvf.so
  # WebView & misc UI (~6MB)
  libzUnifyWebView.so
  libzm_conf_universal_ui.so
  libzAppConfUI.so
  libzAppUI.so
  libzPreMeetingUI.so
  libzHybridClinicalNotesUI.so
  # USB peripherals (<1MB)
  libusb-1.0.so
  libuvc.so
)

# ── Step 0: Preflight ──────────────────────────────────────────────────────

if [ ! -f "$ZIP_FILE" ]; then
  echo "Zoom SDK zip not found at $ZIP_FILE — skipping Android AAR patch"
  exit 0
fi

if [ ! -d "$PROJECT_DIR/android" ]; then
  echo "android/ directory not found — run 'npx expo prebuild' first"
  exit 0
fi

# ── Step 1: Extract & strip AAR ───────────────────────────────────────────

if [ -f "$AAR_DEST" ]; then
  echo "Zoom SDK 6.7.5 AAR already in place"
else
  echo "Extracting Zoom SDK 6.7.5 AAR..."

  TMPDIR_ZOOM=$(mktemp -d)
  trap "rm -rf $TMPDIR_ZOOM" EXIT

  # Extract only the AAR from the zip
  unzip -q -o "$ZIP_FILE" \
    "zoom-sdk-android-6.7.5.37500/mobilertc-android-studio/mobilertc/mobilertc.aar" \
    -d "$TMPDIR_ZOOM"

  AAR_SRC="$TMPDIR_ZOOM/zoom-sdk-android-6.7.5.37500/mobilertc-android-studio/mobilertc/mobilertc.aar"

  if [ ! -f "$AAR_SRC" ]; then
    echo "Error: mobilertc.aar not found in zip"
    exit 1
  fi

  # ── Step 2: Strip architectures & unused libs ──────────────────────────

  AAR_WORK="$TMPDIR_ZOOM/aar-work"
  mkdir -p "$AAR_WORK"
  cd "$AAR_WORK"
  unzip -q "$AAR_SRC"

  # Remove 32-bit ARM (armeabi-v7a)
  if [ -d "jni/armeabi-v7a" ]; then
    BEFORE=$(du -sm jni/ | cut -f1)
    rm -rf "jni/armeabi-v7a"
    AFTER=$(du -sm jni/ | cut -f1)
    echo "  Stripped armeabi-v7a: ${BEFORE}MB → ${AFTER}MB"
  fi

  # Remove unused feature libraries from arm64-v8a
  STRIPPED_COUNT=0
  STRIPPED_SIZE=0
  for lib in "${STRIP_LIBS[@]}"; do
    LIBPATH="jni/arm64-v8a/$lib"
    if [ -f "$LIBPATH" ]; then
      FSIZE=$(stat -f%z "$LIBPATH" 2>/dev/null || stat -c%s "$LIBPATH" 2>/dev/null || echo 0)
      STRIPPED_SIZE=$((STRIPPED_SIZE + FSIZE))
      STRIPPED_COUNT=$((STRIPPED_COUNT + 1))
      rm "$LIBPATH"
    fi
  done
  echo "  Stripped $STRIPPED_COUNT unused feature libs ($((STRIPPED_SIZE / 1048576))MB)"

  FINAL_JNI=$(du -sm jni/ | cut -f1)
  echo "  Final native libs: ${FINAL_JNI}MB (arm64-v8a only)"

  # ── Step 3: Repackage & place AAR ──────────────────────────────────────

  AAR_STRIPPED="$TMPDIR_ZOOM/mobilertc-stripped.aar"
  zip -q -r "$AAR_STRIPPED" .

  cd "$PROJECT_DIR"

  mkdir -p "$(dirname "$AAR_DEST")"
  mv "$AAR_STRIPPED" "$AAR_DEST"

  SIZE_MB=$(du -m "$AAR_DEST" | cut -f1)
  echo "Zoom SDK 6.7.5 AAR installed: android/libs/mobilertc.aar (${SIZE_MB}MB)"
fi

# ── Step 4: Add flatDir to root build.gradle ─────────────────────────────

if [ ! -f "$ROOT_GRADLE" ]; then
  echo "Warning: android/build.gradle not found"
  exit 0
fi

if grep -q "flatDir" "$ROOT_GRADLE"; then
  echo "flatDir repository already configured"
else
  echo "Adding flatDir repository to android/build.gradle..."

  # Insert flatDir inside allprojects.repositories block, after the opening line
  sed -i '' '/allprojects {/,/repositories {/ {
    /repositories {/a\
\    flatDir { dirs "${rootProject.projectDir}/libs" }
  }' "$ROOT_GRADLE"

  echo "flatDir repository added"
fi

echo "Android Zoom SDK patch complete!"
