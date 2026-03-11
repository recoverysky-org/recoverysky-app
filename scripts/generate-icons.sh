#!/usr/bin/env bash
#
# generate-icons.sh — Regenerate all derived app icons from source images
#
# Source images (user-managed, never overwritten by this script):
#   assets/images/app-icon-all.png                          — Universal icon (1024x1024)
#   assets/images/app-icon-ios.png                          — iOS icon (1024x1024)
#   assets/images/app-icon-android-adaptive-foreground.png  — Android adaptive foreground (transparent)
#   assets/images/app-icon-android-adaptive-background.png  — Android adaptive background
#   assets/images/splash.png                                — Splash screen (hand-crafted, not generated)
#
# Generated images:
#   assets/images/app-icon-android-legacy.png  — Android legacy icon (1024x1024, from app-icon-all)
#   assets/images/app-icon-web-favicon.png     — Web favicon (48x48, from app-icon-all)
#
# Requirements: python3 with Pillow (pip install Pillow)
#
# Usage: npm run generate:icons
#        or: bash scripts/generate-icons.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGES="$PROJECT_DIR/assets/images"

# Source files
ALL="$IMAGES/app-icon-all.png"

# Verify sources exist
for src in "$ALL"; do
  if [ ! -f "$src" ]; then
    echo "❌ Missing source: $src"
    exit 1
  fi
done

echo "🎨 Generating derived icons..."

python3 << PYEOF
from PIL import Image
import os

images = "$IMAGES"
all_icon = Image.open(os.path.join(images, "app-icon-all.png"))

# 1. Android legacy icon (1024x1024) — copy of app-icon-all
legacy = all_icon.copy()
legacy.save(os.path.join(images, "app-icon-android-legacy.png"))
print("  ✓ app-icon-android-legacy.png (1024x1024)")

# 2. Web favicon (48x48) — scaled from app-icon-all
favicon = all_icon.resize((48, 48), Image.LANCZOS)
favicon.save(os.path.join(images, "app-icon-web-favicon.png"))
print("  ✓ app-icon-web-favicon.png (48x48)")

print("🎨 Done!")
PYEOF
