import { FC } from "react"
import { View, ViewStyle, TextStyle } from "react-native"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useDatabase } from "@/db"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

/**
 * HomeScreen - Dashboard/home screen
 *
 * Provides manual database control buttons for development.
 */
export const HomeScreen: FC<MainTabScreenProps<"Home">> = function HomeScreen(_props) {
  const { themed } = useAppTheme()
  const { status, error, openDb, seedDb } = useDatabase()

  return (
    <Screen
      preset="scroll"
      safeAreaEdges={["top"]}
      contentContainerStyle={[$styles.container, themed($container)]}
    >
      <Text preset="heading" tx="homeScreen:title" />

      <View style={themed($statusContainer)}>
        <Text style={themed($statusLabel)}>Database Status:</Text>
        <Text style={themed($statusValue)}>{status}</Text>
        {error && <Text style={themed($errorText)}>{error}</Text>}
      </View>

      <View style={themed($buttonContainer)}>
        <Button
          text="Open Db"
          preset="filled"
          onPress={openDb}
          disabled={status !== "closed" && status !== "error"}
          style={themed($button)}
        />
        <Button
          text="Seed Db"
          preset="filled"
          onPress={seedDb}
          disabled={status !== "open"}
          style={themed($button)}
        />
      </View>
    </Screen>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.xxl,
})

const $statusContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.xl,
  padding: spacing.md,
  backgroundColor: "rgba(0,0,0,0.05)",
  borderRadius: 8,
})

const $statusLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 14,
})

const $statusValue: ThemedStyle<TextStyle> = ({ spacing }) => ({
  fontSize: 18,
  fontWeight: "600",
  marginTop: spacing.xs,
})

const $errorText: ThemedStyle<TextStyle> = ({ spacing, colors }) => ({
  color: colors.error,
  marginTop: spacing.xs,
  fontSize: 14,
})

const $buttonContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.xl,
  gap: spacing.md,
})

const $button: ThemedStyle<ViewStyle> = () => ({
  minWidth: 150,
})
