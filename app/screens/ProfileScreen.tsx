import { FC } from "react"
import { ViewStyle } from "react-native"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

/**
 * ProfileScreen - User profile and settings
 *
 * Displays user profile, preferences, and app settings.
 * Will include access to DevScreen via hidden gesture.
 */
export const ProfileScreen: FC<MainTabScreenProps<"Profile">> = function ProfileScreen(_props) {
  const { themed } = useAppTheme()

  return (
    <Screen
      preset="scroll"
      safeAreaEdges={["top"]}
      contentContainerStyle={[$styles.container, themed($container)]}
    >
      <Text preset="heading" tx="profileScreen:title" />
      <Text style={themed($placeholder)} tx="profileScreen:placeholder" />
    </Screen>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.xxl,
})

const $placeholder: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.lg,
})
