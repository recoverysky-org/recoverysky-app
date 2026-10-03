/**
 * OnboardingTheme - Screen 3
 *
 * Dark/Light mode toggle and Theme Color picker
 *
 * CHANGED 2026-10-03: also Language, Enable Attendance, (only while
 * attendance is on) the Reporting Short Name that used to be asked on
 * OnboardingRecovery. Push Notifications and Location rows exist at the bottom
 * but are hidden behind `permissionRowsVisible`. These are
 * the same settings Settings offers, written to the same store fields; the
 * two permission switches share Settings' handlers (usePermissionToggles).
 * The screen scrolls now, because the list no longer fits a small phone.
 */
import { FC, useCallback, useRef, useState } from "react"
import {
  View,
  ViewStyle,
  TextStyle,
  Pressable,
  Switch,
  Modal,
  TouchableOpacity,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { ThemeColorPicker } from "@/components/ThemeColorPicker"
import { useSubscription } from "@/context/SubscriptionContext"
import { usePermissionToggles } from "@/hooks/usePermissionToggles"
import { translate, getAvailableLanguages, getCurrentLanguage, languageNames } from "@/i18n"
import { useProfileStore } from "@/models"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { ProgressDots } from "./ProgressDots"

// ADDED 2026-10-03: the Push Notifications and Location rows are built but
// hidden. Flip to true to show them at the bottom of the step. Typed `boolean`
// so the hidden branch isn't flagged as unreachable.
const permissionRowsVisible: boolean = false

export const OnboardingTheme: FC<OnboardingScreenProps<"OnboardingTheme">> = observer(
  function OnboardingTheme({ navigation }) {
    const { themed, theme, setThemeContextOverride } = useAppTheme()
    const profileStore = useProfileStore()
    const [colorPickerVisible, setColorPickerVisible] = useState(false)
    const [languageModalVisible, setLanguageModalVisible] = useState(false)
    const { isPremium, showPaywall } = useSubscription()
    const { handleNotificationsToggle, handleLocationToggle } = usePermissionToggles()

    const currentLang = profileStore.language || getCurrentLanguage()
    const availableLanguages = getAvailableLanguages()
    const switchTrack = { false: "#767577", true: theme.colors.tint }

    // Same local-buffer + persist-on-blur shape as Settings' Short Name field:
    // the store write is a SQLite round trip, and a controlled TextInput bound
    // straight to MobX fires stale onChangeText events.
    const [localShortName, setLocalShortName] = useState(profileStore.shortName)
    const localShortNameRef = useRef(localShortName)
    const handleShortNameChange = useCallback(
      (text: string) => {
        setLocalShortName(text)
        localShortNameRef.current = text
        profileStore.setShortNameLocal(text)
      },
      [profileStore],
    )
    const persistShortName = useCallback(() => {
      if (!profileStore.isHydrated) return
      profileStore.setShortName(localShortNameRef.current)
    }, [profileStore])

    // Push is a premium feature (see PermissionsSection). A non-premium tap
    // opens the paywall, and a purchase made there turns the switch on, since
    // that is what the user was reaching for.
    const handlePushPaywall = useCallback(async () => {
      trackEvent("notifications_paywall_tapped", { source: "onboarding" })
      const purchased = await showPaywall()
      if (purchased) void handleNotificationsToggle(true)
    }, [showPaywall, handleNotificationsToggle])

    const handleNext = () => {
      // Tapping Next does not blur the field first on every platform, so the
      // name is persisted here too. Only while the field is on screen.
      if (profileStore.attendanceEnabled) persistShortName()
      trackEvent("onboarding_step", { step: "theme" })
      navigation.navigate("OnboardingPrivacy")
    }

    const pushSwitch = (
      <Switch
        testID="onboarding-push-switch"
        value={profileStore.notificationsEnabled}
        onValueChange={isPremium ? handleNotificationsToggle : undefined}
        trackColor={switchTrack}
        thumbColor="#fff"
        accessibilityLabel={translate("settingsScreen:enableNotifications")}
      />
    )

    const toggleDarkMode = () => {
      setThemeContextOverride(theme.isDark ? "light" : "dark")
    }

    return (
      <Screen
        // CHANGED 2026-10-03: "fixed" → "scroll"; see the file header.
        preset="scroll"
        safeAreaEdges={["top", "bottom"]}
        contentContainerStyle={themed($container)}
      >
        {/* Progress dots */}
        <ProgressDots currentIndex={3} />

        {/* Content */}
        <View style={$content}>
          <Text style={themed($title)} tx="onboarding:themeTitle" />
          <Text style={themed($subtitle)} tx="onboarding:themeSubtitle" />

          {/* Language */}
          <Pressable
            testID="onboarding-language"
            style={themed($settingRow)}
            onPress={() => setLanguageModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={translate("settingsScreen:language")}
            accessibilityValue={{ text: languageNames[currentLang] }}
          >
            <Text style={themed($settingLabel)} tx="settingsScreen:language" />
            <View style={$colorPreviewRow}>
              <Text style={themed($settingValue)}>{languageNames[currentLang]}</Text>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textDim} />
            </View>
          </Pressable>

          {/* Dark Mode Toggle */}
          <View style={themed($settingRow)}>
            <Text style={themed($settingLabel)} tx="onboarding:darkMode" />
            <Switch
              value={theme.isDark}
              onValueChange={toggleDarkMode}
              trackColor={{ false: "#767577", true: theme.colors.tint }}
              thumbColor="#fff"
              accessibilityLabel={translate("onboarding:darkMode")}
            />
          </View>

          {/* Theme Color */}
          <Pressable
            style={themed($settingRow)}
            onPress={() => setColorPickerVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={translate("onboarding:themeColor")}
          >
            <Text style={themed($settingLabel)} tx="onboarding:themeColor" />
            <View style={$colorPreviewRow}>
              <View style={[$colorPreview, { backgroundColor: theme.colors.tint }]} />
            </View>
          </Pressable>

          {/* Enable Attendance. The last visible row carries no separator
              (see $lastRow): that is this one while attendance is off. */}
          <View
            style={[
              themed($settingRow),
              !permissionRowsVisible && !profileStore.attendanceEnabled && $lastRow,
            ]}
          >
            <Text style={themed($settingLabel)} tx="settingsScreen:enableAttendance" />
            <Switch
              testID="onboarding-attendance-switch"
              value={profileStore.attendanceEnabled}
              onValueChange={profileStore.setAttendanceEnabled}
              trackColor={switchTrack}
              thumbColor="#fff"
              accessibilityLabel={translate("settingsScreen:enableAttendance")}
            />
          </View>

          {/* Reporting Short Name. Only while attendance is on: reports and
              the 90-in-90 certificate are the only things that print it. */}
          {profileStore.attendanceEnabled && (
            <View style={[themed($fieldRow), !permissionRowsVisible && $lastRow]}>
              <Text style={themed($settingLabel)} tx="onboarding:reportingShortName" />
              <TextField
                testID="onboarding-short-name"
                value={localShortName}
                onChangeText={handleShortNameChange}
                onBlur={persistShortName}
                placeholderTx="onboarding:shortNamePlaceholder"
                accessibilityLabel={translate("onboarding:reportingShortName")}
                autoCapitalize="words"
                autoCorrect={false}
                spellCheck={false}
                inputWrapperStyle={themed($inputWrapper)}
              />
              <Text style={themed($settingHint)} tx="settingsScreen:shortNameHint" />
            </View>
          )}

          {/* HIDDEN 2026-10-03 (permissionRowsVisible): Push Notifications and
              Location. The rows and their handlers stay wired. */}
          {permissionRowsVisible && (
            <>
              {/* Push Notifications. Same premium gate as Settings → Permissions:
                  a live-looking switch whose non-premium tap opens the paywall,
                  hidden from the accessibility tree so focus lands on the row. */}
              <Pressable
                testID="onboarding-push-row"
                style={themed($settingRow)}
                onPress={isPremium ? undefined : handlePushPaywall}
                accessibilityRole={isPremium ? undefined : "button"}
                accessibilityLabel={
                  isPremium ? undefined : translate("settingsScreen:upgradeToPro")
                }
                accessibilityHint={
                  isPremium ? undefined : translate("accessibility:doubleTapToUpgrade")
                }
              >
                <View style={$labelColumn}>
                  <Text style={themed($settingLabel)} tx="settingsScreen:enableNotifications" />
                  <Text style={themed($settingHint)} tx="settingsScreen:notificationsHint" />
                </View>
                {isPremium ? (
                  pushSwitch
                ) : (
                  <View
                    pointerEvents="none"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    {pushSwitch}
                  </View>
                )}
              </Pressable>

              {/* Location */}
              <View style={themed($settingRow)}>
                <View style={$labelColumn}>
                  <Text style={themed($settingLabel)} tx="settingsScreen:enableLocation" />
                  <Text style={themed($settingHint)} tx="settingsScreen:locationHint" />
                </View>
                <Switch
                  testID="onboarding-location-switch"
                  value={profileStore.locationEnabled}
                  onValueChange={handleLocationToggle}
                  trackColor={switchTrack}
                  thumbColor="#fff"
                  accessibilityLabel={translate("settingsScreen:enableLocation")}
                />
              </View>
            </>
          )}
        </View>

        {/* Language Modal — same list as Settings' */}
        <Modal
          visible={languageModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setLanguageModalVisible(false)}
        >
          <Pressable
            style={themed($modalOverlay)}
            onPress={() => setLanguageModalVisible(false)}
            accessibilityLabel={translate("common:close")}
          >
            <View style={themed($modalContent)} accessibilityViewIsModal>
              <Text style={themed($modalTitle)} tx="settingsScreen:selectLanguage" />
              {availableLanguages.map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[
                    themed($modalOption),
                    currentLang === lang && themed($modalOptionSelected),
                  ]}
                  onPress={() => {
                    profileStore.setLanguage(lang)
                    trackEvent("language_changed", { language: lang, source: "onboarding" })
                    setLanguageModalVisible(false)
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={languageNames[lang]}
                  accessibilityState={{ selected: currentLang === lang }}
                >
                  <Text style={themed($modalOptionText)}>{languageNames[lang]}</Text>
                  {currentLang === lang && (
                    <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
                  )}
                </TouchableOpacity>
              ))}
              <Text style={themed($settingHint)} tx="settingsScreen:translationHint" />
            </View>
          </Pressable>
        </Modal>

        {/* Color Picker Modal */}
        <ThemeColorPicker
          visible={colorPickerVisible}
          onClose={() => setColorPickerVisible(false)}
        />

        {/* Footer */}
        <View style={themed($footer)}>
          <Pressable
            style={[
              themed($button),
              { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
            ]}
            onPress={handleNext}
            accessibilityRole="button"
            accessibilityLabel={translate("onboarding:next")}
          >
            <Text
              style={[themed($buttonText), { color: theme.colors.tint }]}
              tx="onboarding:next"
            />
          </Pressable>
        </View>
      </Screen>
    )
  },
)

// ============================================================================
// Styles
// ============================================================================

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  // flexGrow, not flex: inside the scroll preset the content has to be able to
  // grow past the viewport while still pinning the footer when it is short.
  flexGrow: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.xl,
})

