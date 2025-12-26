import { FC, useState, useMemo } from "react"
import {
  View,
  ViewStyle,
  TextStyle,
  Switch,
  TouchableOpacity,
  Alert,
  ImageStyle,
  Modal,
  Pressable,
  Platform,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker"

import { Button } from "@/components/Button"
import { Icon } from "@/components/Icon"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { useAuth } from "@/context/AuthContext"
import {
  translate,
  getAvailableLanguages,
  getCurrentLanguage,
  changeLanguage,
  languageNames,
} from "@/i18n"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

type Pronouns = "he/him" | "she/her" | "they/them" | "em/ers" | null

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

  // Profile state
  const [shortName, setShortName] = useState("Joe B.")
  const [showCleanDate, setShowCleanDate] = useState(true)
  const [showCleanDays, setShowCleanDays] = useState(true)
  const [showPronouns, setShowPronouns] = useState(true)
  const [pronouns, setPronouns] = useState<Pronouns>("he/him")
  const [pronounsModalVisible, setPronounsModalVisible] = useState(false)

  // Language state
  const [currentLang, setCurrentLang] = useState(getCurrentLanguage())
  const [languageModalVisible, setLanguageModalVisible] = useState(false)
  const availableLanguages = getAvailableLanguages()

  const handleLanguageChange = async (langCode: string) => {
    await changeLanguage(langCode)
    setCurrentLang(langCode)
    setLanguageModalVisible(false)
  }

  // Recovery state
  const [recoveryDate, setRecoveryDate] = useState(new Date("2023-10-15"))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [fellowship] = useState("AA")

  // Format date for display (local timezone, not UTC)
  const formatDate = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  const handleDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false)
    }
    if (selectedDate) {
      setRecoveryDate(selectedDate)
    }
  }

  // Account state
  const [subscription] = useState("Premium")
  const [expiresDate] = useState("2024-12-31")
  const [userId] = useState("USR-123456789")

  const isDarkMode = themeContext === "dark"

  // Calculate clean days from recovery date
  const cleanDays = useMemo(() => {
    const today = new Date()
    const diffTime = Math.abs(today.getTime() - recoveryDate.getTime())
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }, [recoveryDate])

  // Helper to get translated pronoun label
  const getPronounsLabel = (p: Pronouns): string => {
    switch (p) {
      case "he/him":
        return translate("settingsScreen:pronounHeHim")
      case "she/her":
        return translate("settingsScreen:pronounSheHer")
      case "they/them":
        return translate("settingsScreen:pronounTheyThem")
      case "em/ers":
        return translate("settingsScreen:pronounEmErs")
      default:
        return translate("settingsScreen:selectPronouns")
    }
  }

  // Generate display name based on toggles
  const generatedDisplayName = useMemo(() => {
    const parts: string[] = []

    if (showPronouns && pronouns) {
      parts.push(getPronounsLabel(pronouns))
    }
    if (showCleanDate) {
      parts.push(formatDate(recoveryDate))
    }
    if (showCleanDays) {
      parts.push(translate("settingsScreen:cleanDaysFormat", { count: cleanDays }))
    }

    if (parts.length > 0) {
      return `${shortName} (${parts.join(" ")})`
    }
    return shortName
  }, [shortName, showPronouns, pronouns, showCleanDate, recoveryDate, showCleanDays, cleanDays])

  const handleDarkModeToggle = (value: boolean) => {
    setThemeContextOverride(value ? "dark" : "light")
  }

  const handleDeleteUserData = () => {
    Alert.alert(
      translate("settingsScreen:deleteUserData"),
      translate("settingsScreen:deleteUserDataConfirm"),
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

        {/* Generated Display Name (read-only) */}
        <SettingsRow
          label={translate("settingsScreen:displayName")}
          value={generatedDisplayName}
        />

        {/* Editable Short Name */}
        <View style={themed($settingsRow)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:shortName" />
          <TextField
            value={shortName}
            onChangeText={setShortName}
            placeholder={translate("settingsScreen:shortNamePlaceholder")}
            style={themed($shortNameInput)}
            inputWrapperStyle={themed($shortNameInputWrapper)}
          />
        </View>

        {/* Clean Date Toggle */}
        <View style={themed($settingsRow)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:showCleanDate" />
          <Switch
            value={showCleanDate}
            onValueChange={setShowCleanDate}
            trackColor={{ false: "#E5E5E5", true: "#4CAF50" }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Clean Days Toggle */}
        <View style={themed($settingsRow)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:showCleanDays" />
          <Switch
            value={showCleanDays}
            onValueChange={setShowCleanDays}
            trackColor={{ false: "#E5E5E5", true: "#4CAF50" }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Pronouns Toggle + Picker */}
        <View style={themed($settingsRow)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:showPronouns" />
          <View style={$styles.row}>
            {showPronouns && (
              <TouchableOpacity
                onPress={() => setPronounsModalVisible(true)}
                style={themed($pronounsButton)}
              >
                <Text style={themed($pronounsButtonText)}>{getPronounsLabel(pronouns)}</Text>
                <Icon icon="caretRight" size={14} color={themed($dimColor).color} />
              </TouchableOpacity>
            )}
            <Switch
              value={showPronouns}
              onValueChange={setShowPronouns}
              trackColor={{ false: "#E5E5E5", true: "#4CAF50" }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>
      </View>

      {/* Pronouns Modal */}
      <Modal
        visible={pronounsModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPronounsModalVisible(false)}
      >
        <Pressable style={themed($modalOverlay)} onPress={() => setPronounsModalVisible(false)}>
          <View style={themed($modalContent)}>
            <Text style={themed($modalTitle)} tx="settingsScreen:selectPronouns" />
            {(["he/him", "she/her", "they/them", "em/ers"] as Pronouns[]).map((p) => (
              <TouchableOpacity
                key={p}
                style={[themed($modalOption), pronouns === p && themed($modalOptionSelected)]}
                onPress={() => {
                  setPronouns(p)
                  setPronounsModalVisible(false)
                }}
              >
                <Text
                  style={[themed($modalOptionText), pronouns === p && themed($modalOptionTextSelected)]}
                >
                  {getPronounsLabel(p)}
                </Text>
                {pronouns === p && <Icon icon="check" size={18} color={themed($tintColor).color} />}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Language Modal */}
      <Modal
        visible={languageModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLanguageModalVisible(false)}
      >
        <Pressable style={themed($modalOverlay)} onPress={() => setLanguageModalVisible(false)}>
          <View style={themed($modalContent)}>
            <Text style={themed($modalTitle)} tx="settingsScreen:selectLanguage" />
            {availableLanguages.map((lang) => (
              <TouchableOpacity
                key={lang}
                style={[themed($modalOption), currentLang === lang && themed($modalOptionSelected)]}
                onPress={() => handleLanguageChange(lang)}
              >
                <Text
                  style={[
                    themed($modalOptionText),
                    currentLang === lang && themed($modalOptionTextSelected),
                  ]}
                >
                  {languageNames[lang]}
                </Text>
                {currentLang === lang && (
                  <Icon icon="check" size={18} color={themed($tintColor).color} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Recovery Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Icon icon="heart" size={20} color={themed($recoveryIconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:recoverySection" />
        </View>

        {/* Recovery Date Picker */}
        <TouchableOpacity
          style={themed($settingsRow)}
          onPress={() => setShowDatePicker(true)}
          accessibilityRole="button"
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:recoveryDate" />
          <View style={$styles.row}>
            <Text style={themed($rowValue)}>{formatDate(recoveryDate)}</Text>
            <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
          </View>
        </TouchableOpacity>

        {/* Date Picker - iOS shows inline, Android shows modal */}
        {showDatePicker && (
          Platform.OS === "ios" ? (
            <View style={themed($datePickerContainer)}>
              <View style={themed($datePickerHeader)}>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={themed($datePickerDone)} tx="common:ok" />
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={recoveryDate}
                mode="date"
                display="spinner"
                onChange={handleDateChange}
                maximumDate={new Date()}
                style={$datePickerSpinner}
              />
            </View>
          ) : (
            <DateTimePicker
              value={recoveryDate}
              mode="date"
              display="default"
              onChange={handleDateChange}
              maximumDate={new Date()}
            />
          )
        )}

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
          onPress={handleDeleteUserData}
          accessibilityRole="button"
        >
          <Icon icon="x" size={18} color={themed($dangerColor).color} />
          <Text style={themed($deleteText)} tx="settingsScreen:deleteUserData" />
          <Icon icon="caretRight" size={16} color={themed($dangerColor).color} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[themed($deleteRow), themed($lastRow)]}
          onPress={handleLogout}
          accessibilityRole="button"
        >
          <Icon icon="back" size={18} color={themed($dangerColor).color} style={themed($logoutRowIcon)} />
          <Text style={themed($deleteText)} tx="settingsScreen:logout" />
          <Icon icon="caretRight" size={16} color={themed($dangerColor).color} />
        </TouchableOpacity>
      </View>

      {/* App Settings Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Icon icon="settings" size={20} color={themed($appSettingsIconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:appSettingsSection" />
        </View>

        {/* Language Picker */}
        <TouchableOpacity
          style={themed($settingsRow)}
          onPress={() => setLanguageModalVisible(true)}
          accessibilityRole="button"
        >
          <View style={$styles.row}>
            <Ionicons name="globe-outline" size={18} color={themed($appSettingsIconColor).color} style={themed($rowIcon)} />
            <Text style={themed($rowLabel)} tx="settingsScreen:language" />
          </View>
          <View style={$styles.row}>
            <Text style={themed($rowValue)}>{languageNames[currentLang]}</Text>
            <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
          </View>
        </TouchableOpacity>

        {/* Dark Mode Toggle */}
        <View style={themed($settingsRow)}>
          <View style={$styles.row}>
            <Ionicons
              name={isDarkMode ? "moon-outline" : "sunny-outline"}
              size={18}
              color={themed($dimColor).color}
              style={themed($rowIcon)}
            />
            <Text style={themed($rowLabel)} tx="settingsScreen:darkMode" />
          </View>
          <Switch
            value={isDarkMode}
            onValueChange={handleDarkModeToggle}
            trackColor={{ false: "#E5E5E5", true: "#4CAF50" }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Theme Color */}
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
  backgroundColor: colors.card,
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

const $logoutRowIcon: ThemedStyle<ImageStyle> = ({ spacing }) => ({
  marginRight: spacing.xs,
  transform: [{ rotate: "180deg" }],
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

const $tintColor: ThemedStyle<{ color: string }> = ({ colors }) => ({
  color: colors.tint,
})

// Short Name Input
const $shortNameInput: ThemedStyle<ViewStyle> = () => ({
  flex: 0,
  minHeight: 0,
})

const $shortNameInputWrapper: ThemedStyle<ViewStyle> = ({ colors }) => ({
  minHeight: 36,
  paddingHorizontal: 8,
  backgroundColor: colors.background,
  borderColor: colors.border,
})

// Pronouns Button
const $pronounsButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: spacing.sm,
  paddingVertical: spacing.xs,
  marginRight: spacing.sm,
  gap: 4,
})

const $pronounsButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.tint,
})

// Modal Styles
const $modalOverlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  justifyContent: "center",
  alignItems: "center",
})

const $modalContent: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderRadius: 12,
  padding: spacing.md,
  minWidth: 280,
  maxWidth: "80%",
})

const $modalTitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.text,
  marginBottom: spacing.md,
  textAlign: "center",
})

const $modalOption: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.sm,
  borderRadius: 8,
  marginBottom: spacing.xs,
  borderWidth: 1,
  borderColor: colors.border,
})

const $modalOptionSelected: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.tint + "20",
  borderColor: colors.tint,
})

const $modalOptionText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
})

const $modalOptionTextSelected: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontWeight: "600",
})

// Date Picker Styles
const $datePickerContainer: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderTopWidth: 1,
  borderTopColor: colors.border,
  backgroundColor: colors.background,
})

const $datePickerHeader: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  justifyContent: "flex-end",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
})

const $datePickerDone: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.tint,
})

// Non-themed style for iOS date picker spinner (needs explicit height)
const $datePickerSpinner: ViewStyle = {
  height: 180,
}
