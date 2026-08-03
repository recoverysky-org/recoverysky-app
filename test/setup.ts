// we always make sure 'react-native' gets included first
// eslint-disable-next-line no-restricted-imports
import * as ReactNative from "react-native"

import mockFile from "./mockFile"

// @expo/vector-icons' underlying Icon component (createIconSet.tsx) does an
// async font-availability check in componentDidMount and only forwards props
// like `testID` to its rendered Text on the SECOND render, after that check
// resolves — the first synchronous render is an empty placeholder. RTL's
// synchronous getByTestId/getByText queries run before that resolves and
// react-test-renderer logs "not wrapped in act(...)" for the deferred update.
// Real screens don't care (icons just pop in a frame later), but component
// tests that assert on an icon's testID need it present immediately. Mock
// every icon family to a plain synchronous Text so props land on first
// render — same rationale as the app's own Icon-component mock above (avoid
// asset loading), just for the raw @expo/vector-icons import components like
// LiveMeetingRow/InPersonScheduleRow use directly. First needed by
// InPersonScheduleRow.test.tsx's hybrid-indicator assertion (2026-08-03).
jest.mock("@expo/vector-icons", () => {
  // require()'d lazily inside the factory — jest.mock() factories are
  // hoisted above imports and can't close over outer-scope bindings.
  const { createElement } = require("react")
  const { Text } = require("react-native")
  // "icon:" prefix is deliberate: several real on-screen strings elsewhere in
  // this app collide with icon names ("heart", "search", "close", "star",
  // "notifications", "globe-outline"...). Without the prefix, a getByText()
  // aimed at real UI copy could pass by accident because an icon's bare name
  // happened to match — the prefix makes an icon glyph unable to masquerade
  // as UI text, and lets tests that DO want to assert on a specific glyph do
  // so unambiguously (see InPersonScheduleRow.test.tsx's hybrid-icon check).
  const MockVectorIcon = (props: Record<string, unknown>) =>
    createElement(Text, props, `icon:${props.name}`)
  return new Proxy(
    {},
    {
      // The Proxy answers every property access (Ionicons, MaterialIcons,
      // ...) with the same mock component. Two properties need special-casing
      // or module interop breaks silently: `__esModule` must read `true`, not
      // a truthy function, or Babel's CJS/ESM interop unwraps this the wrong
      // way "by luck"; `then` must read `undefined`, or the whole namespace
      // object becomes thenable and any `await import("@expo/vector-icons")`
      // treats it as a Promise and calls `MockVectorIcon(resolve, reject)`,
      // hanging forever instead of resolving.
      get: (_target, prop) => {
        if (prop === "__esModule") return true
        if (prop === "then") return undefined
        return MockVectorIcon
      },
    },
  )
})

// Mock the icon registry to avoid asset loading issues
jest.mock("../app/components/Icon", () => {
  const actual = jest.requireActual("../app/components/Icon")
  return {
    ...actual,
    iconRegistry: {
      back: 1,
      bell: 2,
      caretLeft: 3,
      caretRight: 4,
      check: 5,
      clap: 6,
      community: 7,
      components: 8,
      debug: 9,
      github: 10,
      heart: 11,
      hidden: 12,
      ladybug: 13,
      lock: 14,
      menu: 15,
      more: 16,
      pin: 17,
      podcast: 18,
      settings: 19,
      slack: 20,
      view: 21,
      x: 22,
    },
  }
})

// libraries to mock
jest.doMock("react-native", () => {
  // Extend ReactNative
  return Object.setPrototypeOf(
    {
      Image: {
        ...ReactNative.Image,
        resolveAssetSource: jest.fn((_source) => mockFile), // eslint-disable-line @typescript-eslint/no-unused-vars
        getSize: jest.fn(
          (
            uri: string, // eslint-disable-line @typescript-eslint/no-unused-vars
            success: (width: number, height: number) => void,
            failure?: (_error: any) => void, // eslint-disable-line @typescript-eslint/no-unused-vars
          ) => success(100, 100),
        ),
      },
    },
    ReactNative,
  )
})

jest.mock("i18next", () => ({
  currentLocale: "en",
  t: (key: string, params: Record<string, string>) => {
    return `${key} ${JSON.stringify(params)}`
  },
  translate: (key: string, params: Record<string, string>) => {
    return `${key} ${JSON.stringify(params)}`
  },
}))

