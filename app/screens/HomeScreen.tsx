import { FC, useCallback, useEffect, useState } from "react"
import { View, ViewStyle, TextStyle, Pressable, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation } from "@react-navigation/native"
import { observer } from "mobx-react-lite"

import { CleanTimeCard } from "@/components/CleanTimeCard"
import { HelpCard } from "@/components/HelpCard"
import { MoneySavedCard } from "@/components/MoneySavedCard"
import { NewsCard } from "@/components/NewsCard"
import { NinetyInNinetyCard } from "@/components/NinetyInNinetyCard"
import { RecoveryChartCard } from "@/components/RecoveryChartCard"
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
    id: "settings",
    icon: "settings-outline",
    titleTx: "homeScreen:settingsTitle",
    descriptionTx: "homeScreen:settingsDescription",
    actionTx: "homeScreen:goToSettings",
    actionTab: "Settings",
  },
  {
    id: "resources",
    icon: "book-outline",
    titleTx: "homeScreen:resourcesTitle",
    descriptionTx: "homeScreen:resourcesDescription",
    actionTx: "homeScreen:goToResources",
    actionUrl: "https://www.recoverysky.app/resources",
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
    id: "attendance",
    icon: "clipboard-outline",
    titleTx: "homeScreen:attendanceTitle",
    descriptionTx: "homeScreen:attendanceDescription",
    actionTx: "homeScreen:goToAttendance",
    actionTab: "Attendance",
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
  // The news card is non-dismissible: whenever the server returns a title and
  // body, we render it. Visibility gating (date windows, targeting, etc.) is
  // the server's responsibility via /news.
  const [newsTitle, setNewsTitle] = useState("")
  const [newsBody, setNewsBody] = useState("")

  useEffect(() => {
    let cancelled = false

    async function fetchNews() {
      const result = await api.getNews()
      if (cancelled) return

      if (result.kind === "ok" && result.title && result.body) {
        setNewsTitle(result.title)
        setNewsBody(result.body)
      } else {
        setNewsTitle("")
        setNewsBody("")
      }
    }

    fetchNews()
    return () => {
      cancelled = true
    }
  }, [])

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
      if (card.actionUrl) {
        Linking.openURL(card.actionUrl)
      } else if (card.actionTab) {
        navigation.navigate(card.actionTab, card.actionParams as never)
      }
    },
    [navigation],
  )

  const handleLogout = async () => {
    log.info("Logout button pressed")
    clearError()
    await logout()
  }

  return (
    <Screen
      preset="scroll"
      keyboardBottomOffset={100}
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

      {/* News announcement — always top box when visible, non-dismissible */}
      {newsBody !== "" && (
        <View style={themed($newsContainer)}>
          <NewsCard title={newsTitle} body={newsBody} />
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

      {/* Recovery Chart — gated on attendance enabled */}
      {profileStore.attendanceEnabled && <RecoveryChartCard />}

      {/* Money Saved */}
      <MoneySavedCard />

      {/* 90 in 90 Challenge Card — gated on attendance enabled */}
      {profileStore.attendanceEnabled && <NinetyInNinetyCard />}
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
