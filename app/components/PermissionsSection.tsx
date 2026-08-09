import { FC } from "react"
import { Pressable, Switch, View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

interface PermissionsSectionProps {
  isPremium: boolean
  notificationsEnabled: boolean
  locationEnabled: boolean
  onNotificationsToggle: (value: boolean) => void
  onLocationToggle: (value: boolean) => void
  onNotificationsPaywall: () => void
}

/**
 * Settings → Permissions. Presentational only: no store reads, no side
 * effects, everything arrives as a prop. That is what lets its jest test mount
 * it without navigation, RevenueCat or the MST tree.
 *
 * The non-premium push row is deliberately NOT a disabled Switch. A greyed
 * control reads as broken and gets ignored; a live-looking one gets tapped,
 * and every tap is an entry into the subscription funnel. The Switch is
 * rendered `pointerEvents="none"` inside a Pressable so the whole row is a
 * single tap target and the thumb never animates to a value that immediately
 * snaps back to the store's.
 */
export const PermissionsSection: FC<PermissionsSectionProps> = ({
  isPremium,
  notificationsEnabled,
  locationEnabled,
  onNotificationsToggle,
  onLocationToggle,
  onNotificationsPaywall,
}) => {
  const { themed, theme } = useAppTheme()

  const pushSwitch = (
    <Switch
      testID="permissions-push-switch"
      value={notificationsEnabled}
      onValueChange={isPremium ? onNotificationsToggle : undefined}
      trackColor={{ false: "#E5E5E5", true: theme.colors.tint }}
      thumbColor="#FFFFFF"
      accessibilityLabel={translate("settingsScreen:enableNotifications")}
    />
  )

  return (
    <View style={themed($section)}>
      <View style={themed($sectionHeader)}>
        <Ionicons name="lock-closed-outline" size={20} color={themed($dimColor).color} />
        <Text style={themed($sectionTitle)} tx="settingsScreen:permissionsSection" />
      </View>

      <Pressable
        testID="permissions-push-row"
        style={themed($settingsRow)}
        onPress={isPremium ? undefined : onNotificationsPaywall}
        accessibilityRole={isPremium ? undefined : "button"}
      >
        <View style={$styles.flex1}>
          <Text style={themed($rowLabel)} tx="settingsScreen:enableNotifications" />
          <Text style={themed($rowHint)} tx="settingsScreen:notificationsHint" />
        </View>
        {isPremium ? pushSwitch : <View pointerEvents="none">{pushSwitch}</View>}
      </Pressable>

      <View style={[themed($settingsRow), themed($lastRow)]}>
        <View style={$styles.flex1}>
          <Text style={themed($rowLabel)} tx="settingsScreen:enableLocation" />
          <Text style={themed($rowHint)} tx="settingsScreen:locationHint" />
        </View>
        <Switch
          testID="permissions-location-switch"
          value={locationEnabled}
          onValueChange={onLocationToggle}
          trackColor={{ false: "#E5E5E5", true: theme.colors.tint }}
          thumbColor="#FFFFFF"
          accessibilityLabel={translate("settingsScreen:enableLocation")}
        />
      </View>
    </View>
  )
}

// Copied verbatim from SettingsScreen.tsx rather than exported/imported — same
// precedent as DaySelectorModal.tsx keeping its own copy of identical modal
// chrome. Do not delete the originals in SettingsScreen.tsx; its other
// sections still use them.
const $section: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginBottom: spacing.lg,
})

const $sectionHeader: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  paddingVertical: spacing.sm + 10,
  gap: spacing.xs,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
  marginBottom: spacing.xs,
})

const $sectionTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontWeight: "700",
  fontSize: 27,
  lineHeight: 34,
  color: colors.text,
})

const $settingsRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: spacing.sm,
})

const $lastRow: ThemedStyle<ViewStyle> = () => ({
  borderBottomWidth: 0,
})

const $rowLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})

const $rowHint: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
  marginTop: 2,
  opacity: 0.7,
})

const $dimColor: ThemedStyle<{ color: string }> = ({ colors }) => ({
  color: colors.textDim,
})
