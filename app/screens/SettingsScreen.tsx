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
  ScrollView,
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
import { useToast } from "@/components/Toast"
import { useSubscription } from "@/context/SubscriptionContext"
import { reminderRepo, reminderEvents } from "@/db"
import { translate, getAvailableLanguages, getCurrentLanguage, languageNames } from "@/i18n"
import { useProfileStore, useAuthenticationStore, useConversationStore, useConfigStore } from "@/models"
import type { MainTabScreenProps } from "@/navigators/navigationTypes"
import { api } from "@/services/api"
import { useZoomAuth } from "@/services/auth"
import { clearAllSecureData } from "@/services/auth/secureStorage"
import { useAuth0Wrapper } from "@/services/auth/useAuth0Wrapper"
import { clearSqliteEncryptionKey } from "@/services/encryption/sqliteKey"
import {
  loginNotificationUser,
  logoutNotificationUser,
  optInNotifications,
  optOutNotifications,
  requestNotificationPermission,
} from "@/services/notifications"
import { logger } from "@/utils/logger"
import { checkForUpdates } from "@/utils/checkForUpdates"
import { requestReviewFromSettings } from "@/services/review"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"
import { clear as clearStorage, loadString, remove, saveString } from "@/utils/storage"

type Pronouns = "none" | "he/him" | "she/her" | "they/them" | "em/ers" | null

