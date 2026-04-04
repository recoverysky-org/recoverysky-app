import { FC, useCallback, useEffect, useState } from "react"
import { View, ViewStyle, TextStyle, Pressable, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation } from "@react-navigation/native"
import { observer } from "mobx-react-lite"

import { CleanTimeCard } from "@/components/CleanTimeCard"
import { HelpCard } from "@/components/HelpCard"
import { NewsCard } from "@/components/NewsCard"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { translate, type TxKeyPath } from "@/i18n"
import { useAuthenticationStore, useProfileStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { api } from "@/services/api"
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
  actionParams?: Record<string, string>
  actionUrl?: string
}

const HELP_CARDS: HelpCardDef[] = [
  {
    id: "onboarding",
    icon: "school-outline",
    titleTx: "homeScreen:onboardingTitle",
    descriptionTx: "homeScreen:onboardingDescription",
    actionTx: "homeScreen:restartOnboarding",
  },
  {
    id: "navigation",
    icon: "apps-outline",
    titleTx: "homeScreen:navigationTitle",
    descriptionTx: "homeScreen:navigationDescription",
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
    id: "support",
    icon: "help-circle-outline",
    titleTx: "homeScreen:supportTitle",
    descriptionTx: "homeScreen:supportDescription",
    actionTx: "homeScreen:goToSupport",
    actionUrl: "https://www.recoverysky.org/support",
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
  {
    id: "rate-app",
    icon: "star",
    titleTx: "homeScreen:rateAppTitle",
    descriptionTx: "homeScreen:rateAppDescription",
    actionTx: "homeScreen:rateApp",
    actionTab: "Settings",
    actionParams: { section: "legal" },
  },
]

/**
 * HomeScreen - Dashboard with clean time counter and getting started cards
 *
 * Shows all help cards at once as a "Getting Started" section.
 * Clean time counter sits below, floating up as cards are dismissed.
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

  // === News card state ===
  const [newsContent, setNewsContent] = useState("")

  useEffect(() => {
    let cancelled = false

    async function fetchNews() {
      const result = await api.getNews()
      if (cancelled) return

      if (result.kind === "ok" && result.news) {
        // First-launch guard: silently acknowledge without showing
        if (profileStore.dismissedNews === "") {
          profileStore.acknowledgeNewsFirstLaunch(result.news)
          return
        }

        // Only show if news differs from what was previously dismissed
        if (result.news !== profileStore.dismissedNews) {
          setNewsContent(result.news)
        }
      }
    }

    fetchNews()
    return () => {
      cancelled = true
    }
  }, [profileStore, profileStore.dismissedNews])

  const handleDismissNews = useCallback(() => {
    log.debug("News card dismissed")
    profileStore.dismissNews(newsContent)
    setNewsContent("")
  }, [profileStore, newsContent])

  // Show all undismissed cards at once
  const dismissedIds = profileStore.dismissedHomeCards.slice()
  const visibleCards = HELP_CARDS.filter((card) => {
    if (dismissedIds.includes(card.id)) return false
    if (card.id === "attendance" && !profileStore.attendanceEnabled) return false
    return true
  })

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
      } else if (card.actionUrl) {
        Linking.openURL(card.actionUrl)
      } else if (card.actionTab) {
        navigation.navigate(card.actionTab, card.actionParams as never)
      }
    },
    [navigation, profileStore],
  )

  const handleLogout = async () => {
    log.info("Logout button pressed")
    clearError()
    await logout()
  }

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
          <Pressable
            onPress={handleLogout}
            accessibilityRole="button"
            accessibilityLabel={translate("settingsScreen:logout")}
          >
            <Text style={themed($logoutLink)} tx="settingsScreen:logout" />
          </Pressable>
        )}
      </View>

      {/* News announcement — always top box when visible */}
      {newsContent !== "" && (
        <View style={themed($newsContainer)}>
          <NewsCard content={newsContent} onDismiss={handleDismissNews} />
        </View>
      )}

      {/* Getting Started section */}
      {visibleCards.length > 0 && (
        <View style={themed($cardsContainer)}>
          <Text style={themed($sectionHeader)} tx="homeScreen:gettingStarted" />
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

      {/* Clean Time Card — below cards, floats up as cards are dismissed */}
      <CleanTimeCard />
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

const $sectionHeader: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 15,
  fontWeight: "600",
  color: colors.textDim,
  textTransform: "uppercase",
  letterSpacing: 1,
  marginBottom: spacing.sm,
})

const $newsContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.lg,
})

const $cardsContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.lg,
})
