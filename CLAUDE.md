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
- **ProfileStore**: User profile and preferences with two storage tiers:
  - **Props** (MMKV snapshots): display toggles, subscription, onboardingCompleted, attendanceEnabled, zoomConnected, reportEmail
  - **Volatile** (encrypted SQLite): shortName, pronouns, recoveryDate, fellowship, language — sensitive data kept out of snapshots
  - Computed views: `displayName`, `cleanDays`, `isPremium`
- **NetworkStore**: Online/offline tracking with `isOffline`, `hasInternet` computed
- **ConfigStore**: Server-provided config fetched from `/config` endpoint. Includes API URLs, Zoom SDK keys, RevenueCat keys (3 separate: test, Apple, Google) with computed `revenueCatApiKey` view that selects by `__DEV__` and `Platform.OS`. NOT persisted to MMKV (security).
- **ConversationStore**: AI agent conversation state

```typescript
// Access stores in components (wrap with observer())
import { observer } from "mobx-react-lite"
import { useProfileStore, useNetworkStore } from "@/models"

const MyComponent = observer(() => {
  const profileStore = useProfileStore()
  return <Text>{profileStore.displayName}</Text>  // Auto-updates when store changes
})
```

Persistence is automatic via `onSnapshot` → MMKV in `helpers/setupRootStore.ts`. ConfigStore is excluded from MMKV persistence.

### React Context Providers
Alongside MST, three React Context providers exist in `app/context/`:
- **MeetingContext**: Loads meetings from SQLite, joins with TREX data, filters live meetings
- **SubscriptionContext**: RevenueCat subscription state — `isPremium`, `hasAttendance`, `showPaywall()`, `showPaywallIfNeeded()`, `restore()`, `login()`, `logout()`

```typescript
import { useMeetings } from "@/context/MeetingContext"
const { meetings, liveMeetings, isLoading, refresh } = useMeetings()

import { useSubscription } from "@/context/SubscriptionContext"
const { isPremium, hasAttendance, showPaywall } = useSubscription()
```

### Navigation
React Navigation v7 in `app/navigators/`:

**App-level gating** (`AppNavigator.tsx`): Login → ZoomSetup → Onboarding → Main. Each gate is a persistent flag in ProfileStore (`isAuthenticated`, `zoomConnected`, `onboardingCompleted`).

**Main tabs** (`MainNavigator.tsx`): Home, Meetings, Attendance (conditional on `attendanceEnabled`), Agent (conditional on `isPremium`), Settings.

**Modals**: ZoomLogin (reconnection from Settings).

Route types defined in `app/navigators/navigationTypes.ts`.

### Database Layer
SQLite with Drizzle ORM in `app/db/`:
- **DatabaseProvider**: Runs Drizzle migrations on startup, seeds data on first launch
- **provider.ts**: Creates expo-sqlite database and Drizzle instance
- **repositories.ts**: Lazy proxy objects over common-lib repository classes (meetingRepo, scheduleRepo, attendanceRepo, feedbackRepo, chatMessageRepo, zoomAuthRepo, profileRepository)
- **attendanceEvents.ts**: Simple pub/sub for cross-component attendance updates. Event types: `"created" | "processed" | "produced" | "archived"`. Subscribe in `useEffect`, emit after mutations.
- **liveEvents.ts**: Similar pub/sub for live meeting preference changes

Migrations come from `@sqlite` (recoverysky-common), using `useMigrations` hook.

### API Layer
Apisauce wrapper in `app/services/api/`:
- Dual auth: device authorization (`X-Device-Token` / `X-API-Key`) + user OAuth (`Authorization: Bearer`)
- API methods return discriminated unions: `{ kind: "ok", data } | GeneralApiProblem`
- Attestation queueing: API calls wait for `attestationPromise` to resolve before proceeding
- Server config endpoint (`/config`) provides runtime keys for RC, Zoom, OTLP

### Subscription System (RevenueCat)
In `app/services/purchases/`:
- **config.ts**: Entitlements (`recoverysky-premium`, `recoverysky-attendance`), offerings (`default` for prod, `premium-standard` for dev), API key selection by env/platform
- **revenueCatService.ts**: SDK init, entitlement checks, offering-aware paywall presentation, purchase/restore flows
- **SubscriptionContext** (`app/context/`): Wraps the app, initializes RC with `configStore.revenueCatApiKey`, listens for customer info updates, auto-enables attendance on first subscription

Key pattern: `__DEV__` uses `test_` RC API key and `premium-standard` offering. Production uses platform-specific `appl_`/`goog_` keys and `default` offering. `__DEV__` is false in TestFlight/TestFlight builds.

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
- Extract `ListHeaderComponent` into standalone `observer` components (not inline `useCallback`) to avoid FlatList re-render/focus-loss bugs

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
  AttendanceSqliteRepository,        // Attendance with archive support
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

## Environment Variables

`EXPO_PUBLIC_*` variables are baked in at build time. For local development:

- **Simulator**: Can use `localhost` URLs in `.env`
- **Physical device**: Must use your Mac's IP address (e.g., `http://192.168.x.x:4000`)
- After changing `.env`, restart Metro with `npm start -- --clear`

Key variables in `.env`:
```bash
EXPO_PUBLIC_API_URL=http://192.168.x.x:4000     # RecoverySky API
EXPO_PUBLIC_AGENT_URL=http://192.168.x.x:3333   # AI Agent API
EXPO_PUBLIC_ZOOM_SDK_KEY=...                     # Zoom SDK client ID
EXPO_PUBLIC_ZOOM_SDK_SECRET=...                  # Zoom SDK secret
```

Production values are set in `eas.json` under `build.base.env`.

## AI Agent Integration

The Sky Agent (`AgentScreen.tsx`) uses Vercel AI SDK with streaming:
- Connects to `configStore.agentUrl` (from env var or server config)
- Uses `@ai-sdk/react` `useChat()` hook for streaming responses
- Supports tool calls (meeting search, recovery resources)
- Conversation persisted to ConversationStore
- Agent tab gated behind `isPremium` entitlement

## Zoom Integration

Zoom SDK in `app/services/zoom/`:
- **ZoomMeetingProvider**: Context wrapper for meeting state
- **useZoomMeeting**: Hook for joining meetings
- **useZoomAuth**: OAuth flow for authenticated meeting joins (ZAK token), credentials stored in encrypted SQLite via `zoomAuthRepo`
- Requires EAS build (native SDK, not Expo Go compatible)
- **ZoomSetupScreen**: Required gate before onboarding — user must connect Zoom account
- **ZoomLoginScreen**: Dismissible modal from Settings for reconnection

## Development Tools

- **Reactotron**: Dev-only debugging (auto-configured)
- **Dependency Cruiser**: Validates imports, prevents circular dependencies
- **Ionicons**: Vector icons via `@expo/vector-icons` for icons not in asset registry