/** Fellowships available for user selection */
const SELECTABLE_FELLOWSHIPS = [Fellowship.AA, Fellowship.NA, Fellowship.RD] as const

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
  route,
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

  // Track where to return after subscription (e.g. "Attendance:new")
  const subscriptionReturnRef = useRef<string | null>(
    route.params?.returnTo ?? loadString("SUBSCRIPTION_RETURN"),
  )
  // Persist returnTo so it survives the login flow
  useEffect(() => {
    const returnTo = route.params?.returnTo
    if (returnTo) {
      saveString("SUBSCRIPTION_RETURN", returnTo)
      navigation.setParams({ returnTo: undefined })
    }
  }, [route.params?.returnTo, navigation])

  // Scroll-to-section support
  const scrollRef = useRef<ScrollView>(null)
  const sectionOffsets = useRef<Record<string, number>>({})

  // Scroll to section whenever route params change (works for both tab focus and direct navigate)
  useEffect(() => {
    const section = route.params?.section
    if (!section) return
    // Delay to ensure onLayout has captured offsets after mount/re-render
    const timer = setTimeout(() => {
      const y = sectionOffsets.current[section]
      if (y !== undefined) {
        // Subtract a small offset so the section header isn't flush with the top edge
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true })
      }
      // Clear the param so re-focusing the tab doesn't re-scroll
      navigation.setParams({ section: undefined })
    }, 400)
    return () => clearTimeout(timer)
  }, [navigation, route.params?.section])

  const trackSection = useCallback(
    (name: string) => (e: { nativeEvent: { layout: { y: number } } }) => {
      sectionOffsets.current[name] = e.nativeEvent.layout.y
    },
    [],
  )

  // MST Stores - reactive!
  const profileStore = useProfileStore()
  const authStore = useAuthenticationStore()
  const conversationStore = useConversationStore()
  const configStore = useConfigStore()

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
    logout: logoutSubscription,
  } = useSubscription()
  const { showToast } = useToast()

  // UI-only state (modals, pickers)
  const [pronounsModalVisible, setPronounsModalVisible] = useState(false)
  const [fellowshipModalVisible, setFellowshipModalVisible] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const endOfYear = useRef(new Date(new Date().getFullYear(), 11, 31)).current
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
    trackEvent("language_changed", { language: langCode })
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
    trackEvent("dark_mode_toggle", { enabled: value })
  }

  const handleNotificationsToggle = useCallback(
    async (value: boolean) => {
      profileStore.setNotificationsEnabled(value)
      trackEvent("notification_toggle", { enabled: value })
      if (value) {
        const granted = await requestNotificationPermission()
        if (!granted) {
          profileStore.setNotificationsEnabled(false)
          return
        }
        // Ensure push token is registered with backend (fetches token if needed)
        if (authStore.userIdentifier && authStore.deviceId) {
          loginNotificationUser(authStore.userIdentifier, authStore.deviceId).catch(() => {})
        }
        optInNotifications()
      } else {
        optOutNotifications()
      }
    },
    [profileStore, authStore],
  )

  const handleDeleteReminders = () => {
    Alert.alert(
      translate("settingsScreen:deleteAllReminders"),
      translate("settingsScreen:deleteAllRemindersConfirm"),
      [
        { text: translate("common:cancel"), style: "cancel" },
        {
          text: translate("common:ok"),
          style: "destructive",
          onPress: async () => {
            try {
              const uid = authStore.userId
              if (uid) {
                await Promise.all([reminderRepo.deleteByUserId(uid), api.deleteReminders(uid)])
                // Notify Live/Listings screens to refresh reminder indicators
                reminderEvents.emit({ type: "deleted", id: "*" })
              }
              trackEvent("reminders_deleted")
              Alert.alert(translate("settingsScreen:deleteAllRemindersSuccess"))
            } catch (err) {
              console.error("Failed to delete reminders", err)
            }
          },
        },
      ],
    )
  }

  const handleDeleteUserData = () => {
    Alert.alert(
      translate("settingsScreen:deleteUserData"),
      translate("settingsScreen:deleteUserDataConfirm"),
      [
        { text: translate("common:cancel"), style: "cancel" },
        {
          text: translate("common:ok"),
          style: "destructive",
          onPress: async () => {
            try {
              trackEvent("data_deleted")

              // 1. Disconnect Zoom (removes Zoom auth from SQLite)
              await disconnectZoom()
              profileStore.setZoomConnected(false)

              // 2. Logout from RevenueCat
              await logoutSubscription()

              // 3. Logout from push notifications
              optOutNotifications()
              logoutNotificationUser()

              // 4. Clear AI conversation history (SQLite)
              conversationStore.clearHistory()

              // 5. Reset ProfileStore (volatile + props, persists to SQLite)
              profileStore.reset()

              // 6. Clear MMKV storage (all persisted snapshots)
              clearStorage()

              // 7. Clear all secure store data (auth credentials, terms, SQLite key)
              await Promise.all([clearAllSecureData(), clearSqliteEncryptionKey()])

              // 8. Logout from Auth0 (clear session + MST auth state)
              await logout()
            } catch {
              // Even if some steps fail, ensure auth is cleared
              authStore.logout()
            }
          },
        },
      ],
    )
  }

  const handleLogout = () => {
    Alert.alert(translate("settingsScreen:logout"), translate("settingsScreen:logoutConfirm"), [
      { text: translate("common:cancel"), style: "cancel" },
      {
        text: translate("common:ok"),
        onPress: async () => {
          trackEvent("logout")
          await disconnectZoom()
          profileStore.setZoomConnected(false)
          await logout()
        },
      },
    ])
  }

  const navigateReturn = useCallback(() => {
    const returnTo = subscriptionReturnRef.current
    if (!returnTo) return
    subscriptionReturnRef.current = null
    remove("SUBSCRIPTION_RETURN")
    const parts = returnTo.split(":")
    const screen = parts[0]
    if (screen === "Meetings" && parts[1] === "meetingId" && parts[2]) {
      navigation.navigate("Meetings" as any, { segment: "live", meetingId: parts[2] })
    } else {
      const section = parts[1]
      navigation.navigate(screen as any, section ? { section } : undefined)
    }
  }, [navigation])

  const handleUpgrade = async () => {
    trackEvent("upgrade_tapped")
    const purchased = await showPaywall()
    if (purchased) {
      trackEvent("upgrade_purchased")
      if (subscriptionReturnRef.current) {
        navigateReturn()
      } else {
        Alert.alert(
          translate("settingsScreen:subscriptionSuccess"),
          translate("settingsScreen:subscriptionSuccessMessage"),
        )
      }
    }
  }

  const handleRestorePurchases = async () => {
    trackEvent("restore_purchases_tapped")
    const restored = await restore()
    if (restored) {
      showToast({ tx: "subscription:restoreSuccess", type: "success" })
    } else {
      showToast({ tx: "subscription:restoreFailed", type: "error" })
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
    if (!subscriptionInfo?.expirationDate) return translate("settingsScreen:expiresNone")
    return subscriptionInfo.expirationDate.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  // Get subscription status text
  const getSubscriptionStatus = (): string => {
    if (isSubscriptionLoading) return translate("settingsScreen:subscriptionLoading")
    if (isPremium) {
      if (subscriptionInfo?.isInTrial) return translate("settingsScreen:subscriptionPremiumTrial")
      return translate("settingsScreen:subscriptionPremium")
    }
    if (hasAttendance) {
      return translate("settingsScreen:subscriptionAttendance")
    }
    return translate("settingsScreen:subscriptionFree")
  }

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)

  const handleCheckForUpdates = async () => {
    if (__DEV__) {
      Alert.alert(translate("settingsScreen:noUpdatesAvailable"), translate("settingsScreen:noUpdatesMessage"))
      return
    }
    setIsCheckingUpdate(true)
    try {
      const found = await checkForUpdates(configStore.latestVersion)
      if (!found) {
        Alert.alert(translate("settingsScreen:noUpdatesAvailable"), translate("settingsScreen:noUpdatesMessage"))
      }
    } catch (e) {
      logger.warn("Manual update check failed", { error: String(e) })
      Alert.alert(translate("settingsScreen:noUpdatesAvailable"), translate("settingsScreen:noUpdatesMessage"))
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  const handleSendErrorReport = () => {
    Alert.prompt(
      translate("settingsScreen:errorReportTitle"),
      translate("settingsScreen:errorReportPrompt"),
      async (description) => {
        if (!description?.trim()) return
        const { sessionId } = logger.getContext()
        const result = await api.sendBugReport({
          deviceId: authStore.deviceId ?? "unknown",
          sessionId: sessionId ?? "unknown",
          description: description.trim(),
          email: "support@recoverysky.org",
        })
        if (result.kind === "ok") {
          Alert.alert(
            translate("settingsScreen:errorReportSuccess"),
            translate("settingsScreen:errorReportSuccessMessage"),
          )
        } else {
          Alert.alert(
            translate("settingsScreen:errorReportFailed"),
            translate("settingsScreen:errorReportFailedMessage"),
          )
        }
      },
      "plain-text",
    )
  }

  return (
    <Screen
      preset="scroll"
      safeAreaEdges={["top"]}
      scrollViewRef={scrollRef}
      contentContainerStyle={[$styles.container, themed($container)]}
    >
      {/* Header */}
      <Text preset="heading" tx="settingsScreen:title" />
      <Text style={themed($subtitle)} tx="settingsScreen:subtitle" />

      {/* Recovery Section */}
      <View style={themed($section)} onLayout={trackSection("recovery")}>
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
          accessibilityLabel={translate("settingsScreen:recoveryDate")}
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
                <TouchableOpacity
                  onPress={() => setShowDatePicker(false)}
                  accessibilityRole="button"
                  accessibilityLabel={translate("common:ok")}
                >
                  <Text style={themed($datePickerDone)} tx="common:ok" />
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={profileStore.recoveryDateAsDate}
                mode="date"
                display="spinner"
                onChange={handleDateChange}
                maximumDate={endOfYear}
                style={$datePickerSpinner}
                themeVariant={isDarkMode ? "dark" : "light"}
              />
            </View>
          ) : (
            <DateTimePicker
              value={profileStore.recoveryDateAsDate}
              mode="date"
              display="spinner"
              onChange={handleDateChange}
              maximumDate={endOfYear}
              themeVariant={isDarkMode ? "dark" : "light"}
            />
          ))}

        <TouchableOpacity
          style={[themed($settingsRow), themed($lastRow)]}
          onPress={() => setFellowshipModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:recoveryFellowship")}
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:recoveryFellowship" />
          <View style={$styles.row}>
            <Text style={themed($rowValue)}>{getFellowshipLabel(profileStore.fellowship)}</Text>
            <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Profile Section */}
      <View style={themed($section)} onLayout={trackSection("profile")}>
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
            accessibilityLabel={translate("settingsScreen:showCleanDate")}
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
            accessibilityLabel={translate("settingsScreen:showCleanDays")}
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
                accessibilityRole="button"
                accessibilityLabel={getPronounsLabel(profileStore.pronouns)}
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
              accessibilityLabel={translate("settingsScreen:showPronouns")}
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
        <Pressable
          style={themed($modalOverlay)}
          onPress={() => setPronounsModalVisible(false)}
          accessibilityLabel={translate("common:close")}
        >
          <View style={themed($modalContent)} accessibilityViewIsModal>
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
                  trackEvent("pronouns_changed", { pronouns: p || "none" })
                  setPronounsModalVisible(false)
                }}
                accessibilityRole="radio"
                accessibilityLabel={getPronounsLabel(p)}
                accessibilityState={{ selected: profileStore.pronouns === p }}
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
        <Pressable
          style={themed($modalOverlay)}
          onPress={() => setFellowshipModalVisible(false)}
          accessibilityLabel={translate("common:close")}
        >
          <View style={themed($modalContent)} accessibilityViewIsModal>
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
                  trackEvent("fellowship_changed", { fellowship: f })
                  setFellowshipModalVisible(false)
                }}
                accessibilityRole="radio"
                accessibilityLabel={getFellowshipLabel(f)}
                accessibilityState={{ selected: profileStore.fellowship === f }}
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
                style={[themed($modalOption), currentLang === lang && themed($modalOptionSelected)]}
                onPress={() => handleLanguageChange(lang)}
                accessibilityRole="radio"
                accessibilityLabel={languageNames[lang]}
                accessibilityState={{ selected: currentLang === lang }}
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
            <Text style={themed($translationHint)} tx="settingsScreen:translationHint" />
          </View>
        </Pressable>
      </Modal>

      {/* App Settings Section */}
      <View style={themed($section)} onLayout={trackSection("appSettings")}>
        <View style={themed($sectionHeader)}>
          <Icon icon="settings" size={20} color={themed($appSettingsIconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:appSettingsSection" />
        </View>

        {/* Language Picker */}
        <TouchableOpacity
          style={themed($settingsRow)}
          onPress={() => setLanguageModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:language")}
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
            accessibilityLabel={translate("settingsScreen:darkMode")}
          />
        </View>

        {/* Theme Color */}
        <TouchableOpacity
          style={themed($settingsRow)}
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:themeColor")}
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
          accessibilityLabel={translate("settingsScreen:resetHomeTips")}
          onPress={() => profileStore.resetHomeCards()}
        >
          <View>
            <Text style={themed($rowLabel)} tx="settingsScreen:resetHomeTips" />
            <Text style={themed($rowHint)} tx="settingsScreen:resetHomeTipsHint" />
          </View>
          <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
        </TouchableOpacity>
      </View>

      {/* Notifications Section */}
      <View style={themed($section)} onLayout={trackSection("notifications")}>
        <View style={themed($sectionHeader)}>
          <Ionicons
            name="notifications-outline"
            size={20}
            color={themed($notificationsIconColor).color}
          />
          <Text style={themed($sectionTitle)} tx="settingsScreen:notificationsSection" />
        </View>

        <View style={themed($settingsRow)}>
          <View style={$styles.flex1}>
            <Text style={themed($rowLabel)} tx="settingsScreen:enableNotifications" />
            <Text style={themed($rowHint)} tx="settingsScreen:notificationsHint" />
          </View>
          <Switch
            value={profileStore.notificationsEnabled}
            onValueChange={handleNotificationsToggle}
            trackColor={{ false: "#E5E5E5", true: themeColor || theme.colors.tint }}
            thumbColor="#FFFFFF"
            accessibilityLabel={translate("settingsScreen:enableNotifications")}
          />
        </View>
      </View>

      {/* Attendance Section */}
      <View style={themed($section)} onLayout={trackSection("attendance")}>
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
            accessibilityLabel={translate("settingsScreen:enableAttendance")}
          />
        </View>

        {/* Enable Meeting Topic Toggle */}
        <View style={themed($settingsRow)}>
          <Text style={themed($rowLabel)} tx="settingsScreen:enableMeetingTopic" />
          <Switch
            value={profileStore.enableMeetingTopic}
            onValueChange={profileStore.setEnableMeetingTopic}
            trackColor={{ false: "#E5E5E5", true: themeColor || theme.colors.tint }}
            thumbColor="#FFFFFF"
            accessibilityLabel={translate("settingsScreen:enableMeetingTopic")}
          />
        </View>

        {/* ID Number */}
        <View style={[themed($emailSection), themed($lastRow)]}>
          <Text style={themed($rowLabel)} tx="settingsScreen:userIdNum" />
          <TextField
            value={profileStore.userIdNum}
            onChangeText={profileStore.setUserIdNum}
            placeholder={translate("settingsScreen:userIdNumPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            inputWrapperStyle={themed($emailInputWrapper)}
            containerStyle={$emailInputFlex}
          />
        </View>

        {/* TODO: Export Email */}
        {/* TODO: Export Button */}
      </View>

      {/* Subscription Section */}
      <View style={themed($section)} onLayout={trackSection("subscription")}>
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
              onPress={() => {
                saveString("POST_LOGIN_SECTION", "subscription")
                logout()
              }}
              accessibilityRole="button"
              accessibilityLabel={translate("settingsScreen:loginToSubscribe")}
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
                accessibilityLabel={translate("settingsScreen:upgradeToPro")}
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
                accessibilityLabel={translate("settingsScreen:manageSubscription")}
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
              accessibilityLabel={translate("settingsScreen:restorePurchases")}
            >
              <Text style={themed($rowLabel)} tx="settingsScreen:restorePurchases" />
              <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Zoom Account Section */}
      <View style={themed($section)} onLayout={trackSection("zoom")}>
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
              accessibilityLabel={translate("settingsScreen:editZoomProfile")}
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
                        trackEvent("zoom_disconnected")
                        await disconnectZoom()
                        profileStore.setZoomConnected(false)
                      },
                    },
                  ],
                )
              }}
              accessibilityRole="button"
              accessibilityLabel={translate("settingsScreen:zoomDisconnect")}
            >
              <Text style={themed($rowLabel)} tx="settingsScreen:zoomDisconnect" />
              <Icon icon="caretRight" size={16} color={themed($dangerColor).color} />
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={themed($zoomConnectButton)}
            onPress={() => {
            trackEvent("zoom_reconnect_tapped")
            navigation.navigate("ZoomLogin")
          }}
            accessibilityRole="button"
            accessibilityLabel={translate("settingsScreen:connectZoom")}
          >
            <Ionicons name="videocam" size={18} color="#2D8CFF" />
            <Text style={themed($zoomConnectButtonText)} tx="settingsScreen:connectZoom" />
          </TouchableOpacity>
        )}
      </View>

      {/* Account Section */}
      <View style={themed($section)} onLayout={trackSection("account")}>
        <View style={themed($sectionHeader)}>
          <Ionicons
            name="person-circle-outline"
            size={20}
            color={themed($accountIconColor).color}
          />
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
          onPress={handleDeleteReminders}
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:deleteAllReminders")}
        >
          <Icon icon="x" size={18} color={themed($dangerColor).color} />
          <Text style={themed($deleteText)} tx="settingsScreen:deleteAllReminders" />
          <Icon icon="caretRight" size={16} color={themed($dangerColor).color} />
        </TouchableOpacity>
        <TouchableOpacity
          style={themed($deleteRow)}
          onPress={handleDeleteUserData}
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:deleteUserData")}
        >
          <Icon icon="x" size={18} color={themed($dangerColor).color} />
          <Text style={themed($deleteText)} tx="settingsScreen:deleteUserData" />
          <Icon icon="caretRight" size={16} color={themed($dangerColor).color} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[themed($deleteRow), themed($lastRow)]}
          onPress={handleLogout}
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:logout")}
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

      {/* Import Section */}
      <View style={themed($section)} onLayout={trackSection("import")}>
        <View style={themed($sectionHeader)}>
          <Ionicons
            name="cloud-download-outline"
            size={20}
            color={themed($importIconColor).color}
          />
          <Text style={themed($sectionTitle)} tx="settingsScreen:importSection" />
        </View>

        <TouchableOpacity
          style={[
            themed($settingsRow),
            themed($lastRow),
            configStore.maintenanceMode && { opacity: 0.4 },
          ]}
          onPress={() => navigation.navigate("Import")}
          disabled={configStore.maintenanceMode}
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:restartImport")}
          accessibilityState={{ disabled: configStore.maintenanceMode }}
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:restartImport" />
          <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
        </TouchableOpacity>
      </View>

      {/* Advanced Section */}
      <View style={themed($section)} onLayout={trackSection("advanced")}>
        <View style={themed($sectionHeader)}>
          <Ionicons name="settings-outline" size={20} color={themed($advancedIconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:advancedSection" />
        </View>

        <View style={themed($settingsRow)}>
          <View style={$styles.flex1}>
            <Text style={themed($rowLabel)} tx="settingsScreen:useExternalZoom" />
            <Text style={themed($rowHint)} tx="settingsScreen:useExternalZoomHint" />
          </View>
          <Switch
            value={true}
            disabled
            trackColor={{ false: "#E5E5E5", true: themeColor || theme.colors.tint }}
            thumbColor="#FFFFFF"
            accessibilityLabel={translate("settingsScreen:useExternalZoom")}
          />
        </View>
      </View>

      {/* Legal Section */}
      <View style={themed($section)} onLayout={trackSection("legal")}>
        <TouchableOpacity
          style={themed($upgradeButton)}
          onPress={() => {
            trackEvent("rate_app_tapped")
            requestReviewFromSettings()
          }}
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:rateApp")}
        >
          <Ionicons name="star" size={18} color={theme.colors.tint} />
          <Text style={themed($upgradeButtonText)} tx="settingsScreen:rateApp" />
        </TouchableOpacity>

        <TouchableOpacity
          style={themed($upgradeButton)}
          onPress={() => {
            trackEvent("support_tapped")
            Linking.openURL("https://www.recoverysky.org/support")
          }}
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:support")}
        >
          <Ionicons name="help-circle-outline" size={18} color={theme.colors.tint} />
          <Text style={themed($upgradeButtonText)} tx="settingsScreen:support" />
        </TouchableOpacity>

        <TouchableOpacity
          style={themed($upgradeButton)}
          onPress={handleCheckForUpdates}
          disabled={isCheckingUpdate}
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:checkForUpdates")}
        >
          {isCheckingUpdate ? (
            <ActivityIndicator size={18} color={theme.colors.tint} />
          ) : (
            <Ionicons name="cloud-download-outline" size={18} color={theme.colors.tint} />
          )}
          <Text style={themed($upgradeButtonText)}>
            {translate(isCheckingUpdate ? "settingsScreen:checkingForUpdates" : "settingsScreen:checkForUpdates")}
          </Text>
        </TouchableOpacity>

        <View style={themed($sectionHeader)}>
          <Ionicons name="document-text-outline" size={20} color={themed($legalIconColor).color} />
          <Text style={themed($sectionTitle)} tx="settingsScreen:legalSection" />
        </View>

        <TouchableOpacity
          style={themed($settingsRow)}
          onPress={() =>
            Linking.openURL("https://www.recoverysky.app/content/RecoverySky_Content/EULA")
          }
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:eula")}
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:eula" />
          <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
        </TouchableOpacity>

        <TouchableOpacity
          style={themed($settingsRow)}
          onPress={() =>
            Linking.openURL("https://www.recoverysky.app/content/RecoverySky_Content/terms")
          }
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:termsAndConditions")}
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:termsAndConditions" />
          <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
        </TouchableOpacity>

        <TouchableOpacity
          style={themed($settingsRow)}
          onPress={() =>
            Linking.openURL("https://www.recoverysky.app/content/RecoverySky_Content/privacy")
          }
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:privacyPolicy")}
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:privacyPolicy" />
          <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
        </TouchableOpacity>

        <TouchableOpacity
          style={themed($settingsRow)}
          onPress={() =>
            Linking.openURL("https://www.recoverysky.app/content/RecoverySky_Content/disclaimer")
          }
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:disclaimer")}
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:disclaimer" />
          <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
        </TouchableOpacity>

        <TouchableOpacity
          style={themed($settingsRow)}
          onPress={() =>
            Linking.openURL("https://www.recoverysky.app/content/RecoverySky_Content/AI_Consent")
          }
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:aiConsent")}
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:aiConsent" />
          <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[themed($settingsRow), themed($lastRow)]}
          onPress={() => navigation.navigate("Licenses")}
          accessibilityRole="button"
          accessibilityLabel={translate("settingsScreen:thirdPartyLicenses")}
        >
          <Text style={themed($rowLabel)} tx="settingsScreen:thirdPartyLicenses" />
          <Icon icon="caretRight" size={16} color={themed($dimColor).color} />
        </TouchableOpacity>
      </View>

      {/* Version */}
      <Text style={themed($versionText)}>v{require("../../package.json").version}-{require("../../package.json").update ?? "0"}</Text>

      {/* Buy Me A Coffee — supports the developer */}
      <TouchableOpacity
        style={themed($coffeeButton)}
        onPress={() => {
          trackEvent("coffee_tapped")
          Linking.openURL("https://buymeacoffee.com/jenovamarie")
        }}
        accessibilityRole="link"
        accessibilityLabel={translate("settingsScreen:buyMeACoffee")}
      >
        <Ionicons name="cafe" size={16} color={theme.colors.tint} />
        <Text style={themed($coffeeButtonText)} tx="settingsScreen:buyMeACoffee" />
      </TouchableOpacity>

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

const $logoutRowIcon: ThemedStyle<ImageStyle> = () => ({
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

const $notificationsIconColor: ThemedStyle<{ color: string }> = () => ({
  color: "#E91E63",
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

const $versionText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  textAlign: "center",
  color: colors.textDim,
  fontSize: 13,
  paddingTop: spacing.lg,
  paddingBottom: spacing.sm,
})

const $coffeeButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: spacing.xs,
  paddingVertical: spacing.sm,
  paddingBottom: spacing.lg,
})

const $coffeeButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 14,
  fontWeight: "500",
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

const $translationHint: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 12,
  color: colors.textDim,
  textAlign: "center",
  marginTop: spacing.md,
  fontStyle: "italic",
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

// Import Section Icon Color
const $importIconColor: ThemedStyle<{ color: string }> = () => ({
  color: "#00BCD4",
})

// Advanced Section Icon Color
const $advancedIconColor: ThemedStyle<{ color: string }> = ({ colors }) => ({
  color: colors.textDim,
})

// Legal Section Icon Color
const $legalIconColor: ThemedStyle<{ color: string }> = ({ colors }) => ({
  color: colors.textDim,
})
