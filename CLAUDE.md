# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RecoverySky Hybrid is a React Native app built with Ignite v11.3.2 template, targeting iOS, Android, and Web via Expo 54. It uses React 19.1, React Native 0.81.5 with New Architecture and Hermes engine enabled.

## Essential Commands

```bash
# Development
npm start              # Start Expo dev client
npm start -- --clear   # Start with Metro cache cleared (use after config changes)
npm run ios            # Run on iOS
npm run android        # Run on Android
npm run web            # Run web version

# Code Quality
npm run compile        # TypeScript type check
npm run lint           # ESLint with auto-fix
npm run lint:check     # ESLint check only
npm run lint:deps      # Dependency validation (depcruise)

# Testing
npm test               # Run Jest tests
npm run test:watch     # Jest watch mode
npm test -- path/to/file.test.ts  # Run single test file
npm run test:maestro   # Maestro e2e tests

# Building (EAS local builds - requires native module changes)
npm run build:ios:sim      # iOS simulator
npm run build:ios:device   # iOS physical device
npm run build:android:sim  # Android emulator
```

## Architecture

### Path Aliases
- `@/*` → `./app/*`
- `@assets/*` → `./assets/*`
- `@common` → `../recoverysky-common/lib/browser` (browser-safe exports)
- `@sqlite` → `../recoverysky-common/lib/sqlite` (SQLite/Drizzle exports)

**Important:** `@common` and `@sqlite` are separate aliases. Do NOT use `@common/sqlite` - it causes prefix-matching conflicts with babel-plugin-module-resolver.

### Linked Packages
Metro has poor symlink support. The `metro.config.js` includes workarounds:
- `watchFolders`: Includes `recoverysky-common` path
- `nodeModulesPaths`: Tells Metro where to find linked package dependencies
- After modifying linked packages, restart Metro with `--clear`

### State Management (MobX-State-Tree)
MST with MMKV persistence in `app/models/`:
- **RootStore**: Combines all stores, initialized in `app.tsx`
- **AuthenticationStore**: Auth token, email, userId, `isAuthenticated` computed
- **ProfileStore**: User profile settings with computed `displayName`, `cleanDays`, `isPremium`
- **NetworkStore**: Online/offline tracking with `isOffline`, `hasInternet` computed

```typescript
// Access stores in components (wrap with observer())
import { observer } from "mobx-react-lite"
import { useProfileStore, useNetworkStore } from "@/models"

const MyComponent = observer(() => {
  const profileStore = useProfileStore()
  return <Text>{profileStore.displayName}</Text>  // Auto-updates when store changes
})
```

Persistence is automatic via `onSnapshot` → MMKV in `helpers/setupRootStore.ts`.

### React Context Providers
Alongside MST, two React Context providers exist in `app/context/`:
- **AuthContext**: Authentication state with MMKV-backed token/email (temporary until backend ready)
- **MeetingContext**: Loads meetings from SQLite, joins with TREX data, filters live meetings

```typescript
// Access meeting data
import { useMeetings } from "@/context/MeetingContext"
const { meetings, liveMeetings, isLoading, refresh } = useMeetings()
```

### Database Layer
SQLite with Drizzle ORM in `app/db/`:
- **DatabaseProvider**: Runs Drizzle migrations on startup, seeds data on first launch
- **provider.ts**: Creates expo-sqlite database and Drizzle instance
- **repositories.ts**: Pre-instantiated repositories for meetings, schedules, sync queue
- **seedDatabase.ts**: Loads JSON seed data into SQLite (MMKV flag `db_seeded_v1`)

Migrations come from `@sqlite` (recoverysky-common), using `useMigrations` hook.

### Navigation
React Navigation v7 with bottom tabs:
- **AppNavigator**: Wraps MainNavigator with NavigationContainer and ErrorBoundary
- **MainNavigator**: 3 active tabs (Home, Live, Settings), 2 hidden tabs (Meetings, Schedule)
- Route types defined in `app/navigators/navigationTypes.ts`

### API Layer
Apisauce wrapper in `app/services/api/`:
- API methods return discriminated unions: `{ kind: "ok", data } | GeneralApiProblem`
- Error handling via `apiProblem.ts`

### Theming
Design token system in `app/theme/`:
- Use `themed()` function for responsive styling
- Access via `useAppTheme()` hook
- Colors include `card` for elevated surfaces (distinct from `background`)
- Professional dark mode with iOS-style greys

### Internationalization
i18next in `app/i18n/` with English and Spanish:
- Use `tx` prop on Text components, never hardcode strings
- Use `useTranslation()` hook for reactive translations in navigators
- Language switching via `changeLanguage()` from i18n exports

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
4. External packages (mobx-react-lite, etc.)
5. Internal `@/` imports
6. Relative imports

### Component Patterns
- Base components in `app/components/` wrap RN primitives with theming and i18n
- `Screen` component handles safe area, keyboard avoiding, scrolling
- Use `tx` and `txOptions` props for translations
- Wrap MST-consuming components with `observer()` from mobx-react-lite
- Unused variables must be prefixed with `_`

### Storage
Use `app/utils/storage/` helpers (MMKV-backed), not AsyncStorage:
```typescript
import { loadString, saveString, load, save, remove, clear } from "@/utils/storage"
```

MST stores auto-persist - prefer store actions over direct storage access.

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
  hydrateNext, FELLOWSHIP_COLORS,    // Display helpers
  DateTime,                          // Luxon DateTime
} from "@recoverysky-org/common/browser"
```

The `@sqlite` alias imports SQLite/Drizzle exports:
```typescript
import {
  migrations,                        // Drizzle migrations for useMigrations hook
  MeetingSqliteRepository,           // Repository classes
  meetings, schedules, trexes,       // Drizzle table schemas
} from "@recoverysky-org/common/sqlite"
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

## Development Tools

- **Reactotron**: Dev-only debugging (auto-configured)
- **Dependency Cruiser**: Validates imports, prevents circular dependencies
- **Ionicons**: Vector icons via `@expo/vector-icons` for icons not in asset registry
