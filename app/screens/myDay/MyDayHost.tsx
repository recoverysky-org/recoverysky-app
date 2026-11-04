/**
 * MyDayHost — the Daily Dash package's `MyDayProvider`, wired with RecoverySky's look, words,
 * surfaces and navigation (ADDED 2026-11-04, My Day tab spec §4.5, §4.6).
 *
 * Every value handed to the provider is memoised: the package passes each down through its own
 * context, so a fresh object per render would re-render every My Day consumer on every render.
 * - theme: rebuilt only when the scheme or the tint picker changes (spec D4).
 * - surfaces: once; the photo is this launch's (`coldStartMyDayPhoto`), and `MyDayBlur` reads
 *   the scheme itself, so neither needs a dep.
 * - navigation: per stack `navigation` object, which React Navigation keeps stable per screen.
 *
 * No `capabilities`: `reminders` stays off and `sky` arrives later (spec §1), and the package
 * treats every capability as off when none is given.
 */
import { FC, ReactNode, useMemo } from "react"
import * as Application from "expo-application"
import {
  dailyDashDark,
  dailyDashLight,
  MyDayProvider,
  type MyDaySurfaces,
} from "@daily-dash/my-day"
import { observer } from "mobx-react-lite"

import { MyDayBlur } from "@/components/myDay/MyDayBlur"
import { useMyDayCopy } from "@/hooks/useMyDayCopy"
import { createMyDayNavigation, type MyDayNavigationLike } from "@/navigators/myDayNavigation"
import type { MyDayScreenProps, MyDayStackParamList } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { coldStartMyDayPhoto } from "@/theme/myDayPhotos"
import { buildMyDayTheme } from "@/utils/myDayTheme"

export interface MyDayHostProps {
  navigation: MyDayScreenProps<keyof MyDayStackParamList>["navigation"]
  children: ReactNode
}

export const MyDayHost: FC<MyDayHostProps> = observer(function MyDayHost({ navigation, children }) {
  const { theme } = useAppTheme()
  const { isDark } = theme
  const { tint, tintInactive } = theme.colors

  // Spec D4 / §4.6: the scheme's base look (dark when the app is dark), with the app's tint
  // picker laid over it. NOTE 2026-11-04: the task brief wrote this ternary the other way
  // round (`isDark ? dailyDashLight : dailyDashDark`); the spec chooses the base by
  // `theme.isDark`, so a dark app gets `dailyDashDark`.
  const myDayTheme = useMemo(
    () => buildMyDayTheme(isDark ? dailyDashDark : dailyDashLight, { tint, tintInactive }),
    [isDark, tint, tintInactive],
  )
  const copy = useMyDayCopy()
  const surfaces = useMemo<MyDaySurfaces>(
    () => ({ photo: coldStartMyDayPhoto(), Blur: MyDayBlur }),
    [],
  )
  // The one cast: React Navigation's `navigate` is overloaded and generic over the param list,
  // so the stack's prop is not assignable to the adapter's loose `navigate(name: string, …)`.
  // The loose type is what lets `openCrisisPath` name `Meetings`, a tab the stack lacks: React
  // Navigation bubbles an unknown route to the parent tab navigator (spec D3).
  const nav = useMemo(
    () => createMyDayNavigation(navigation as unknown as MyDayNavigationLike),
    [navigation],
  )
  // Same source as the Daily Dash session's client version (`dailyDashSession.ts`); undefined
  // on web, where expo-application has no native version.
  const version = Application.nativeApplicationVersion ?? undefined

  return (
    <MyDayProvider
      theme={myDayTheme}
      copy={copy}
      surfaces={surfaces}
      navigation={nav}
      version={version}
    >
      {children}
    </MyDayProvider>
  )
})
