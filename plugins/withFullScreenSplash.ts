/**
 * Expo Config Plugin: Full-Screen Splash Screen
 *
 * expo-splash-screen v31 generates a storyboard with a 100×100 centered image.
 * Config plugin dangerous mods can't fix it (expo-splash-screen writes last).
 *
 * This plugin adds an Xcode Build Phase "Run Script" that patches the storyboard
 * right before compilation. This runs during xcodebuild, AFTER all prebuild steps.
 */

import { ConfigPlugin, withXcodeProject } from "@expo/config-plugins"

const PATCH_SCRIPT = `# [withFullScreenSplash] Patch storyboard with full-screen constraints
STORYBOARD="$SRCROOT/$PRODUCT_NAME/SplashScreen.storyboard"
if [ -f "$STORYBOARD" ] && grep -q 'width="100" height="100"' "$STORYBOARD"; then
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
  echo "[withFullScreenSplash] Storyboard patched"
fi
`

const withFullScreenSplash: ConfigPlugin = (config) => {
  return withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults
    const targetName = modConfig.modRequest.projectName ?? "recoveryskyapp"

    // Find the main app target
    const nativeTarget = project.getTarget("com.apple.product-type.application")
    if (!nativeTarget) {
      console.warn("[withFullScreenSplash] Could not find app target")
      return modConfig
    }

    // Add a Run Script build phase (runs before "Compile Sources")
    project.addBuildPhase(
      [],
      "PBXShellScriptBuildPhase",
      "Patch Splash Screen Storyboard",
      nativeTarget.uuid,
      { shellPath: "/bin/sh", shellScript: PATCH_SCRIPT },
    )

    console.log(`[withFullScreenSplash] Added build phase to ${targetName}`)
    return modConfig
  })
}

export default withFullScreenSplash
