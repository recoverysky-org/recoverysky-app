import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { StyleProp, useColorScheme } from "react-native"
import {
  DarkTheme as NavDarkTheme,
  DefaultTheme as NavDefaultTheme,
  Theme as NavTheme,
} from "@react-navigation/native"
import { useMMKVString } from "react-native-mmkv"

import { logger } from "@/utils/logger"
import { load, storage } from "@/utils/storage"

import { setImperativeTheming } from "./context.utils"
import { darkTheme, lightTheme } from "./theme"
import type {
  AllowedStylesT,
  ImmutableThemeContextModeT,
  Theme,
  ThemeContextModeT,
  ThemedFnT,
  ThemedStyle,
} from "./types"

const log = logger.child({ module: "ThemeContext" })

export type ThemeContextType = {
  navigationTheme: NavTheme
  setThemeContextOverride: (newTheme: ThemeContextModeT) => void
  setThemeColor: (color: string | undefined) => void
  theme: Theme
  themeColor: string | undefined
  themeContext: ImmutableThemeContextModeT
  themed: ThemedFnT
}

export const ThemeContext = createContext<ThemeContextType | null>(null)

export interface ThemeProviderProps {
  initialContext?: ThemeContextModeT
}

/**
 * The ThemeProvider is the heart and soul of the design token system. It provides a context wrapper
 * for your entire app to consume the design tokens as well as global functionality like the app's theme.
 *
 * To get started, you want to wrap your entire app's JSX hierarchy in `ThemeProvider`
 * and then use the `useAppTheme()` hook to access the theme context.
 *
 * Documentation: https://docs.infinite.red/ignite-cli/boilerplate/app/theme/Theming/
 */
export const ThemeProvider: FC<PropsWithChildren<ThemeProviderProps>> = ({
  children,
  initialContext,
}) => {
  log.debug("ThemeProvider initializing")

  // The operating system theme:
  const systemColorScheme = useColorScheme()
  // Our saved theme context: can be "light", "dark", or undefined (system theme)
  const [themeScheme, setThemeScheme] = useMMKVString("ignite.themeScheme", storage)
  // Custom theme color (tint override)
  const [themeColor, setThemeColorValue] = useMMKVString("ignite.themeColor", storage)

  // ADDED 2026-09-28: new installs default to dark instead of following the OS.
  // Existing installs that never touched the toggle were following the OS, and
  // flipping them to dark on an OTA would be jarring — so on the first launch
  // after this change, an install that has already finished onboarding and has
  // no saved scheme gets its current OS scheme pinned once. Computed
  // synchronously at mount so there is no one-frame flash of dark before the
  // pin lands. Keyed on the persisted `onboardingCompleted` rather than on the
  // mere presence of the `root-v1` snapshot: setupRootStore's onSnapshot
  // listener can write `root-v1` during first-launch init, before this provider
  // mounts, which would misclassify a fresh install as a legacy one.
  const [legacySystemPin] = useState<ImmutableThemeContextModeT | undefined>(() => {
    if (themeScheme !== undefined) return undefined
    const snapshot = load<{ profileStore?: { onboardingCompleted?: boolean } }>("root-v1")
    if (!snapshot?.profileStore?.onboardingCompleted) return undefined
    return systemColorScheme === "light" ? "light" : "dark"
  })

  useEffect(() => {
    if (legacySystemPin) setThemeScheme(legacySystemPin)
  }, [legacySystemPin, setThemeScheme])

  useEffect(() => {
    log.info("ThemeProvider mounted", {
      systemColorScheme: systemColorScheme ?? "null",
      themeScheme,
      initialContext,
    })
    return () => {
      log.debug("ThemeProvider unmounting")
    }
  }, [])

  /**
   * This function is used to set the theme context and is exported from the useAppTheme() hook.
   *  - setThemeContextOverride("dark") sets the app theme to dark no matter what the system theme is.
   *  - setThemeContextOverride("light") sets the app theme to light no matter what the system theme is.
   *  - setThemeContextOverride(undefined) the app will follow the operating system theme.
   */
  const setThemeContextOverride = useCallback(
    (newTheme: ThemeContextModeT) => {
      setThemeScheme(newTheme)
    },
    [setThemeScheme],
  )

  /**
   * Set a custom theme color (tint). Pass undefined to reset to default.
   */
  const setThemeColor = useCallback(
    (color: string | undefined) => {
      setThemeColorValue(color)
    },
    [setThemeColorValue],
  )

  /**
   * initialContext is the theme context passed in from the app.tsx file and always takes precedence.
   * themeScheme is the value from MMKV. If undefined, we fall back to the system theme
   * systemColorScheme is the value from the device. If undefined, we fall back to "dark"
   * CHANGED 2026-09-28: the system-theme fallback is gone — an unsaved scheme now
   * means dark (see legacySystemPin above for how pre-existing installs keep their
   * look). Settings and onboarding only ever write "light"/"dark", so there was
   * no user-facing "follow system" option to preserve.
   */
  const themeContext: ImmutableThemeContextModeT = useMemo(() => {
    const t = initialContext || themeScheme || legacySystemPin || "dark"
    return t === "dark" ? "dark" : "light"
  }, [initialContext, themeScheme, legacySystemPin])

  const navigationTheme: NavTheme = useMemo(() => {
    switch (themeContext) {
      case "dark":
        return NavDarkTheme
      default:
        return NavDefaultTheme
    }
  }, [themeContext])

  const theme: Theme = useMemo(() => {
    const baseTheme = themeContext === "dark" ? darkTheme : lightTheme

    // Apply custom tint color if set
    if (themeColor) {
      return {
        ...baseTheme,
        colors: {
          ...baseTheme.colors,
          tint: themeColor,
        },
      } as Theme
    }

    return baseTheme
  }, [themeContext, themeColor])

  useEffect(() => {
    log.debug("Theme changed, setting imperative theming", { themeContext })
    setImperativeTheming(theme)
  }, [theme, themeContext])

  const themed = useCallback(
    <T,>(styleOrStyleFn: AllowedStylesT<T>) => {
      const flatStyles = [styleOrStyleFn].flat(3) as (ThemedStyle<T> | StyleProp<T>)[]
      const stylesArray = flatStyles.map((f) => {
        if (typeof f === "function") {
          return (f as ThemedStyle<T>)(theme)
        } else {
          return f
        }
      })
      // Flatten the array of styles into a single object
      return Object.assign({}, ...stylesArray) as T
    },
    [theme],
  )

  const value = {
    navigationTheme,
    setThemeContextOverride,
    setThemeColor,
    theme,
    themeColor,
    themeContext,
    themed,
  }

  log.debug("ThemeProvider rendering children", { themeContext })

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/**
 * This is the primary hook that you will use to access the theme context in your components.
 * Documentation: https://docs.infinite.red/ignite-cli/boilerplate/app/theme/useAppTheme.tsx/
 */
export const useAppTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useAppTheme must be used within an ThemeProvider")
  }
  return context
}
