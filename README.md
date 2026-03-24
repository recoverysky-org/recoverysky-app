<p align="center">
  <img src="assets/images/RecoverySky-signature.white.png" alt="RecoverySky Banner" width="100%" />
</p>

<h1 align="center">🌤️ RecoverySky App</h1>

<p align="center">
  <strong>A cross-platform recovery meeting finder built with React Native & Expo</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React_Native-0.81-61DAFB?logo=react" alt="React Native" />
  <img src="https://img.shields.io/badge/Expo-54-000020?logo=expo" alt="Expo" />
  <img src="https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/License-AGPL_v3-blue" alt="License" />
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-contributing">Contributing</a>
</p>

---

## ✨ Features

### 🔍 **Find Meetings Fast**
Discover recovery meetings near you with powerful filtering by fellowship, time, and location. Real-time "Live Now" detection shows meetings currently in session.

### 🤖 **AI-Powered Guide**
Meet **Sky** — your AI recovery companion. Get instant answers about meetings, recovery resources, literature, and more through natural conversation.

### 🔐 **Privacy-First Design**
Your data stays yours. SQLCipher encryption protects your local database, with seamless key migration when upgrading from anonymous to authenticated accounts.

### 📱 **Offline-First**
Works without internet. SQLite + Drizzle ORM ensures your meeting data and personal settings are always available, syncing when you're back online.

### 🌍 **Multi-Language Support**
Full English and Spanish support with runtime language switching. More languages coming soon!

### 🎨 **Beautiful Dark Mode**
Professional iOS-style dark theme with automatic system detection. Easy on the eyes for late-night meeting searches.

### 📊 **Track Your Recovery**
Record attendance, track your clean days, and celebrate milestones. Your recovery journey, beautifully visualized.

### 🔔 **Smart Onboarding**
Guided setup flow that respects your privacy choices. Navigate with tappable progress dots.

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | React Native 0.81 (New Architecture) |
| **Platform** | Expo 54 with dev client |
| **State** | MobX-State-Tree + MMKV persistence |
| **Database** | SQLite + Drizzle ORM + SQLCipher encryption |
| **Navigation** | React Navigation v7 (bottom tabs) |
| **AI** | Vercel AI SDK + Claude |
| **Auth** | Zitadel OAuth with PKCE |
| **i18n** | i18next with runtime switching |
| **UI** | Custom design system with themed components |

---

## 🚀 Getting Started

### Prerequisites

- Node.js >= 20.0.0
- Xcode 15+ (iOS development)
- Android Studio (Android development)

### Installation

> **Note**: This project uses **npm** (not pnpm or yarn). Using other package managers may cause dependency resolution issues with native modules.

```bash
# Clone the repository
git clone https://github.com/recoverysky-org/recoverysky-app.git
cd recoverysky-app

# Install dependencies (use npm, not pnpm/yarn)
npm install
```

### Development

```bash
# Start Expo dev client
npm start

# Run on specific platform
npm run ios        # iOS Simulator
npm run android    # Android Emulator
npm run web        # Web browser
```

> 💡 **Tip**: After installing native modules, rebuild the dev client:
> ```bash
> npm run build:ios:sim     # iOS simulator
> npm run build:android:sim # Android emulator
> ```

### Prebuild (Native Project Generation)

Expo Prebuild generates the native `ios/` and `android/` directories from `app.config.ts`. You **must** prebuild before running local Gradle/Xcode builds. EAS builds handle this automatically.

After prebuild, platform-specific patch scripts run to fix native code that Expo config plugins can't handle (splash screen, Android manifest, iOS project settings, Zoom SDK AAR).

```bash
# Regenerate both platforms (deletes ios/ and android/, re-generates, applies all patches)
npm run prebuild:clean

# Regenerate iOS only
npm run prebuild:ios:clean

# Regenerate Android only
npm run prebuild:android:clean
```

**When to prebuild:**
- After adding/removing a native module (`npm install react-native-*`)
- After changing `app.config.ts` native settings (permissions, schemes, plugins)
- After modifying patch scripts in `scripts/`
- When native directories are corrupted or out of sync

**Patch scripts** applied during prebuild:
| Script | Platform | Purpose |
|--------|----------|---------|
| `patch:splash` | Both | Splash screen native fixes |
| `patch:ios` | iOS | iOS project configuration fixes |
| `patch:android` | Android | Android manifest and build config fixes |
| `patch:zoom:android` | Android | Extracts and slims Zoom SDK AAR (~474MB → ~245MB) |

> **Note:** `patch:zoom:android` also runs automatically via `postinstall` after `npm install`.

---

### Building for iOS

#### Local Testing (Development Builds)

Development builds include `expo-dev-client` for hot reload and debugging tools. These use the `development` EAS profile with debug env vars.

```bash
# iOS Simulator (most common for development)
npm run build:ios:sim

# iOS Physical Device (requires Apple Developer account + provisioning profile)
npm run build:ios:device
```

