/**
 * MaintenanceScreen
 *
 * Shown only on cold-start outage — the very first /config fetch failed
 * with no cached data to render. AppNavigator routes here when
 * configStore.outageMode is true. Auto-dismisses (via the navigator)
 * when the next successful /config fetch clears outageMode.
 *
 * Runtime maintenance no longer shows this screen — the non-blocking
 * MaintenanceBanner handles that case.
 *
 * CHANGED 2026-09-06: two variants, chosen live by decideOutageVariant —
 * "Device Offline" (cloud icon, check-your-connection copy, no support
 * link: a web link is useless offline) when NetworkStore says the device
 * has no network, and the original "System Maintenance" copy when the
 * device is online but the API isn't answering. Because this is an
 * observer, wifi returning mid-outage flips the copy to the maintenance
 * variant until the recovery poll reloads the app.
 */
import { FC } from "react"
import { View, ViewStyle, TextStyle, ActivityIndicator, Pressable, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import { useNetworkStore } from "@/models"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { decideOutageVariant } from "@/utils/connectivityLogic"

const SUPPORT_URL = "https://www.recoverysky.app/support"

export const MaintenanceScreen: FC = observer(function MaintenanceScreen() {
  const { themed, theme } = useAppTheme()
  const networkStore = useNetworkStore()

  const offline = decideOutageVariant({ isOffline: networkStore.isOffline }) === "offline"

  return (
    <Screen
      preset="fixed"
      safeAreaEdges={["top", "bottom"]}
      contentContainerStyle={themed($container)}
    >
      <View style={$content}>
        <Ionicons
          name={offline ? "cloud-offline-outline" : "construct-outline"}
          size={80}
          color={theme.colors.tint}
        />
        <Text
          style={themed($title)}
          tx={offline ? "maintenance:offlineTitle" : "maintenance:title"}
        />
        <Text
          style={themed($subtitle)}
          tx={offline ? "maintenance:offlineSubtitle" : "maintenance:subtitle"}
        />
      </View>

      <View style={$footer}>
        <ActivityIndicator size="small" color={theme.colors.textDim} />
        <Text style={themed($checkingText)} tx="maintenance:checking" />

        {/* Support link only in the maintenance variant — a web link is
            useless on an offline device. */}
        {!offline && (
          <Pressable
            onPress={() => Linking.openURL(SUPPORT_URL)}
            accessibilityRole="link"
            accessibilityLabel={translate("maintenance:support")}
            style={$supportLink}
          >
            <Ionicons name="help-circle-outline" size={16} color={theme.colors.tint} />
            <Text
              style={[themed($supportText), { color: theme.colors.tint }]}
              tx="maintenance:support"
            />
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
