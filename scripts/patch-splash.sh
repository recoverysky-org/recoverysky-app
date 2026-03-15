#!/bin/bash
# Patch splash screen after expo prebuild
#
# expo-splash-screen v31 generates a storyboard with a 100×100 centered image
# regardless of resizeMode:"cover". The runtime programmatic view renders correctly,
# but there's a visible flash between the tiny native storyboard and the full-screen
# runtime view. This script overwrites the storyboard with full-screen constraints.
#
# Run AFTER expo prebuild:
#   npx expo prebuild && npm run patch:splash
#
# For EAS builds, this runs automatically via eas.json prebuildCommand.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ============================================================================
# iOS: Full-screen storyboard
# ============================================================================

patch_ios() {
  # Find the iOS app folder dynamically
  IOS_APP_DIR=$(find "$PROJECT_DIR/ios" -maxdepth 1 -type d ! -name "ios" ! -name "Pods" ! -name "build" ! -name ".*" ! -name "*.xcodeproj" ! -name "*.xcworkspace" ! -name "*Extension*" 2>/dev/null | head -1)

  if [ -z "$IOS_APP_DIR" ]; then
    echo "[patch-splash] iOS app directory not found, skipping iOS patch"
    return
  fi

  STORYBOARD="$IOS_APP_DIR/SplashScreen.storyboard"
  SPLASH_SRC="$PROJECT_DIR/assets/images/splash.png"
  SPLASH_DIR="$IOS_APP_DIR/Images.xcassets/SplashScreenLogo.imageset"

  if [ ! -f "$STORYBOARD" ]; then
    echo "[patch-splash] Storyboard not found, skipping iOS patch (run expo prebuild first)"
    return
  fi

  # Overwrite storyboard with full-screen constraints
  cat > "$STORYBOARD" << 'STORYBOARD_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="24093.7" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="EXPO-VIEWCONTROLLER-1">
    <device id="retina6_12" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="24053.1"/>
        <capability name="Named colors" minToolsVersion="9.0"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="System colors in document resources" minToolsVersion="11.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="EXPO-SCENE-1">
            <objects>
                <viewController storyboardIdentifier="SplashScreenViewController" id="EXPO-VIEWCONTROLLER-1" sceneMemberID="viewController">
                    <view key="view" userInteractionEnabled="NO" contentMode="scaleToFill" insetsLayoutMarginsFromSafeArea="NO" id="EXPO-ContainerView" userLabel="ContainerView">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" flexibleMaxX="YES" flexibleMaxY="YES"/>
                        <subviews>
                            <imageView id="EXPO-SplashScreen" userLabel="SplashScreenLogo" image="SplashScreenLogo" contentMode="scaleAspectFill" clipsSubviews="true" userInteractionEnabled="false" translatesAutoresizingMaskIntoConstraints="false">
                                <rect key="frame" x="0" y="0" width="393" height="852"/>
                            </imageView>
                        </subviews>
                        <viewLayoutGuide key="safeArea" id="Rmq-lb-GrQ"/>
                        <constraints>
                            <constraint firstItem="EXPO-SplashScreen" firstAttribute="leading" secondItem="EXPO-ContainerView" secondAttribute="leading" id="splash-leading"/>
                            <constraint firstItem="EXPO-SplashScreen" firstAttribute="trailing" secondItem="EXPO-ContainerView" secondAttribute="trailing" id="splash-trailing"/>
                            <constraint firstItem="EXPO-SplashScreen" firstAttribute="top" secondItem="EXPO-ContainerView" secondAttribute="top" id="splash-top"/>
                            <constraint firstItem="EXPO-SplashScreen" firstAttribute="bottom" secondItem="EXPO-ContainerView" secondAttribute="bottom" id="splash-bottom"/>
                        </constraints>
                        <color key="backgroundColor" name="SplashScreenBackground"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="EXPO-PLACEHOLDER-1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="0.0" y="0.0"/>
        </scene>
    </scenes>
    <resources>
        <image name="SplashScreenLogo" width="428" height="925"/>
        <systemColor name="systemBackgroundColor">
            <color white="1" alpha="1" colorSpace="custom" customColorSpace="genericGamma22GrayColorSpace"/>
        </systemColor>
        <namedColor name="SplashScreenBackground">
            <color alpha="1.000" blue="0.156862745098039" green="0.086274509803922" red="0.039215686274510" customColorSpace="sRGB" colorSpace="custom"/>
        </namedColor>
    </resources>
</document>
STORYBOARD_EOF

  echo "[patch-splash] iOS storyboard patched with full-screen constraints"

  # Copy and resize splash images for @1x/@2x/@3x
  if [ -f "$SPLASH_SRC" ] && [ -d "$SPLASH_DIR" ]; then
    # @3x - original size
    cp "$SPLASH_SRC" "$SPLASH_DIR/image@3x.png"

    # @2x and @1x via sips (macOS only, sips -z HEIGHT WIDTH)
    if command -v sips &> /dev/null; then
      sips -z 1850 856 "$SPLASH_SRC" --out "$SPLASH_DIR/image@2x.png" > /dev/null 2>&1
      sips -z 925 428 "$SPLASH_SRC" --out "$SPLASH_DIR/image.png" > /dev/null 2>&1
      echo "[patch-splash] iOS splash images resized"
    fi
  fi
}

# ============================================================================
# Android: Hide circular icon, show solid background → expo runtime takes over
# ============================================================================
#
# Android 12+ SplashScreen API forces windowSplashScreenAnimatedIcon into a
# circular mask. There is no way to render a full-screen image via the native
# splash API. Instead we:
#   1. Replace the icon PNGs with a transparent drawable
#   2. Remove icon_preferred behavior from styles.xml
#   3. The native splash becomes just the solid background color (#0a1628)
#   4. expo-splash-screen runtime immediately takes over with the full-screen image
#
# Result: dark background → full-screen splash (no circle flash)

patch_android() {
  ANDROID_RES="$PROJECT_DIR/android/app/src/main/res"

  if [ ! -d "$ANDROID_RES" ]; then
    echo "[patch-splash] Android res directory not found, skipping Android patch"
    return
  fi

  # Create a transparent XML drawable to replace the icon
  mkdir -p "$ANDROID_RES/drawable"
  cat > "$ANDROID_RES/drawable/splashscreen_transparent.xml" << 'DRAWABLE_EOF'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="@android:color/transparent"/>
    <size android:width="1dp" android:height="1dp"/>
</shape>
DRAWABLE_EOF

  # Update styles.xml: use transparent icon, remove icon_preferred
  STYLES="$ANDROID_RES/values/styles.xml"
  if [ -f "$STYLES" ]; then
    # Replace the icon reference with transparent drawable
    sed -i '' 's|@drawable/splashscreen_logo|@drawable/splashscreen_transparent|g' "$STYLES"
    # Remove icon_preferred behavior (causes the circular mask)
    sed -i '' '/<item name="android:windowSplashScreenBehavior">icon_preferred<\/item>/d' "$STYLES"
    echo "[patch-splash] Android styles.xml patched (transparent icon, no circle)"
  fi
}

# ============================================================================
# Main
# ============================================================================

patch_ios
patch_android
echo "[patch-splash] Done!"
