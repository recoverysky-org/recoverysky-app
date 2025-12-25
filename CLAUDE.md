# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RecoverySky Hybrid is a React Native app built with Ignite v11.3.2 template, targeting iOS, Android, and Web via Expo 54. It uses React 19.1, React Native 0.81.5 with New Architecture and Hermes engine enabled.

## Essential Commands

```bash
# Development
pnpm start              # Start Expo dev client
pnpm start --clear      # Start with Metro cache cleared (use after config changes)
pnpm ios                # Run on iOS
pnpm android            # Run on Android
pnpm web                # Run web version

# Code Quality
pnpm compile            # TypeScript type check
pnpm lint               # ESLint with auto-fix
pnpm lint:check         # ESLint check only
pnpm depcruise          # Dependency validation

# Testing
pnpm test               # Run Jest tests
pnpm test:watch         # Jest watch mode
pnpm test:maestro       # Maestro e2e tests

# Building (EAS local builds)
pnpm build:ios:sim      # iOS simulator
pnpm build:ios:device   # iOS physical device
pnpm build:android:sim  # Android emulator
```

## Architecture

### Path Aliases
- `@/*` → `./app/*`
- `@assets/*` → `./assets/*`
- `@common` → `../recoverysky-common/lib/browser` (browser-safe exports)
- `@sqlite` → `../recoverysky-common/lib/sqlite` (SQLite/Drizzle exports)

**Important:** `@common` and `@sqlite` are separate aliases. Do NOT use `@common/sqlite` - it causes prefix-matching conflicts with babel-plugin-module-resolver.

### Linked Packages (pnpm)
Metro has poor symlink support. The `metro.config.js` includes workarounds:
- `watchFolders`: Includes `recoverysky-common` and `trex-ts` paths
- `nodeModulesPaths`: Tells Metro where to find linked package dependencies
- After modifying linked packages, restart Metro with `--clear`

### State Management
Uses React Context + MMKV for persistence:
- **MeetingContext** (`app/context/MeetingContext.tsx`): Meeting data with live detection via `isLiveInterval()`
- **ThemeContext** (`app/theme/context.tsx`): Light/dark/system theme with design tokens

### Database Layer
SQLite with Drizzle ORM in `app/db/`:
- **DatabaseProvider**: Runs Drizzle migrations on startup, seeds data on first launch
- **provider.ts**: Creates expo-sqlite database and Drizzle instance
- **repositories.ts**: Pre-instantiated repositories for meetings, schedules, sync queue
- **seedDatabase.ts**: Loads JSON seed data into SQLite (MMKV flag `db_seeded_v1`)

Migrations come from `@sqlite` (recoverysky-common), using `useMigrations` hook.

### Navigation
Simplified React Navigation v7 structure - app starts directly on Home:
- **AppNavigator**: Wraps MainNavigator with NavigationContainer and ErrorBoundary
- **MainNavigator**: Bottom tabs (Home, Live, Profile)
- Route types defined in `app/navigators/navigationTypes.ts`

### API Layer
Apisauce wrapper in `app/services/api/`:
- API methods return discriminated unions: `{ kind: "ok", data } | GeneralApiProblem`
- Error handling via `apiProblem.ts`

### Theming
Design token system in `app/theme/`:
- Use `themed()` function for responsive styling
- Access via `useAppTheme()` hook
- Colors, spacing, typography defined as tokens

### Internationalization
i18next in `app/i18n/` with 7+ languages:
- Use `tx` prop on Text components, never hardcode strings
- RTL support for Arabic/Hebrew

## Code Conventions

### ESLint Restrictions (enforced)
- No default React import: use named imports `{ useState, useEffect }`
- No `SafeAreaView` from react-native: use `react-native-safe-area-context`
- No raw `Text`, `Button`, `TextInput` from react-native: use `@/components` wrappers
- No Reactotron in production code

### Import Order
1. React
2. React Native
3. Expo packages
4. External packages
5. Internal `@/` imports
6. Relative imports

### Component Patterns
- Base components in `app/components/` wrap RN primitives with theming and i18n
- `Screen` component handles safe area, keyboard avoiding, scrolling
- Use `tx` and `txOptions` props for translations
- Unused variables must be prefixed with `_`

### Storage
Use `app/utils/storage/` helpers (MMKV-backed), not AsyncStorage:
```typescript
import { loadString, saveString, load, save, remove, clear } from "@/utils/storage"
```

## Generator Anchors

Ignite CLI uses comment anchors for code generation. Preserve these:
```typescript
// IGNITE_GENERATOR_ANCHOR_*
```

### Shared Common Library
The `@common` alias imports browser-safe exports from recoverysky-common:
```typescript
import {
  meeting, schedule, trex,           // Data models (plain interfaces)
  Fellowship, MeetingStatus,         // Enums
  validateMeeting, validateSchedule, // Zod validation
  isLiveInterval, normalize,         // TREX live detection
  DateTime,                          // Luxon DateTime
} from "@common"
```

The `@sqlite` alias imports SQLite/Drizzle exports:
```typescript
import {
  migrations,                        // Drizzle migrations for useMigrations hook
  MeetingSqliteRepository,           // Repository classes
  meetings, schedules, trexes,       // Drizzle table schemas
} from "@sqlite"
```

### Logging
OTLP-compatible logger in `app/utils/logger/`:
```typescript
import { logger, useLogger } from "@/utils/logger"

// Direct logging (services, utils)
logger.info("User logged in", { userId: "123" })

// In React components
const log = useLogger("ScreenName")
log.error("API failed", { endpoint: "/users" })
```

Configure via environment when Alloy collector is online:
- `EXPO_PUBLIC_OTLP_ENDPOINT`: Collector URL
- `EXPO_PUBLIC_OTLP_API_KEY`: Auth key

## Development Tools

- **Reactotron**: Dev-only debugging (auto-configured)
- **Dependency Cruiser**: Validates imports, prevents circular dependencies
