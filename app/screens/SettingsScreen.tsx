import { FC, useState, useCallback, useEffect, useRef } from "react"
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
  Linking,
  ActivityIndicator,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker"
import { useFocusEffect } from "@react-navigation/native"
import { Fellowship } from "@recoverysky-org/common/browser"
import { observer } from "mobx-react-lite"

import { Icon } from "@/components/Icon"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { ThemeColorPicker } from "@/components/ThemeColorPicker"
import { useSubscription } from "@/context/SubscriptionContext"
import { translate, getAvailableLanguages, getCurrentLanguage, languageNames } from "@/i18n"
import { useProfileStore, useAuthenticationStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useZoomAuth } from "@/services/auth"
import { useAuth0Wrapper } from "@/services/auth/useAuth0Wrapper"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

type Pronouns = "none" | "he/him" | "she/her" | "they/them" | "em/ers" | null

/** Fellowships available for user selection */
const SELECTABLE_FELLOWSHIPS = [
  Fellowship.AA,
  Fellowship.NA,
  Fellowship.CMA,
  Fellowship.MA,
  Fellowship.RD,
] as const

/**
 * SettingsScreen - User profile, account, and app settings
 *
 * Sections:
 * 1. Recovery: Fellowship, recovery date
 * 2. Profile: Display name, pronouns
 * 3. App Settings: Language, dark mode, theme color
 * 4. Attendance: Enable tracking, export email
 * 5. Subscription: Status, upgrade, restore purchases
 * 6. Account: User ID, delete data, logout
 */
