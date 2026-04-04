#!/bin/bash
# Patch Android native configuration after expo prebuild
# Applies settings that Expo doesn't handle automatically

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Patching Android configuration..."

# Copy google-services.json for Firebase/FCM push notifications
GOOGLE_SERVICES_SRC="$PROJECT_DIR/google-services.json"
GOOGLE_SERVICES_DST="$PROJECT_DIR/android/app/google-services.json"
if [ -f "$GOOGLE_SERVICES_SRC" ]; then
  cp "$GOOGLE_SERVICES_SRC" "$GOOGLE_SERVICES_DST"
  echo "Copied google-services.json to android/app/"
else
  echo "Warning: google-services.json not found at project root"
fi

MANIFEST="$PROJECT_DIR/android/app/src/main/AndroidManifest.xml"
RES_DIR="$PROJECT_DIR/android/app/src/main/res"
XML_DIR="$RES_DIR/xml"

if [ ! -f "$MANIFEST" ]; then
  echo "Error: AndroidManifest.xml not found at $MANIFEST"
  echo "Run 'npx expo prebuild' first"
  exit 1
fi

# Create network_security_config.xml for cleartext traffic
mkdir -p "$XML_DIR"
cat > "$XML_DIR/network_security_config.xml" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Allow cleartext for Metro bundler and local development -->
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>

    <!-- Production API domains -->
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">recoverysky.app</domain>
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </domain-config>

    <!-- Development domains - allow cleartext for Metro bundler -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">localhost</domain>
        <domain includeSubdomains="true">10.0.2.2</domain>
        <domain includeSubdomains="true">10.0.3.2</domain>
    </domain-config>
</network-security-config>
EOF
echo "Created network_security_config.xml"

# Add networkSecurityConfig reference to AndroidManifest.xml
if ! grep -q "networkSecurityConfig" "$MANIFEST"; then
  sed -i '' 's/android:allowBackup="false"/android:allowBackup="false" android:networkSecurityConfig="@xml\/network_security_config"/' "$MANIFEST"
  echo "Added networkSecurityConfig to AndroidManifest.xml"
else
  echo "networkSecurityConfig already present"
fi

# Add usesCleartextTraffic for Metro bundler HTTP connection (belt and suspenders)
if ! grep -q "usesCleartextTraffic" "$MANIFEST"; then
  sed -i '' 's/android:allowBackup="false"/android:allowBackup="false" android:usesCleartextTraffic="true"/' "$MANIFEST"
  echo "Added usesCleartextTraffic to AndroidManifest.xml"
else
  echo "usesCleartextTraffic already present"
fi

# Add tools namespace for manifest merging
if ! grep -q "xmlns:tools" "$MANIFEST"; then
  sed -i '' 's|<manifest xmlns:android="http://schemas.android.com/apk/res/android"|<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools"|' "$MANIFEST"
  echo "Added tools namespace to AndroidManifest.xml"
else
  echo "tools namespace already present"
fi

# Add tools:replace to override Zoom SDK manifest attributes
if ! grep -q "tools:replace" "$MANIFEST"; then
  sed -i '' 's|android:dataExtractionRules="@xml/secure_store_data_extraction_rules"|android:dataExtractionRules="@xml/secure_store_data_extraction_rules" tools:replace="android:networkSecurityConfig,android:usesCleartextTraffic"|' "$MANIFEST"
  echo "Added tools:replace to AndroidManifest.xml"
elif ! grep -q 'tools:replace="android:networkSecurityConfig' "$MANIFEST"; then
  sed -i '' 's|tools:replace="android:usesCleartextTraffic"|tools:replace="android:networkSecurityConfig,android:usesCleartextTraffic"|' "$MANIFEST"
  echo "Updated tools:replace to include networkSecurityConfig"
else
  echo "tools:replace already present"
fi

# Patch debug manifests to override Zoom SDK's networkSecurityConfig
DEBUG_MANIFEST="$PROJECT_DIR/android/app/src/debug/AndroidManifest.xml"
DEBUG_OPT_MANIFEST="$PROJECT_DIR/android/app/src/debugOptimized/AndroidManifest.xml"

