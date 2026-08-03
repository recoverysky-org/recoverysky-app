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
  const MockVectorIcon = (props: Record<string, unknown>) => createElement(Text, props, props.name)
  return new Proxy(
    {},
    {
      get: () => MockVectorIcon,
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

// useAppTheme() throws outside a <ThemeProvider> (see app/theme/context.tsx),
// but ThemeProvider itself pulls in react-native-mmkv + useColorScheme wiring
// that's noisy to stand up per test. Real screens wrap in ThemeProvider once
// at the app root, so individual component tests reasonably expect theming to
// "just work" without repeating that boilerplate — same idea as the i18next
// mock above. Reproduces the real `themed()` reducer against a fixed light
// theme so ThemedStyle functions in components under test actually run.
// First needed by InPersonScheduleRow.test.tsx (2026-08-03), the first
// jest-expo test for a themed, provider-less component.
jest.mock("../app/theme/context", () => {
  const actual = jest.requireActual("../app/theme/context")
  const { lightTheme } = jest.requireActual("../app/theme/theme")
  return {
    ...actual,
    useAppTheme: () => ({
      navigationTheme: undefined,
      setThemeContextOverride: jest.fn(),
      setThemeColor: jest.fn(),
      theme: lightTheme,
      themeColor: undefined,
      themeContext: "light",
      themed: (styleOrStyleFn: unknown) => {
        const flatStyles = [styleOrStyleFn].flat(3)
        const stylesArray = flatStyles.map((f) => (typeof f === "function" ? f(lightTheme) : f))
        return Object.assign({}, ...stylesArray)
      },
    }),
  }
})

declare const tron // eslint-disable-line @typescript-eslint/no-unused-vars

declare global {
  let __TEST__: boolean
}