export const SettingsScreen: FC<MainTabScreenProps<"Settings">> = observer(function SettingsScreen({
  navigation,
}) {
  const { themed, themeContext, setThemeContextOverride, themeColor, theme } = useAppTheme()
  const { logout } = useAuth0Wrapper()
  const {
    isConnected: zoomConnected,
    zoomAuth,
    disconnect: disconnectZoom,
    reload: reloadZoomAuth,
  } = useZoomAuth()

  // Reload zoom auth when screen comes into focus (after returning from ZoomLoginScreen)
  useFocusEffect(
    useCallback(() => {
      reloadZoomAuth()
    }, [reloadZoomAuth]),
  )

  // MST Stores - reactive!
  const profileStore = useProfileStore()
  const authStore = useAuthenticationStore()

  // Local buffer for shortName — decouples TextInput from MobX re-renders
  // to prevent React Native's controlled TextInput from firing stale onChangeText events
  const [localShortName, setLocalShortName] = useState(profileStore.shortName)
  const localShortNameRef = useRef(localShortName)

  // Sync store → local when hydrated from SQLite (replaces the pre-hydration default)
  useEffect(() => {
    if (profileStore.isHydrated) {
      setLocalShortName(profileStore.shortName)
      localShortNameRef.current = profileStore.shortName
    }
  }, [profileStore.isHydrated]) // eslint-disable-line react-hooks/exhaustive-deps

  // On each keystroke: update local state + store volatile (for live Display Name)
  const handleShortNameChange = useCallback(
    (text: string) => {
      setLocalShortName(text)
      localShortNameRef.current = text
      profileStore.setShortNameLocal(text)
    },
    [profileStore],
  )

  // Persist to SQLite on blur (single write, no races)
  const handleShortNameBlur = useCallback(() => {
    if (!profileStore.isHydrated) return
    profileStore.setShortName(localShortNameRef.current)
  }, [profileStore])

  // Subscription state from RevenueCat
  const {
    isPremium,
    hasAttendance,
    isLoading: isSubscriptionLoading,
    subscriptionInfo,
    showPaywall,
    restore,
    refresh: subscriptionRefresh,
  } = useSubscription()

  // UI-only state (modals, pickers)
  const [pronounsModalVisible, setPronounsModalVisible] = useState(false)
  const [fellowshipModalVisible, setFellowshipModalVisible] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [languageModalVisible, setLanguageModalVisible] = useState(false)
  const [colorPickerVisible, setColorPickerVisible] = useState(false)
  const [emailValid, setEmailValid] = useState<boolean | null>(null)

  // Debounced email validation indicator
  useEffect(() => {
    if (!profileStore.reportEmail) {
      setEmailValid(null)
      return
    }
    const timer = setTimeout(() => {
      setEmailValid(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileStore.reportEmail))
    }, 500)
    return () => clearTimeout(timer)
  }, [profileStore.reportEmail])

  // Language state from MST (persisted)
  const currentLang = profileStore.language || getCurrentLanguage()
  const availableLanguages = getAvailableLanguages()

  const handleLanguageChange = (langCode: string) => {
    profileStore.setLanguage(langCode)
    setLanguageModalVisible(false)
  }

  const handleDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false)
    }
    if (selectedDate) {
      profileStore.setRecoveryDate(selectedDate)
    }
  }

  const isDarkMode = themeContext === "dark"

  // Helper to get translated pronoun label
  const getPronounsLabel = (p: Pronouns): string => {
    switch (p) {
      case "none":
        return translate("settingsScreen:pronounNone")
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

  // Helper to get fellowship label (short form)
  const getFellowshipLabel = (f: string): string => {
    switch (f) {
      case Fellowship.AA:
        return "AA"
      case Fellowship.NA:
        return "NA"
      case Fellowship.CMA:
        return "CMA"
      case Fellowship.MA:
        return "MA"
      case Fellowship.RD:
        return "RD"
      default:
        return translate("settingsScreen:selectFellowship")
    }
  }

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
      ],
    )
  }

  const handleLogout = () => {
    Alert.alert(translate("settingsScreen:logout"), translate("settingsScreen:logoutConfirm"), [
      { text: translate("common:cancel"), style: "cancel" },
      {
        text: translate("common:ok"),
        onPress: async () => {
          await disconnectZoom()
          profileStore.setZoomConnected(false)
          await logout()
        },
      },
    ])
  }

  const handleUpgrade = async () => {
    const purchased = await showPaywall()
    if (purchased) {
      Alert.alert(
        translate("settingsScreen:subscriptionSuccess"),
        translate("settingsScreen:subscriptionSuccessMessage"),
      )
    }
  }

  const handleRestorePurchases = async () => {
    const restored = await restore()
    if (restored) {
      Alert.alert(
        translate("settingsScreen:restoreSuccess"),
        translate("settingsScreen:restoreSuccessMessage"),
      )
    } else {
      Alert.alert(
        translate("settingsScreen:restoreNoSubscription"),
        translate("settingsScreen:restoreNoSubscriptionMessage"),
      )
    }
  }

  const handleManageSubscription = () => {
    if (subscriptionInfo?.managementUrl) {
      Linking.openURL(subscriptionInfo.managementUrl)
    } else {
      // Fallback to App Store/Play Store subscription settings
      if (Platform.OS === "ios") {
        Linking.openURL("https://apps.apple.com/account/subscriptions")
      } else {
        Linking.openURL("https://play.google.com/store/account/subscriptions")
      }
    }
  }

  // Format expiration date for display
  const formatExpirationDate = (): string => {
    if (!subscriptionInfo?.expirationDate) return "-"
    return subscriptionInfo.expirationDate.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  // Get subscription status text
  const getSubscriptionStatus = (): string => {
    if (isSubscriptionLoading) return "..."
    if (isPremium) {
      if (subscriptionInfo?.isInTrial) return translate("settingsScreen:subscriptionPremiumTrial")
      return translate("settingsScreen:subscriptionPremium")
    }
    if (hasAttendance) {
      return translate("settingsScreen:subscriptionAttendance")
    }
    return translate("settingsScreen:subscriptionFree")
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

      {/* Recovery Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Ionicons
            name="shield-checkmark-outline"
            size={20}
            color={themed($recoveryIconColor).color}
          />
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
            <Text style={themed($rowValue)}>{profileStore.recoveryDate}</Text>
            <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
          </View>
        </TouchableOpacity>

        {/* Date Picker - iOS shows inline, Android shows modal */}
        {showDatePicker &&
          (Platform.OS === "ios" ? (
            <View style={themed($datePickerContainer)}>
              <View style={themed($datePickerHeader)}>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={themed($datePickerDone)} tx="common:ok" />
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={profileStore.recoveryDateAsDate}
                mode="date"
                display="spinner"
                onChange={handleDateChange}
                maximumDate={new Date()}
                style={$datePickerSpinner}
                themeVariant={isDarkMode ? "dark" : "light"}
              />
            </View>
          ) : (
            <DateTimePicker
              value={profileStore.recoveryDateAsDate}
              mode="date"
              display="default"
              onChange={handleDateChange}
              maximumDate={new Date()}
              themeVariant={isDarkMode ? "dark" : "light"}
            />
          ))}

        <TouchableOpacity
          style={[themed($settingsRow), themed($lastRow)]}
          onPress={() => setFellowshipModalVisible(true)}
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:recoveryFellowship" />
          <View style={$styles.row}>
            <Text style={themed($rowValue)}>{getFellowshipLabel(profileStore.fellowship)}</Text>
            <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Profile Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Icon icon="community" size={20} color={themed($iconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:profileSection" />
        </View>

        {/* Generated Display Name (read-only) - computed from MST store */}
        <SettingsRow
          label={translate("settingsScreen:displayName")}
          value={profileStore.displayName}
        />

        {/* Editable Short Name */}
        <View style={themed($settingsRow)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:shortName" />
          <TextField
            value={localShortName}
            onChangeText={handleShortNameChange}
            onBlur={handleShortNameBlur}
            autoCorrect={false}
            autoCapitalize="words"
            spellCheck={false}
            placeholder={translate("settingsScreen:shortNamePlaceholder")}
            style={themed($shortNameInput)}
            inputWrapperStyle={themed($shortNameInputWrapper)}
          />
        </View>

        {/* Clean Date Toggle */}
        <View style={themed($settingsRow)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:showCleanDate" />
          <Switch
            value={profileStore.showCleanDate}
            onValueChange={profileStore.setShowCleanDate}
            trackColor={{ false: "#E5E5E5", true: themeColor || theme.colors.tint }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Clean Days Toggle */}
        <View style={themed($settingsRow)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:showCleanDays" />
          <Switch
            value={profileStore.showCleanDays}
            onValueChange={profileStore.setShowCleanDays}
            trackColor={{ false: "#E5E5E5", true: themeColor || theme.colors.tint }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Pronouns Toggle + Picker */}
        <View style={themed($settingsRow)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:showPronouns" />
          <View style={$styles.row}>
            {profileStore.showPronouns && (
              <TouchableOpacity
                onPress={() => setPronounsModalVisible(true)}
                style={themed($pronounsButton)}
              >
                <Text style={themed($pronounsButtonText)}>
                  {getPronounsLabel(profileStore.pronouns)}
                </Text>
                <Icon icon="caretRight" size={14} color={themed($dimColor).color} />
              </TouchableOpacity>
            )}
            <Switch
              value={profileStore.showPronouns}
              onValueChange={profileStore.setShowPronouns}
              trackColor={{ false: "#E5E5E5", true: themeColor || theme.colors.tint }}
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
            {(["none", "he/him", "she/her", "they/them", "em/ers"] as Pronouns[]).map((p) => (
              <TouchableOpacity
                key={p}
                style={[
                  themed($modalOption),
                  profileStore.pronouns === p && themed($modalOptionSelected),
                ]}
                onPress={() => {
                  profileStore.setPronouns(p)
                  setPronounsModalVisible(false)
                }}
              >
                <Text
                  style={[
                    themed($modalOptionText),
                    profileStore.pronouns === p && themed($modalOptionTextSelected),
                  ]}
                >
                  {getPronounsLabel(p)}
                </Text>
                {profileStore.pronouns === p && (
                  <Icon icon="check" size={18} color={themed($tintColor).color} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Fellowship Modal */}
      <Modal
        visible={fellowshipModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFellowshipModalVisible(false)}
      >
        <Pressable style={themed($modalOverlay)} onPress={() => setFellowshipModalVisible(false)}>
          <View style={themed($modalContent)}>
            <Text style={themed($modalTitle)} tx="settingsScreen:selectFellowship" />
            {SELECTABLE_FELLOWSHIPS.map((f) => (
              <TouchableOpacity
                key={f}
                style={[
                  themed($modalOption),
                  profileStore.fellowship === f && themed($modalOptionSelected),
                ]}
                onPress={() => {
                  profileStore.setFellowship(f)
                  setFellowshipModalVisible(false)
                }}
              >
                <Text
                  style={[
                    themed($modalOptionText),
                    profileStore.fellowship === f && themed($modalOptionTextSelected),
                  ]}
                >
                  {getFellowshipLabel(f)}
                </Text>
                {profileStore.fellowship === f && (
                  <Icon icon="check" size={18} color={themed($tintColor).color} />
                )}
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
          <Text style={themed($rowLabel)} tx="settingsScreen:language" />
          <View style={$styles.row}>
            <Text style={themed($rowValue)}>{languageNames[currentLang]}</Text>
            <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
          </View>
        </TouchableOpacity>

        {/* Dark Mode Toggle */}
        <View style={themed($settingsRow)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:darkMode" />
          <Switch
            value={isDarkMode}
            onValueChange={handleDarkModeToggle}
            trackColor={{ false: "#E5E5E5", true: themeColor || theme.colors.tint }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Theme Color */}
        <TouchableOpacity
          style={themed($settingsRow)}
          accessibilityRole="button"
          onPress={() => setColorPickerVisible(true)}
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:themeColor" />
          <View style={$styles.row}>
            <View
              style={[$colorPreviewSwatch, { backgroundColor: themeColor || theme.colors.tint }]}
            />
            <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
          </View>
        </TouchableOpacity>

        {/* Reset Home Tips */}
        <TouchableOpacity
          style={[themed($settingsRow), themed($lastRow)]}
          accessibilityRole="button"
          onPress={() => profileStore.resetHomeCards()}
        >
          <View>
            <Text style={themed($rowLabel)} tx="settingsScreen:resetHomeTips" />
            <Text style={themed($rowHint)} tx="settingsScreen:resetHomeTipsHint" />
          </View>
          <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
        </TouchableOpacity>
      </View>

      {/* Attendance Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Ionicons name="clipboard-outline" size={20} color={themed($attendanceIconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:attendanceSection" />
        </View>

        {/* Enable Attendance Toggle */}
        <View style={themed($settingsRow)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:enableAttendance" />
          <Switch
            value={profileStore.attendanceEnabled}
            onValueChange={profileStore.setAttendanceEnabled}
            trackColor={{ false: "#E5E5E5", true: themeColor || theme.colors.tint }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Export Email */}
        <View style={themed($emailSection)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:exportEmail" />
          <View style={$emailRow}>
            <TextField
              value={profileStore.reportEmail}
              onChangeText={profileStore.setReportEmail}
              placeholder={translate("settingsScreen:exportEmailPlaceholder")}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              inputWrapperStyle={themed($emailInputWrapper)}
              containerStyle={$emailInputFlex}
            />
            {emailValid !== null && (
              <Ionicons
                name={emailValid ? "checkmark-circle" : "close-circle"}
                size={20}
                color={emailValid ? theme.colors.palette.secondary500 : theme.colors.error}
                style={$emailValidIcon}
              />
            )}
          </View>
        </View>

        {/* Export Button */}
        <TouchableOpacity
          style={[themed($settingsRow), themed($lastRow)]}
          onPress={() =>
            Alert.alert("Coming Soon", "Export functionality will be available in a future update.")
          }
          accessibilityRole="button"
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:exportAttendance" />
          <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
        </TouchableOpacity>
      </View>

      {/* Subscription Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Ionicons name="star" size={20} color="#FFD700" />
          <Text style={themed($sectionTitle)} tx="settingsScreen:subscriptionSection" />
        </View>

        {/* Subscription Status */}
        <View style={themed($settingsRow)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:subscription" />
          <View style={$styles.row}>
            {isSubscriptionLoading && (
              <ActivityIndicator
                size="small"
                color={theme.colors.tint}
                style={themed($activitySpinner)}
              />
            )}
            <Text style={[themed($rowValue), (isPremium || hasAttendance) && themed($premiumText)]}>
              {getSubscriptionStatus()}
            </Text>
          </View>
        </View>

        {authStore.isAnonymous ? (
          /* Anonymous user: show only Login to Subscribe button */
          <>
            <TouchableOpacity
              style={themed($upgradeButton)}
              onPress={() => logout()}
              accessibilityRole="button"
            >
              <Ionicons name="log-in" size={18} color={theme.colors.tint} />
              <Text style={themed($upgradeButtonText)} tx="settingsScreen:loginToSubscribe" />
            </TouchableOpacity>
            <Text
              style={[themed($subscriptionHint), themed($lastRow)]}
              tx="settingsScreen:loginToSubscribeHint"
            />
          </>
        ) : (
          <>
            {/* Expiration Date (show for any paid tier) */}
            {(isPremium || hasAttendance) && (
              <SettingsRow
                label={translate("settingsScreen:expires")}
                value={formatExpirationDate()}
              />
            )}

            {/* Upgrade Button (show for Free and Attendance users) */}
            {!isPremium && (
              <TouchableOpacity
                style={themed($upgradeButton)}
                onPress={handleUpgrade}
                accessibilityRole="button"
              >
                <Ionicons name="rocket" size={18} color={theme.colors.tint} />
                <Text style={themed($upgradeButtonText)} tx="settingsScreen:upgradeToPro" />
              </TouchableOpacity>
            )}

            {/* Manage Subscription (show for any paid tier) */}
            {(isPremium || hasAttendance) && (
              <TouchableOpacity
                style={themed($settingsRow)}
                onPress={handleManageSubscription}
                accessibilityRole="button"
              >
                <Text style={themed($rowLabel)} tx="settingsScreen:manageSubscription" />
                <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
              </TouchableOpacity>
            )}

            {/* Restore Purchases */}
            <TouchableOpacity
              style={[themed($settingsRow), themed($lastRow)]}
              onPress={handleRestorePurchases}
              accessibilityRole="button"
            >
              <Text style={themed($rowLabel)} tx="settingsScreen:restorePurchases" />
              <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Zoom Account Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Ionicons name="videocam" size={20} color="#2D8CFF" />
          <Text style={themed($sectionTitle)} tx="settingsScreen:zoomAccountSection" />
        </View>

        {zoomConnected ? (
          <>
            {/* Connected status */}
            <SettingsRow
              label={translate("settingsScreen:zoomConnected")}
              value={zoomAuth?.zoomEmail || zoomAuth?.zoomDisplayName || ""}
            />
            {/* Edit Zoom Profile */}
            <TouchableOpacity
              style={themed($settingsRow)}
              onPress={() => Linking.openURL("https://zoom.us/profile")}
              accessibilityRole="button"
            >
              <Text style={themed($rowLabel)} tx="settingsScreen:editZoomProfile" />
              <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
            </TouchableOpacity>
            {/* Disconnect button */}
            <TouchableOpacity
              style={[themed($settingsRow), themed($lastRow)]}
              onPress={() => {
                Alert.alert(
                  translate("settingsScreen:zoomDisconnect"),
                  translate("settingsScreen:zoomDisconnectConfirm"),
                  [
                    { text: translate("common:cancel"), style: "cancel" },
                    {
                      text: translate("settingsScreen:zoomDisconnect"),
                      style: "destructive",
                      onPress: async () => {
                        await disconnectZoom()
                        profileStore.setZoomConnected(false)
                      },
                    },
                  ],
                )
              }}
              accessibilityRole="button"
            >
              <Text style={themed($rowLabel)} tx="settingsScreen:zoomDisconnect" />
              <Icon icon="caretRight" size={16} color={themed($dangerColor).color} />
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={themed($zoomConnectButton)}
            onPress={() => navigation.navigate("ZoomLogin")}
            accessibilityRole="button"
          >
            <Ionicons name="videocam" size={18} color="#2D8CFF" />
            <Text style={themed($zoomConnectButtonText)} tx="settingsScreen:connectZoom" />
          </TouchableOpacity>
        )}
      </View>

      {/* Account Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Icon icon="lock" size={20} color={themed($accountIconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:accountSection" />
        </View>
        <SettingsRow
          label={translate("settingsScreen:userId")}
          value={
            authStore.isAnonymous
              ? translate("settingsScreen:anonymousUser")
              : authStore.authEmail || authStore.userId || translate("settingsScreen:notLoggedIn")
          }
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
          <Icon
            icon="back"
            size={18}
            color={themed($dangerColor).color}
            style={themed($logoutRowIcon)}
          />
          <Text style={themed($deleteText)} tx="settingsScreen:logout" />
          <Icon icon="caretRight" size={16} color={themed($dangerColor).color} />
        </TouchableOpacity>
      </View>

      {/* Legal Section */}
      <View style={themed($section)}>
        <View style={themed($sectionHeader)}>
          <Ionicons name="document-text-outline" size={20} color={themed($legalIconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:legalSection" />
        </View>

        <TouchableOpacity
          style={[themed($settingsRow), themed($lastRow)]}
          onPress={() => Linking.openURL("https://app.recoverysky.org/oss.html")}
          accessibilityRole="button"
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:thirdPartyLicenses" />
          <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
        </TouchableOpacity>
      </View>

      {/* Theme Color Picker Modal */}
      <ThemeColorPicker visible={colorPickerVisible} onClose={() => setColorPickerVisible(false)} />
    </Screen>
  )
})

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

// Styles - Clean flat design matching Live screen
const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.xxl,
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  marginTop: spacing.xs,
  marginBottom: spacing.lg,
})

const $section: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginBottom: spacing.lg,
})

const $sectionHeader: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  paddingVertical: spacing.sm,
  gap: spacing.xs,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
  marginBottom: spacing.xs,
})

const $sectionTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontWeight: "600",
  fontSize: 16,
  color: colors.text,
})

const $settingsRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: spacing.sm,
})

// Email section uses vertical layout for full-width input
const $emailSection: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingVertical: spacing.sm,
  gap: spacing.xs,
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

const $rowValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  fontWeight: "500",
  color: colors.tint,
})

const _$rowIcon: ThemedStyle<ImageStyle> = ({ spacing }) => ({
  marginRight: spacing.xs,
})

const $deleteRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
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

const $subscriptionHint: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 13,
  color: colors.textDim,
  textAlign: "center",
  marginTop: spacing.sm,
})

const $premiumText: ThemedStyle<TextStyle> = () => ({
  color: "#2196F3",
  fontWeight: "600",
})

const $activitySpinner: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginRight: spacing.xs,
})

const $upgradeButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#000",
  borderWidth: 1.5,
  borderColor: colors.tint,
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.lg,
  borderRadius: 10,
  marginTop: spacing.sm,
  marginBottom: spacing.sm,
  gap: spacing.xs,
  shadowColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $upgradeButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 16,
  fontWeight: "700",
})

const $colorPreviewSwatch: ViewStyle = {
  width: 24,
  height: 24,
  borderRadius: 12,
  marginRight: 4,
}

const _$colorPreview: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  width: 24,
  height: 24,
  borderRadius: 12,
  backgroundColor: "#2196F3",
  marginRight: spacing.xs,
})

