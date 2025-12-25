import { FC } from "react"
import { ViewStyle } from "react-native"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

/**
 * ScheduleScreen - Schedule view and management
 *
 * Displays meeting schedules in grid/calendar format.
 * Will integrate with useSchedule hook for schedule visualization.
 */
export const ScheduleScreen: FC<MainTabScreenProps<"Schedule">> = function ScheduleScreen(_props) {
  const { themed } = useAppTheme()

  return (
    <Screen
      preset="scroll"
      safeAreaEdges={["top"]}
      contentContainerStyle={[$styles.container, themed($container)]}
    >
      <Text preset="heading" tx="scheduleScreen:title" />
      <Text style={themed($placeholder)} tx="scheduleScreen:placeholder" />
    </Screen>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.xxl,
})

const $placeholder: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.lg,
})