patch_debug_manifest() {
  local manifest="$1"
  if [ -f "$manifest" ]; then
    # Add networkSecurityConfig and update tools:replace to include it
    if ! grep -q "networkSecurityConfig" "$manifest"; then
      sed -i '' 's/android:usesCleartextTraffic="true"/android:usesCleartextTraffic="true" android:networkSecurityConfig="@xml\/network_security_config"/' "$manifest"
      sed -i '' 's/tools:replace="android:usesCleartextTraffic"/tools:replace="android:usesCleartextTraffic,android:networkSecurityConfig"/' "$manifest"
      echo "Patched $(basename $(dirname $manifest)) manifest with networkSecurityConfig override"
    else
      echo "$(basename $(dirname $manifest)) manifest already patched"
    fi
  fi
}

patch_debug_manifest "$DEBUG_MANIFEST"
patch_debug_manifest "$DEBUG_OPT_MANIFEST"

# Increase Gradle JVM memory for large builds (Zoom SDK needs >8GB for dex merging)
GRADLE_PROPS="$PROJECT_DIR/android/gradle.properties"
if [ -f "$GRADLE_PROPS" ]; then
  if grep -q "org.gradle.jvmargs=-Xmx2048m" "$GRADLE_PROPS"; then
    sed -i '' 's/org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m/org.gradle.jvmargs=-Xmx16384m -XX:MaxMetaspaceSize=2048m -XX:+HeapDumpOnOutOfMemoryError/' "$GRADLE_PROPS"
    echo "Increased Gradle JVM memory to 16GB"
  elif grep -q "org.gradle.jvmargs=-Xmx8192m" "$GRADLE_PROPS"; then
    sed -i '' 's/org.gradle.jvmargs=-Xmx8192m -XX:MaxMetaspaceSize=1024m/org.gradle.jvmargs=-Xmx16384m -XX:MaxMetaspaceSize=2048m/' "$GRADLE_PROPS"
    echo "Increased Gradle JVM memory from 8GB to 16GB"
  elif grep -q "org.gradle.jvmargs=-Xmx12288m" "$GRADLE_PROPS"; then
    echo "Gradle JVM memory already set to 16GB"
  else
    echo "Warning: Could not find expected jvmargs in gradle.properties"
  fi
fi

# Disable lint checkDependencies to prevent PrivateApiLookup OOM
# Lint's ApiDatabase.writeDatabase allocates a massive ByteBuffer when
# analyzing large SDKs (Zoom) which causes OOM regardless of heap size
APP_BUILD_GRADLE="$PROJECT_DIR/android/app/build.gradle"
if [ -f "$APP_BUILD_GRADLE" ]; then
  if ! grep -q "checkDependencies" "$APP_BUILD_GRADLE"; then
    sed -i '' '/android {/a\
    lint {\
        checkDependencies false\
        checkReleaseBuilds false\
    }
' "$APP_BUILD_GRADLE"
    echo "Disabled lint checkDependencies (prevents PrivateApiLookup OOM)"
  else
    echo "lint checkDependencies already configured"
  fi
fi

# Override Zoom SDK Spanish string with invalid format specifiers
# The AAR has non-positional format in zm_prism_acc_avatar_row_over_max which fails AAPT2
ZOOM_ES_OVERRIDE="$RES_DIR/values-es/zoom_overrides.xml"
if [ ! -f "$ZOOM_ES_OVERRIDE" ]; then
  mkdir -p "$RES_DIR/values-es"
  cat > "$ZOOM_ES_OVERRIDE" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Override Zoom SDK string with invalid format specifiers -->
    <string name="zm_prism_acc_avatar_row_over_max" formatted="false">Participantes: %s, más de %d participantes</string>
</resources>
EOF
  echo "Created Zoom SDK Spanish string override"
else
  echo "Zoom SDK Spanish string override already present"
fi

# Exclude Amazon Appstore SDK (transitive dep from RevenueCat, unused)
if [ -f "$APP_BUILD_GRADLE" ]; then
  if ! grep -q "purchases-store-amazon" "$APP_BUILD_GRADLE"; then
    sed -i '' '/^dependencies {/i\
configurations.all {\
    exclude group: '\''com.revenuecat.purchases'\'', module: '\''purchases-store-amazon'\''\
    exclude group: '\''com.amazon.device'\'', module: '\''amazon-appstore-sdk'\''\
}\
' "$APP_BUILD_GRADLE"
    echo "Excluded Amazon Appstore SDK from RevenueCat"
  else
    echo "Amazon Appstore SDK exclusion already present"
  fi
fi

echo "Android patches complete!"
