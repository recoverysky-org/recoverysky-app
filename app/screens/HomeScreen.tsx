import { FC, useCallback, useEffect } from "react"
import { View, ViewStyle, TextStyle, Pressable } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation } from "@react-navigation/native"
import { observer } from "mobx-react-lite"

import { HelpCard } from "@/components/HelpCard"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { TxKeyPath } from "@/i18n"
import { useAuthenticationStore, useProfileStore } from "@/models"
import { MainTabScreenProps, MeetingsSegment } from "@/navigators/navigationTypes"
import { useAuth0Wrapper } from "@/services/auth/useAuth0Wrapper"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "HomeScreen" })

// ============================================================================
// Help Card Definitions
// ============================================================================

interface HelpCardDef {
  id: string
  icon: keyof typeof Ionicons.glyphMap
  titleTx: TxKeyPath
  descriptionTx: TxKeyPath
  actionTx?: TxKeyPath
  actionTab?: "Meetings" | "Attendance" | "Settings"
  actionParams?: { segment?: MeetingsSegment }
}

const MAX_VISIBLE_CARDS = 5

const HELP_CARDS: HelpCardDef[] = [
  {
    id: "onboarding",
    icon: "school-outline",
    titleTx: "homeScreen:onboardingTitle",
    descriptionTx: "homeScreen:onboardingDescription",
    actionTx: "homeScreen:restartOnboarding",
  },
  {
    id: "live",
    icon: "radio-outline",
    titleTx: "homeScreen:liveTitle",
    descriptionTx: "homeScreen:liveDescription",
    actionTx: "homeScreen:goToLive",
    actionTab: "Meetings",
    actionParams: { segment: "live" },
  },
  {
    id: "listings",
    icon: "list-outline",
    titleTx: "homeScreen:listingsTitle",
    descriptionTx: "homeScreen:listingsDescription",
    actionTx: "homeScreen:goToListings",
    actionTab: "Meetings",
    actionParams: { segment: "listings" },
  },
  {
    id: "attendance",
    icon: "clipboard-outline",
    titleTx: "homeScreen:attendanceTitle",
    descriptionTx: "homeScreen:attendanceDescription",
    actionTx: "homeScreen:goToAttendance",
    actionTab: "Attendance",
  },
  {
    id: "settings",
    icon: "settings-outline",
    titleTx: "homeScreen:settingsTitle",
    descriptionTx: "homeScreen:settingsDescription",
    actionTx: "homeScreen:goToSettings",
    actionTab: "Settings",
  },
  {
    id: "favorites",
    icon: "heart-outline",
    titleTx: "homeScreen:favoritesTitle",
    descriptionTx: "homeScreen:favoritesDescription",
  },
  {
    id: "ratings",
    icon: "star-outline",
    titleTx: "homeScreen:ratingsTitle",
    descriptionTx: "homeScreen:ratingsDescription",
  },
]

/**
 * HomeScreen - Help cards + Dashboard
 *
 * Shows dismissible help cards for new users.
 * After all cards dismissed, shows dashboard with stats.
 */
export const HomeScreen: FC<MainTabScreenProps<"Home">> = observer(function HomeScreen(_props) {
  const { themed } = useAppTheme()
  const navigation = useNavigation<MainTabScreenProps<"Home">["navigation"]>()
  const authStore = useAuthenticationStore()
  const profileStore = useProfileStore()
  const { logout, clearError } = useAuth0Wrapper()

  // Log mount/unmount
  useEffect(() => {
    log.info("HomeScreen mounted", {
      isAuthenticated: authStore.isAuthenticated,
      isAnonymous: authStore.isAnonymous,
      cleanDays: profileStore.cleanDays,
      dismissedCards: profileStore.dismissedHomeCards.length,
    })
    return () => log.debug("HomeScreen unmounted")
  }, [])

  // Get undismissed cards (use slice() to get reactive array for dependency)
  // Show max 5 at a time - new cards appear as others are dismissed
  const dismissedIds = profileStore.dismissedHomeCards.slice()
  const visibleCards = HELP_CARDS.filter((card) => {
    // Don't show dismissed cards
    if (dismissedIds.includes(card.id)) return false
    // Don't show attendance card if attendance tracking is disabled
    if (card.id === "attendance" && !profileStore.attendanceEnabled) return false
    return true
  }).slice(0, MAX_VISIBLE_CARDS)

  const handleDismissCard = useCallback(
    (cardId: string) => {
      log.debug("Help card dismissed", { cardId })
      profileStore.dismissHomeCard(cardId)
    },
    [profileStore],
  )

  const handleCardAction = useCallback(
    (card: HelpCardDef) => {
      log.debug("Help card action pressed", { cardId: card.id, actionTab: card.actionTab })
      if (card.id === "onboarding") {
        // Reset onboarding and navigate to it
        profileStore.resetOnboarding()
      } else if (card.actionTab) {
        // Navigate to the tab with optional params
        // @ts-expect-error - Navigation params typing is complex with segment params
        navigation.navigate(card.actionTab, card.actionParams)
      }
    },
    [navigation, profileStore],
  )

  const handleLogout = async () => {
    log.info("Logout button pressed")
    clearError()
    await logout()
  }

  const showDashboard = visibleCards.length === 0

  return (
    <Screen
      preset="scroll"
      safeAreaEdges={["top"]}
      contentContainerStyle={[$styles.container, themed($container)]}
    >
      {/* Header */}
      <View style={$header}>
        <Text preset="heading" tx="homeScreen:title" />
        {authStore.isAuthenticated && !authStore.isAnonymous && (
          <Pressable onPress={handleLogout}>
            <Text style={themed($logoutLink)} tx="settingsScreen:logout" />
          </Pressable>
        )}
      </View>

      {/* Help Cards or Dashboard */}
      {showDashboard ? (
        <View style={themed($dashboardContainer)}>
          {/* Clean Days Hero */}
          <View style={themed($cleanDaysCard)}>
            <Text style={themed($cleanDaysNumber)}>{profileStore.cleanDays}</Text>
            <Text style={themed($cleanDaysLabel)} tx="homeScreen:cleanDays" />
          </View>

          {/* Placeholder for future dashboard widgets */}
          <Text style={themed($dashboardHint)}>Dashboard coming soon...</Text>
        </View>
      ) : (
        <View style={themed($cardsContainer)}>
          {visibleCards.map((card) => (
            <HelpCard
              key={card.id}
              icon={card.icon}
              titleTx={card.titleTx}
              descriptionTx={card.descriptionTx}
              actionTx={card.actionTx}
              onAction={() => handleCardAction(card)}
              onDismiss={() => handleDismissCard(card.id)}
            />
          ))}
        </View>
      )}
    </Screen>
  )
})

// ============================================================================
// Styles
// ============================================================================

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.xxl,
})

const $header: ViewStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
}

const $logoutLink: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 14,
  fontWeight: "500",
})

const $cardsContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.lg,
})

const $dashboardContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.lg,
  alignItems: "center",
})

const $cleanDaysCard: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.card,
  borderRadius: 20,
  paddingVertical: spacing.xl,
  paddingHorizontal: spacing.xxl,
  alignItems: "center",
  marginBottom: spacing.lg,
})

const $cleanDaysNumber: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 64,
  fontWeight: "700",
  color: colors.tint,
})

const $cleanDaysLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 18,
  fontWeight: "500",
  color: colors.textDim,
  marginTop: 4,
})

const $dashboardHint: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
  textAlign: "center",
})
