# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RecoverySky Hybrid is a React Native app built with Ignite v11.3.2 template, targeting iOS, Android, and Web via Expo 54. It uses React 19.1, React Native 0.81.5 with New Architecture and Hermes engine enabled.

## Essential Commands

```bash
# Development
pnpm start              # Start Expo dev client
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
- `@common` → `../recoverysky-common/lib/browser` (browser-safe exports only)

### State Management
Uses React Context + MMKV for persistence:
- **AuthContext** (`app/context/AuthContext.tsx`): Authentication state, tokens, email validation
- **EpisodeContext** (`app/context/EpisodeContext.tsx`): Podcast data and favorites
- **ThemeContext** (`app/theme/context.tsx`): Light/dark/system theme with design tokens

### Navigation
React Navigation v7 with two-level structure:
- **AppNavigator**: Auth-based routing (Login → Welcome → Demo tabs)
- **DemoNavigator**: Bottom tabs for main authenticated screens
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
The `@common` alias imports from `@recoverysky-org/common/browser` (React Native compatible):
```typescript
import {
  meeting, schedule, trex,           // Data models (plain interfaces)
  Fellowship, MeetingStatus,         // Enums
  validateMeeting, validateSchedule, // Zod validation
  meetingZodSchema,                  // Direct Zod schema access
} from "@common"
```

**Not available** in mobile (Node.js only): `Meeting` class, repositories, TREX executor, Drizzle ORM.

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
