# RecoverySky Hybrid

A cross-platform recovery meeting finder built with React Native and Expo.

## Overview

RecoverySky helps people in recovery find meetings. The app features:

- **Live Meetings**: Real-time display of currently active meetings with auto-refresh
- **Offline-First**: SQLite database with Drizzle ORM for offline data access
- **Profile Settings**: Customizable display name, pronouns, recovery date tracking
- **Multi-Language**: English and Spanish support with runtime switching
- **Dark Mode**: Professional iOS-style theme with automatic system detection

## Tech Stack

- **React Native 0.81** with New Architecture enabled
- **Expo 54** with dev client for iOS, Android, and Web
- **MobX-State-Tree** for reactive state management with MMKV persistence
- **SQLite + Drizzle ORM** for offline-first data layer
- **React Navigation v7** with bottom tab navigation
- **i18next** for internationalization

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- Xcode (for iOS development)
- Android Studio (for Android development)

### Installation

```bash
npm install
```

### Development

```bash
# Start Expo dev client
npm start

# Run on specific platform
npm run ios
npm run android
npm run web
```

> **Note**: After installing native modules, you must rebuild the dev client:
> ```bash
> npm run build:ios:sim    # iOS simulator
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

## App Structure

### Screens

| Screen | Description |
|--------|-------------|
| **Home** | Dashboard with database status (dev mode) |
| **Live** | Currently active meetings with pull-to-refresh |
| **Settings** | Profile, recovery tracking, account, and app preferences |

### Navigation

3-tab bottom navigation (Home, Live, Settings) with 2 hidden tabs (Meetings, Schedule) for future use.

## State Management

The app uses **MobX-State-Tree** for reactive state:

- **AuthenticationStore**: Auth token, email, user ID
- **ProfileStore**: Display name, pronouns, recovery date, visibility toggles
- **NetworkStore**: Online/offline tracking

All stores auto-persist to MMKV storage.

## Database

SQLite with Drizzle ORM provides offline-first data access:

- Migrations run automatically on startup
- Seed data loaded on first launch
- Meeting data joined with TREX recurrence data for live detection

## Linked Packages

This app links to local packages in the monorepo:

- `@common` → `recoverysky-common/lib/browser` (data models, validation)
- `@sqlite` → `recoverysky-common/lib/sqlite` (Drizzle schemas, migrations)

After modifying linked packages, restart Metro with cache clear:
```bash
npm start -- --clear
```

## Quality Checks

```bash
npm run compile      # TypeScript check
npm run lint         # ESLint with auto-fix
npm run lint:check   # ESLint check only
npm run lint:deps    # Dependency validation
npm test             # Jest tests
```

## License

Private - RecoverySky Organization
