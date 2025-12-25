import { FC } from "react"
import { ViewStyle } from "react-native"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

/**
 * HomeScreen - Dashboard/home screen
 *
 * This is the main landing screen after authentication.
 * Will display summary info, recent activity, etc.
 */
export const HomeScreen: FC<MainTabScreenProps<"Home">> = function HomeScreen(_props) {
  const { themed } = useAppTheme()

  return (
    <Screen
      preset="scroll"
      safeAreaEdges={["top"]}
      contentContainerStyle={[$styles.container, themed($container)]}
    >
      <Text preset="heading" tx="homeScreen:title" />
      <Text style={themed($placeholder)} tx="homeScreen:placeholder" />
    </Screen>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.xxl,
})

const $placeholder: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.lg,
})