Simulator builds produce a `.tar.gz` in the project root. Device builds produce an `.ipa`. See [Deploying to Devices & Simulators](#deploying-to-devices--simulators) for installation steps.

#### Preview Builds (Release Mode, Internal Distribution)

Preview builds compile in release mode (optimized, no dev tools) but use internal distribution — useful for testing production-like performance without submitting to the App Store.

```bash
npm run build:ios:preview          # Simulator (release mode)
npm run build:ios:preview:device   # Physical device (release mode, ad-hoc)
```

#### Production Build (App Store Submission)

Produces a signed `.ipa` for App Store / TestFlight. Uses the `production` EAS profile with production API URLs, `LOG_LEVEL=warn`, and auto-incrementing version number.

```bash
# Build locally, then submit separately
npm run build:ios:prod
npm run submit:ios            # Submits the most recent .ipa to App Store Connect

# Build remotely on EAS + submit in one step
npm run release:ios
```

---

### Building for Android

Android local builds use Gradle directly, which is faster than EAS for iteration. You must prebuild first if the `android/` directory doesn't exist or is stale.

#### Local Testing — Emulator (x86_64)

```bash
# Debug build (fast compile, dev tools enabled)
npm run build:android:sim:debug

# Release build (optimized, no dev tools)
npm run build:android:sim:release
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk` or `.../release/app-release.apk`

#### Local Testing — Physical Device (arm64-v8a)

```bash
# Debug build
npm run build:android:device:debug

# Release build (production-like performance on device)
npm run build:android:device:release

# 32-bit ARM devices (rare, older devices)
npm run build:android:device:debug:arm32
npm run build:android:device:release:arm32
```

See [Deploying to Devices & Simulators](#deploying-to-devices--simulators) for installation steps.

#### Production Build (Play Store Submission)

Produces a signed `.aab` (Android App Bundle) via the `production` EAS profile. Uses production API URLs, OneSignal production mode, local signing credentials, and auto-incrementing version.

```bash
# Build locally, then submit separately
npm run build:android:prod
npm run submit:android        # Submits the most recent .aab to Google Play Console

# Build remotely on EAS + submit in one step
npm run release:android
```

> **AAB vs APK:** Production builds output `.aab` files, which cannot be installed directly via `adb`. AABs are optimized for Play Store delivery. For local production testing on a physical device, use `npm run build:android:device:release` instead (produces an installable APK).

---

### Build Quick Reference

| Goal | Command | Output |
|------|---------|--------|
| **iOS sim (dev)** | `npm run build:ios:sim` | `.tar.gz` |
| **iOS device (dev)** | `npm run build:ios:device` | `.ipa` (dev) |
| **iOS sim (release)** | `npm run build:ios:preview` | `.tar.gz` |
| **iOS device (release)** | `npm run build:ios:preview:device` | `.ipa` (ad-hoc) |
| **iOS prod (App Store)** | `npm run build:ios:prod` | `.ipa` (store) |
| **Android emu (debug)** | `npm run build:android:sim:debug` | `.apk` (x86_64) |
| **Android emu (release)** | `npm run build:android:sim:release` | `.apk` (x86_64) |
| **Android device (debug)** | `npm run build:android:device:debug` | `.apk` (arm64) |
| **Android device (release)** | `npm run build:android:device:release` | `.apk` (arm64) |
| **Android prod (Play Store)** | `npm run build:android:prod` | `.aab` |

---

### Deploying to Devices & Simulators

#### iOS Simulator

EAS dev/preview builds for simulator produce a `.tar.gz` in the project root.

```bash
# Install + launch in one step (requires a booted simulator)
npm run deploy:ios:sim

# Or separately:
npm run install:ios:sim    # Extracts .tar.gz and installs on booted simulator
npm run launch:ios:sim     # Launches the app by bundle ID
```

> **Tip:** Boot a simulator first with `open -a Simulator` or via Xcode > Open Developer Tool > Simulator.

#### iOS Physical Device

For **dev/preview builds** (`build:ios:device`, `build:ios:preview:device`), the EAS build process produces an `.ipa` in the project root. Install it using one of:

```bash
# Xcode Devices window (easiest)
# 1. Open Xcode > Window > Devices and Simulators
# 2. Select your connected device
# 3. Click "+" under "Installed Apps" and select the .ipa file

# Or via command line with ios-deploy (install with: brew install ios-deploy)
ios-deploy --bundle build-*.ipa

# Or via Apple Configurator 2 (from Mac App Store)
# Drag and drop the .ipa onto your connected device
```

For **production builds** (`build:ios:prod`), the `.ipa` is App Store signed and cannot be installed directly on devices. Use TestFlight instead:

```bash
npm run submit:ios         # Upload to App Store Connect
# Then install via TestFlight app on your device
```

#### Android Emulator / Physical Device

Gradle builds produce APKs that can be installed directly via `adb`. Connect a device via USB (with USB debugging enabled) or boot an emulator.

```bash
# Install + launch in one step
npm run deploy:android

# Or separately:
npm run install:android    # Installs the most recent APK (auto-picks debug or release)
npm run launch:android     # Launches the app by package name
```

`install:android` auto-detects the newest APK from:
1. `android/app/build/outputs/apk/debug/app-debug.apk`
2. `android/app/build/outputs/apk/release/app-release.apk`
3. `build-*.apk` in the project root (from EAS builds)

> **Physical device tip:** Run `npm run adb` first to set up reverse port forwarding so the device can reach Metro (8081), Reactotron (9090), and local APIs (3000, 9001).

**EAS production builds** produce `.aab` files which cannot be installed via `adb`. To test a production-like build on a physical device, use Gradle instead:

```bash
npm run build:android:device:release   # Produces installable .apk with release optimizations
npm run deploy:android                 # Install and launch
```

To submit an `.aab` to the Play Store:

```bash
npm run submit:android     # Uploads the most recent .aab to Google Play Console
```

#### Deploy Quick Reference

| Target | Build | Deploy |
|--------|-------|--------|
| **iOS Simulator** | `npm run build:ios:sim` | `npm run deploy:ios:sim` |
| **iOS Device (dev)** | `npm run build:ios:device` | Install `.ipa` via Xcode or `ios-deploy` |
| **iOS Device (prod)** | `npm run build:ios:prod` | `npm run submit:ios` → TestFlight |
| **Android Emulator** | `npm run build:android:sim:debug` | `npm run deploy:android` |
| **Android Device (dev)** | `npm run build:android:device:debug` | `npm run deploy:android` |
| **Android Device (prod-like)** | `npm run build:android:device:release` | `npm run deploy:android` |
| **Android Play Store** | `npm run build:android:prod` | `npm run submit:android` |

---

## 📱 App Structure

### Screens

| Screen | Icon | Description |
|--------|------|-------------|
| **Home** | 🏠 | Dashboard with quick access to features |
| **Live** | 📡 | Currently active meetings with pull-to-refresh |
| **Guide** | 🤖 | AI-powered recovery companion chat |
| **Settings** | ⚙️ | Profile, recovery tracking, and preferences |

### Hidden Screens (for power users)

| Screen | Description |
|--------|-------------|
| **Meetings** | Full meeting directory with search |
| **Schedule** | Weekly schedule grid view |
| **Attendance** | Personal attendance history |

---

## 🏗️ Architecture

### State Management

MobX-State-Tree provides reactive, type-safe state:

```typescript
// Access stores in components
import { observer } from "mobx-react-lite"
import { useProfileStore } from "@/models"

const MyComponent = observer(() => {
  const profile = useProfileStore()
  return <Text>{profile.displayName}</Text>  // Auto-updates!
})
```

**Available Stores:**
- 🔐 **AuthenticationStore** — Auth tokens, user identity
- 👤 **ProfileStore** — Name, pronouns, recovery date, preferences
- 🌐 **NetworkStore** — Online/offline status

All stores auto-persist to MMKV storage.

### Database Layer

SQLite with Drizzle ORM + SQLCipher encryption:

```typescript
// Encrypted database opens automatically
const { status } = useDatabase()  // "seeded" when ready

// Repositories for data access
import { repositories } from "@/db"
const meetings = await repositories.meeting.findLive()
```

**Security Features:**
- 🔒 256-bit AES encryption via SQLCipher
- 🔑 Keys stored in iOS Keychain / Android Keystore
- 🔄 Seamless re-encryption on auth upgrade

### Linked Packages

This app uses local packages from the monorepo:

| Alias | Package | Description |
|-------|---------|-------------|
| `@common` | `recoverysky-common/lib/browser` | Data models, validation |
| `@sqlite` | `recoverysky-common/lib/sqlite` | Drizzle schemas, migrations |

After modifying linked packages:
```bash
npm start -- --clear
```

---

## 🧪 Quality Checks

```bash
npm run compile      # TypeScript check
npm run lint         # ESLint with auto-fix
npm run lint:check   # ESLint check only
npm run lint:deps    # Dependency validation
npm test             # Jest tests
```

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/amazing-feature`
3. Make your changes
4. Run quality checks: `npm run compile && npm run lint`
5. Commit with conventional commits: `git commit -m "✨ feat: add amazing feature"`
6. Push and open a PR

---

## 📄 License

This project is open source under the [GNU Affero General Public License v3.0](LICENSE.md).

This means you're free to use, modify, and distribute the code, but if you run a modified version as a network service, you must make the source code available to users of that service.

---

<p align="center">
  Made with 💜 by the RecoverySky Team
</p>

<p align="center">
  <em>One day at a time. 🌤️</em>
</p>