const _$logoutButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.md,
  backgroundColor: "transparent",
  borderWidth: 0,
})

const _$logoutText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.error,
})

const _$logoutIcon: ThemedStyle<ImageStyle> = ({ spacing }) => ({
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

const $attendanceIconColor: ThemedStyle<{ color: string }> = () => ({
  color: "#FF9800",
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

// Zoom section styles
const $zoomConnectButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#000",
  borderWidth: 1.5,
  borderColor: "#2D8CFF",
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.lg,
  borderRadius: 10,
  marginTop: spacing.sm,
  marginBottom: spacing.sm,
  gap: spacing.xs,
  shadowColor: "#2D8CFF",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $zoomConnectButtonText: ThemedStyle<TextStyle> = () => ({
  fontSize: 16,
  color: "#2D8CFF",
  fontWeight: "700",
})

// Short Name Input
const $shortNameInput: ThemedStyle<ViewStyle> = () => ({
  flex: 0,
  minHeight: 0,
})

const $shortNameInputWrapper: ThemedStyle<ViewStyle> = ({ colors }) => ({
  minHeight: 36,
  paddingHorizontal: 12,
  backgroundColor: colors.card,
  borderColor: colors.border,
  borderRadius: 8,
})

// Email Input - full width
const $emailInputWrapper: ThemedStyle<ViewStyle> = ({ colors }) => ({
  minHeight: 40,
  paddingHorizontal: 12,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 8,
})

const $emailRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
}

const $emailInputFlex: ViewStyle = {
  flex: 1,
}

const $emailValidIcon: ViewStyle = {
  marginLeft: 8,
}

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
  borderRadius: 16,
  padding: spacing.lg,
  minWidth: 300,
  maxWidth: "85%",
  borderWidth: 1,
  borderColor: colors.border,
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
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.sm,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
})

const $modalOptionSelected: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.tint + "15",
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
const $datePickerContainer: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  marginTop: spacing.sm,
  borderRadius: 12,
  backgroundColor: colors.card,
  overflow: "hidden",
})

const $datePickerHeader: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  justifyContent: "flex-end",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.xs,
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

// Legal Section Icon Color
const $legalIconColor: ThemedStyle<{ color: string }> = ({ colors }) => ({
  color: colors.textDim,
})
