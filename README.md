<p align="center">
  <img src="assets/images/background.png" alt="RecoverySky Banner" width="100%" />
</p>

<h1 align="center">🌤️ RecoverySky Hybrid</h1>

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

```bash
# Clone the repository
git clone https://github.com/recoverysky-org/recoverysky-hybrid.git
cd recoverysky-hybrid

# Install dependencies
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

### Build Commands

```bash
# Development builds (local)
npm run build:ios:sim        # iOS simulator
npm run build:ios:device     # iOS physical device
npm run build:android:sim    # Android emulator
npm run build:android:device # Android physical device

# Production builds
npm run build:ios:prod
npm run build:android:prod
```

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
