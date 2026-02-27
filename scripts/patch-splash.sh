#!/bin/bash
# Patch splash screen after expo prebuild
# This restores the full-screen splash configuration that expo overwrites

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Patching iOS splash screen..."

# Find the iOS app folder dynamically (excludes Pods, .xcodeproj, .xcworkspace)
IOS_APP_DIR=$(find "$PROJECT_DIR/ios" -maxdepth 1 -type d ! -name "ios" ! -name "Pods" ! -name "build" ! -name ".*" ! -name "*.xcodeproj" ! -name "*.xcworkspace" ! -name "*Extension*" | head -1)

if [ -z "$IOS_APP_DIR" ]; then
  echo "Error: Could not find iOS app directory"
  exit 1
fi

echo "Found iOS app directory: $IOS_APP_DIR"

# Path to storyboard
STORYBOARD="$IOS_APP_DIR/SplashScreen.storyboard"
SPLASH_SRC="$PROJECT_DIR/assets/images/splash.png"
SPLASH_DIR="$IOS_APP_DIR/Images.xcassets/SplashScreenLogo.imageset"

if [ ! -f "$STORYBOARD" ]; then
  echo "Error: Storyboard not found at $STORYBOARD"
  echo "Run 'npx expo prebuild' first"
  exit 1
fi

# Update storyboard to use full-screen constraints
cat > "$STORYBOARD" << 'EOF'
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
        <image name="SplashScreenLogo" width="393" height="852"/>
        <systemColor name="systemBackgroundColor">
            <color white="1" alpha="1" colorSpace="custom" customColorSpace="genericGamma22GrayColorSpace"/>
        </systemColor>
        <namedColor name="SplashScreenBackground">
            <color alpha="1.000" blue="0.156862745098039" green="0.086274509803922" red="0.039215686274510" customColorSpace="sRGB" colorSpace="custom"/>
        </namedColor>
    </resources>
</document>
EOF

echo "Storyboard patched"

# Copy and resize splash images
if [ -f "$SPLASH_SRC" ]; then
  echo "Copying splash images..."

  # @3x - original size
  cp "$SPLASH_SRC" "$SPLASH_DIR/image@3x.png"

  # @2x - resize to 2/3
  sips -z 1850 856 "$SPLASH_SRC" --out "$SPLASH_DIR/image@2x.png" > /dev/null 2>&1

  # @1x - resize to 1/3
  sips -z 925 428 "$SPLASH_SRC" --out "$SPLASH_DIR/image.png" > /dev/null 2>&1

  echo "Splash images copied"
else
  echo "Warning: splash.png not found at $SPLASH_SRC"
fi

echo "iOS splash screen patched successfully!"
