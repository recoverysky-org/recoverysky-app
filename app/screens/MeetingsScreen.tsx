import { FC } from "react"
import { ViewStyle } from "react-native"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

/**
 * MeetingsScreen - Meeting list and discovery
 *
 * Displays a list of recovery meetings with search and filtering.
 * Will integrate with MeetingsContext and useMeetings hook.
 */
export const MeetingsScreen: FC<MainTabScreenProps<"Meetings">> = function MeetingsScreen(_props) {
  const { themed } = useAppTheme()

  return (
    <Screen
      preset="scroll"
      safeAreaEdges={["top"]}
      contentContainerStyle={[$styles.container, themed($container)]}
    >
      <Text preset="heading" tx="meetingsScreen:title" />
      <Text style={themed($placeholder)} tx="meetingsScreen:placeholder" />
    </Screen>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.xxl,
})

const $placeholder: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.lg,
})
