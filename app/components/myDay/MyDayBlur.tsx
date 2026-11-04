/**
 * MyDayBlur — the frosted-glass blur the My Day package renders behind its cards and header.
 *
 * ADDED 2026-11-04 (My Day tab). This is the only file that imports expo-blur.
 *
 * expo-blur 15's Android prop is `experimentalBlurMethod`, with two values: "none" (translucent
 * overlay) and "dimezisBlurView" (real blur). `blurMethod` and `dimezisBlurViewSdk31Plus` only
 * arrive with expo-blur 57, when this becomes a single prop and the SDK 31 decision can move
 * into the library. Until then `decideAndroidBlurMethod` makes it (native blur on Android 12+).
 *
 * The tint follows the app's scheme (`theme.isDark`); the Daily Dash reference host hardcodes dark.
 */
import { FC } from "react"
import { Platform, StyleSheet } from "react-native"
import { BlurView } from "expo-blur"

import { useAppTheme } from "@/theme/context"
import { decideAndroidBlurMethod } from "@/utils/myDayBlurLogic"

export interface MyDayBlurProps {
  surface: "card" | "header"
}

export const MyDayBlur: FC<MyDayBlurProps> = ({ surface }) => {
  const { theme } = useAppTheme()
  return (
    <BlurView
      intensity={surface === "card" ? 20 : 40}
      tint={theme.isDark ? "dark" : "light"}
      experimentalBlurMethod={decideAndroidBlurMethod({
        os: Platform.OS,
        version: Platform.Version,
      })}
      style={StyleSheet.absoluteFill}
    />
  )
}