jest.mock("expo-localization", () => ({
  ...jest.requireActual("expo-localization"),
  getLocales: () => [{ languageTag: "en-US", textDirection: "ltr" }],
}))

// CHANGED 2026-08-03: added `translate` alongside the existing `i18n` stub.
// Components pull `translate` as a named export of `@/i18n` (see
// LiveMeetingRow.tsx, InPersonScheduleRow.tsx) for one-off accessibility
// strings outside the `tx` prop; the mock previously only covered `i18n`,
// so the first component test to call `translate()` directly hit
// "translate is not a function" — same stub shape as the i18next mock above.
jest.mock("../app/i18n/index.ts", () => ({
  i18n: {
    isInitialized: true,
    language: "en",
    t: (key: string, params: Record<string, string>) => {
      return `${key} ${JSON.stringify(params)}`
    },
    numberToCurrency: jest.fn(),
  },
  translate: (key: string, params?: Record<string, string>) => {
    return `${key} ${JSON.stringify(params ?? {})}`
  },
}))

// useAppTheme() throws outside a <ThemeProvider> (see app/theme/context.tsx).
// This mock's real benefit is not having to hand-wrap every themed component
// under test in <ThemeProvider><NavigationContainer>... (per-test boilerplate
// — see Text.test.tsx for what that looks like) — it does NOT avoid loading
// the theme module itself; `jest.requireActual` below still pulls in
// react-native-mmkv + useColorScheme like any other import. Reproduces the
// real `themed()` reducer (same `.flat(3)` + map + `Object.assign` merge) so
// ThemedStyle functions in components under test actually run, against a
// theme that starts as `lightTheme` but is swappable per test (see
// `__setMockTheme` below). First needed by InPersonScheduleRow.test.tsx
// (2026-08-03), the first jest-expo test for a themed, provider-less
// component.
//
// COST — read before relying on this for anything beyond "render without
// throwing": (1) every test gets `lightTheme` unless it opts in via
// `__setMockTheme`, so dark mode and the user-selectable tint color
// (app/theme/context.tsx's `themeColor` → `colors.tint` merge) are NOT
// exercised by default anywhere that uses this mock — including
// Text.test.tsx, whose `<ThemeProvider>` wrapper is now decorative (the test
// would pass identically with that wrapper deleted, since useAppTheme() is
// intercepted before it would ever read the real context). That's a known,
// accepted tradeoff, not a bug — don't rediscover it as one. (2) `themed` and
// the two setters are created ONCE at module-eval time below and reused by
// every `useAppTheme()` call — this matters because the real ThemeProvider's
// versions are useCallback-memoized on `[theme]`; if this mock instead
// created fresh closures/jest.fn()s on every call, any test with a
// `useEffect(..., [themed])` (or `[setThemeColor]`, etc.) would infinite-loop
// in tests only, since every render would see a "new" dependency.
jest.mock("../app/theme/context", () => {
  const actual = jest.requireActual("../app/theme/context")
  const { lightTheme } = jest.requireActual("../app/theme/theme")

  let mockTheme = lightTheme
  let mockThemeContext: "light" | "dark" = "light"
  const setThemeContextOverride = jest.fn()
  const setThemeColor = jest.fn()
  const themed = (styleOrStyleFn: unknown) => {
    const flatStyles = [styleOrStyleFn].flat(3)
    const stylesArray = flatStyles.map((f) => (typeof f === "function" ? f(mockTheme) : f))
    return Object.assign({}, ...stylesArray)
  }

  return {
    ...actual,
    // Escape hatch for tests that need dark mode or a custom tint — call
    // `__setMockTheme(darkTheme, "dark")` before rendering. Without this,
    // hardcoding lightTheme would foreclose theme-aware assertions
    // repo-wide; this keeps that door open without touching any existing
    // call site or the mock's default behavior.
    __setMockTheme: (theme: typeof lightTheme, themeContext: "light" | "dark" = "light") => {
      mockTheme = theme
      mockThemeContext = themeContext
    },
    useAppTheme: () => ({
      navigationTheme: undefined,
      setThemeContextOverride,
      setThemeColor,
      theme: mockTheme,
      themeColor: undefined,
      themeContext: mockThemeContext,
      themed,
    }),
  }
})

declare const tron // eslint-disable-line @typescript-eslint/no-unused-vars

declare global {
  let __TEST__: boolean
}
