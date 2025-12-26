import { FC, useState } from "react"
import { View, ViewStyle, TextStyle, Switch, TouchableOpacity, Alert, ImageStyle } from "react-native"

import { Button } from "@/components/Button"
import { Icon } from "@/components/Icon"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useAuth } from "@/context/AuthContext"
import { translate } from "@/i18n"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

/**
 * SettingsScreen - User profile, account, and app settings
 *
 * Sections:
 * - Profile: Display name
 * - Recovery: Last recovery date, fellowship
 * - Account: Subscription, user ID, delete data
 * - App Settings: Dark mode, theme color
 * - Logout
 */
export const SettingsScreen: FC<MainTabScreenProps<"Settings">> = function SettingsScreen(_props) {
  const { themed, themeContext, setThemeContextOverride } = useAppTheme()
  const { logout } = useAuth()

  // Local state for settings (would come from context/storage in real app)
  const [displayName] = useState("Alex Johnson")
  const [recoveryDate] = useState("2023-10-15")
  const [fellowship] = useState("AA")
  const [subscription] = useState("Premium")
  const [expiresDate] = useState("2024-12-31")
  const [userId] = useState("USR-123456789")

  const isDarkMode = themeContext === "dark"

  const handleDarkModeToggle = (value: boolean) => {
    setThemeContextOverride(value ? "dark" : "light")
  }

  const handleDeleteAccountData = () => {
    Alert.alert(
      translate("settingsScreen:deleteAccountData"),
      translate("settingsScreen:deleteAccountConfirm"),
      [
        { text: translate("common:cancel"), style: "cancel" },
        { text: translate("common:ok"), style: "destructive", onPress: () => {} },
      ]
    )
  }

  const handleLogout = () => {
    Alert.alert(
      translate("settingsScreen:logout"),
      translate("settingsScreen:logoutConfirm"),
      [
        { text: translate("common:cancel"), style: "cancel" },
        { text: translate("common:ok"), onPress: logout },
      ]
    )
  }

  return (
    <Screen
      preset="scroll"
      safeAreaEdges={["top"]}
      contentContainerStyle={[$styles.container, themed($container)]}
    >
      {/* Header */}
      <Text preset="heading" tx="settingsScreen:title" />
      <Text style={themed($subtitle)} tx="settingsScreen:subtitle" />

      {/* Profile Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Icon icon="community" size={20} color={themed($iconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:profileSection" />
        </View>
        <SettingsRow
          label={translate("settingsScreen:displayName")}
          value={displayName}
        />
      </View>

      {/* Recovery Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Icon icon="heart" size={20} color={themed($recoveryIconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:recoverySection" />
        </View>
        <SettingsRow
          label={translate("settingsScreen:lastRecoveryDate")}
          value={recoveryDate}
        />
        <SettingsRow
          label={translate("settingsScreen:recoveryFellowship")}
          value={fellowship}
          isLast
        />
      </View>

      {/* Account Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Icon icon="lock" size={20} color={themed($accountIconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:accountSection" />
        </View>
        <SettingsRow
          label={translate("settingsScreen:subscription")}
          value={subscription}
          valueStyle={themed($premiumText)}
        />
        <SettingsRow
          label={translate("settingsScreen:expires")}
          value={expiresDate}
        />
        <SettingsRow
          label={translate("settingsScreen:userId")}
          value={userId}
        />
        <TouchableOpacity
          style={themed($deleteRow)}
          onPress={handleDeleteAccountData}
          accessibilityRole="button"
        >
          <Icon icon="x" size={18} color={themed($dangerColor).color} />
          <Text style={themed($deleteText)} tx="settingsScreen:deleteAccountData" />
          <Icon icon="caretRight" size={16} color={themed($dangerColor).color} />
        </TouchableOpacity>
      </View>

      {/* App Settings Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Icon icon="settings" size={20} color={themed($appSettingsIconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:appSettingsSection" />
        </View>
        <View style={themed($settingsRow)}>
          <View style={$styles.row}>
            <Icon icon="view" size={18} color={themed($dimColor).color} style={themed($rowIcon)} />
            <Text style={themed($rowLabel)} tx="settingsScreen:darkMode" />
          </View>
          <Switch
            value={isDarkMode}
            onValueChange={handleDarkModeToggle}
            trackColor={{ false: "#E5E5E5", true: "#4CAF50" }}
            thumbColor="#FFFFFF"
          />
        </View>
        <TouchableOpacity style={[themed($settingsRow), themed($lastRow)]} accessibilityRole="button">
          <View style={$styles.row}>
            <Icon icon="components" size={18} color={themed($appSettingsIconColor).color} style={themed($rowIcon)} />
            <Text style={themed($rowLabel)} tx="settingsScreen:themeColor" />
          </View>
          <View style={$styles.row}>
            <View style={themed($colorPreview)} />
            <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Logout Button */}
      <Button
        tx="settingsScreen:logout"
        preset="default"
        style={themed($logoutButton)}
        textStyle={themed($logoutText)}
        LeftAccessory={() => (
          <Icon icon="back" size={18} color={themed($dangerColor).color} style={themed($logoutIcon)} />
        )}
        onPress={handleLogout}
      />
    </Screen>
  )
}