const $content: ViewStyle = {
  flex: 1,
  paddingTop: 48,
}

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 28,
  fontWeight: "700",
  lineHeight: 38,
  color: colors.text,
  marginBottom: 8,
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 16,
  color: colors.textDim,
  marginBottom: spacing.xl,
})

const $settingRow: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: spacing.md,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
})

const $settingLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
})

const $settingValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.textDim,
})

const $settingHint: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
  marginTop: 2,
})

// Label + hint beside a switch: takes the free width so a long hint wraps
// instead of pushing the switch off the row.
const $labelColumn: ViewStyle = {
  flex: 1,
  paddingRight: 12,
}

const $fieldRow: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  paddingVertical: spacing.md,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
  gap: spacing.xs,
})

// The list's last visible row: no trailing separator under it.
const $lastRow: ViewStyle = {
  borderBottomWidth: 0,
}

const $inputWrapper: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 10,
})

const $modalOverlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  justifyContent: "center",
  alignItems: "center",
})

const $modalContent: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.card,
  borderRadius: 16,
  padding: spacing.lg,
  width: "80%",
  maxWidth: 320,
})

const $modalTitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.text,
  marginBottom: spacing.md,
  textAlign: "center",
})

const $modalOption: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.sm,
  borderRadius: 8,
})

const $modalOptionSelected: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.border,
})

const $modalOptionText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
})

const $colorPreviewRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
}

const $colorPreview: ViewStyle = {
  width: 28,
  height: 28,
  borderRadius: 14,
}

const $footer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingTop: spacing.lg,
  paddingBottom: spacing.lg,
  gap: spacing.md,
})

const $button: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  backgroundColor: colors.background,
  borderWidth: 1.5,
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.xl,
  borderRadius: 12,
  alignItems: "center",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $buttonText: ThemedStyle<TextStyle> = () => ({
  fontSize: 18,
  fontWeight: "600",
})
