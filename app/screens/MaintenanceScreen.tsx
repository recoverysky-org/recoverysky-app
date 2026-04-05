/**
 * MaintenanceScreen
 *
 * Shown when the server signals MAINTENANCE_MODE: true via /config,
 * or when the config endpoint is unreachable at startup.
 * Auto-dismisses when configStore.maintenanceMode becomes false (polling).
 */
import { FC } from "react"
import { View, ViewStyle, TextStyle, ActivityIndicator, Pressable, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import { useConfigStore } from "@/models"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

const SUPPORT_URL = "https://www.recoverysky.app/support"

export const MaintenanceScreen: FC = observer(function MaintenanceScreen() {
  const { themed, theme } = useAppTheme()
  const configStore = useConfigStore()

  // Maintenance is off but OTA update is in progress — show updating state
  const isUpdating = !configStore.maintenanceMode && configStore.maintenanceUpdate

  const hasCustomMessage = !!configStore.maintenanceMessage
  const hasEta = !!configStore.maintenanceUntil

  // Format ETA if provided
  let etaDisplay = ""
  if (hasEta) {
    try {
      const date = new Date(configStore.maintenanceUntil)
      etaDisplay = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    } catch {
      etaDisplay = configStore.maintenanceUntil
    }
  }

  return (
    <Screen preset="fixed" safeAreaEdges={["top", "bottom"]} contentContainerStyle={themed($container)}>
      <View style={$content}>
        <Ionicons
          name={isUpdating ? "cloud-download-outline" : "construct-outline"}
          size={80}
          color={theme.colors.tint}
        />

        {isUpdating ? (
          <>
            <Text style={themed($title)} tx="maintenance:updatingTitle" />
            <Text style={themed($subtitle)} tx="maintenance:updatingSubtitle" />
          </>
        ) : (
          <>
            <Text
              style={themed($title)}
              text={hasCustomMessage ? configStore.maintenanceMessage : undefined}
              tx={hasCustomMessage ? undefined : "maintenance:title"}
            />

            {hasEta ? (
              <Text style={themed($subtitle)} tx="maintenance:eta" txOptions={{ time: etaDisplay }} />
            ) : (
              <Text style={themed($subtitle)} tx="maintenance:subtitle" />
            )}
          </>
        )}
      </View>

      <View style={$footer}>
        <ActivityIndicator size="small" color={theme.colors.textDim} />
        <Text
          style={themed($checkingText)}
          tx={isUpdating ? "maintenance:updating" : "maintenance:checking"}
        />

        {!isUpdating && (
          <Pressable
            onPress={() => Linking.openURL(SUPPORT_URL)}
            accessibilityRole="link"
            accessibilityLabel={translate("maintenance:support")}
            style={$supportLink}
          >
            <Ionicons name="help-circle-outline" size={16} color={theme.colors.tint} />
            <Text style={[themed($supportText), { color: theme.colors.tint }]} tx="maintenance:support" />
          </Pressable>
        )}
      </View>
    </Screen>
  )
})

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.xl,
})

const $content: ViewStyle = {
  flex: 1,
  justifyContent: "center",
  alignItems: "center",
  gap: 16,
}

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 24,
  fontWeight: "700",
  color: colors.text,
  textAlign: "center",
  lineHeight: 32,
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.textDim,
  textAlign: "center",
  lineHeight: 24,
  paddingHorizontal: 20,
})

const $footer: ViewStyle = {
  alignItems: "center",
  paddingBottom: 40,
  gap: 8,
}

const $checkingText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $supportLink: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  marginTop: 12,
  paddingVertical: 8,
}

const $supportText: ThemedStyle<TextStyle> = () => ({
  fontSize: 14,
  fontWeight: "600",
})