// Settings Row Component
interface SettingsRowProps {
  label: string
  value: string
  valueStyle?: TextStyle
  isLast?: boolean
}

function SettingsRow({ label, value, valueStyle, isLast }: SettingsRowProps) {
  const { themed } = useAppTheme()

  return (
    <View style={[themed($settingsRow), isLast && themed($lastRow)]}>
      <Text style={themed($rowLabel)}>{label}</Text>
      <Text style={[themed($rowValue), valueStyle]}>{value}</Text>
    </View>
  )
}

// Styles
const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.xxl,
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  marginTop: spacing.xs,
  marginBottom: spacing.lg,
})

const $section: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: colors.border,
  marginBottom: spacing.md,
  overflow: "hidden",
})

const $sectionHeader: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  gap: spacing.xs,
})

const $sectionTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontWeight: "600",
  fontSize: 16,
  color: colors.text,
})

const $settingsRow: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderTopWidth: 1,
  borderTopColor: colors.border,
})

const $lastRow: ThemedStyle<ViewStyle> = () => ({
  borderBottomWidth: 0,
})

const $rowLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})

const $rowValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  fontWeight: "500",
  color: colors.text,
})

const $rowIcon: ThemedStyle<ImageStyle> = ({ spacing }) => ({
  marginRight: spacing.xs,
})

const $deleteRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  gap: spacing.xs,
})

const $deleteText: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  fontSize: 14,
  color: colors.error,
})

const $premiumText: ThemedStyle<TextStyle> = () => ({
  color: "#2196F3",
  fontWeight: "600",
})

const $colorPreview: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  width: 24,
  height: 24,
  borderRadius: 12,
  backgroundColor: "#2196F3",
  marginRight: spacing.xs,
})

const $logoutButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.md,
  backgroundColor: "transparent",
  borderWidth: 0,
})

const $logoutText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.error,
})

const $logoutIcon: ThemedStyle<ImageStyle> = ({ spacing }) => ({
  marginRight: spacing.xs,
  transform: [{ rotate: "180deg" }],
})

// Icon colors
const $iconColor: ThemedStyle<{ color: string }> = ({ colors }) => ({
  color: colors.tint,
})

const $recoveryIconColor: ThemedStyle<{ color: string }> = () => ({
  color: "#4CAF50",
})

const $accountIconColor: ThemedStyle<{ color: string }> = () => ({
  color: "#2196F3",
})

const $appSettingsIconColor: ThemedStyle<{ color: string }> = () => ({
  color: "#9C27B0",
})

const $dangerColor: ThemedStyle<{ color: string }> = ({ colors }) => ({
  color: colors.error,
})

const $dimColor: ThemedStyle<{ color: string }> = ({ colors }) => ({
  color: colors.textDim,
})
