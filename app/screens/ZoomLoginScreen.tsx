import { FC, useEffect } from "react"
import { View, ViewStyle, TextStyle, ActivityIndicator, Pressable } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { useZoomAuth } from "@/services/auth"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "ZoomLoginScreen" })

interface ZoomLoginScreenProps extends AppStackScreenProps<"ZoomLogin"> {}

/**
 * ZoomLoginScreen - Connect Zoom account for authenticated meeting join
 *
 * Provides two options:
 * 1. Login with Zoom Account - OAuth flow to connect Zoom
 * 2. Continue Anonymously - Skip Zoom connection
 */
export const ZoomLoginScreen: FC<ZoomLoginScreenProps> = observer(function ZoomLoginScreen({
  navigation,
}) {
  const { themed, theme } = useAppTheme()
  const { connect, isConnected, isLoading, error, clearError } = useZoomAuth()

  useEffect(() => {
    log.info("ZoomLoginScreen mounted")
    return () => log.debug("ZoomLoginScreen unmounted")
  }, [])

  // Navigate back when connected
  useEffect(() => {
    if (isConnected) {
      log.info("Zoom connected, navigating back")
      navigation.goBack()
    }
  }, [isConnected, navigation])

  // Log errors when they occur
  useEffect(() => {
    if (error) {
      log.warn("Zoom auth error displayed", { error })
    }
  }, [error])

  const handleConnectPress = async () => {
    log.info("Connect Zoom button pressed")
    clearError()
    await connect()
  }

  const handleSkipPress = () => {
    log.info("Continue anonymously pressed")
    navigation.goBack()
  }

  return (
    <Screen
      preset="fixed"
      contentContainerStyle={themed($screenContentContainer)}
      safeAreaEdges={["top", "bottom"]}
    >
      {/* Close button */}
      <View style={themed($headerContainer)}>
        <Pressable onPress={handleSkipPress} hitSlop={12} style={themed($closeButton)}>
          <Ionicons name="close" size={28} color={theme.colors.text} />
        </Pressable>
      </View>

      {/* Content */}
      <View style={themed($contentContainer)}>
        {/* Zoom Icon */}
        <View style={themed($logoContainer)}>
          <View style={themed($logoCircle)}>
            <Ionicons name="videocam" size={48} color="#2D8CFF" />
          </View>
        </View>

        {/* Title and description */}
        <Text tx="zoomLoginScreen:title" preset="heading" style={themed($title)} />
        <Text tx="zoomLoginScreen:subtitle" preset="subheading" style={themed($subtitle)} />

        {/* Error message */}
        {error && (
          <View style={themed($errorContainer)}>
            <Text style={themed($errorText)}>{error}</Text>
          </View>
        )}

        {/* Connect with Zoom button */}
        <Pressable
          testID="zoom-connect-button"
          style={[themed($connectButton), isLoading && themed($buttonDisabled)]}
          onPress={handleConnectPress}
          disabled={isLoading}
        >
          <Ionicons name="videocam" size={24} color="#2D8CFF" style={themed($buttonIcon)} />
          <Text style={themed($connectButtonText)} tx="zoomLoginScreen:connectWithZoom" />
          {isLoading && <ActivityIndicator size="small" color="#2D8CFF" style={themed($spinner)} />}
        </Pressable>

        {/* Loading text */}
        {isLoading && <Text style={themed($loadingText)} tx="zoomLoginScreen:openingBrowser" />}

        {/* Divider */}
        <View style={themed($dividerContainer)}>
          <View style={themed($dividerLine)} />
          <Text style={themed($dividerText)} tx="zoomLoginScreen:or" />
          <View style={themed($dividerLine)} />
        </View>

        {/* Skip button */}
        <Pressable
          testID="zoom-skip-button"
          style={themed($skipButton)}
          onPress={handleSkipPress}
          disabled={isLoading}
        >
          <Text style={themed($skipButtonText)} tx="zoomLoginScreen:continueAnonymously" />
        </Pressable>

        {/* Info text */}
        <Text style={themed($infoText)} tx="zoomLoginScreen:infoText" />
      </View>
    </Screen>
  )
})

// ============================================================================
// Styles
// ============================================================================

const $screenContentContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingHorizontal: spacing.lg,
})

const $headerContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "flex-end",
  paddingVertical: spacing.md,
})

const $closeButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  padding: spacing.xs,
})

const $contentContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  justifyContent: "center",
  alignItems: "center",
  paddingBottom: spacing.xxl,
})

const $logoContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginBottom: spacing.xl,
})

const $logoCircle: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 100,
  height: 100,
  borderRadius: 50,
  backgroundColor: colors.card,
  alignItems: "center",
  justifyContent: "center",
  borderWidth: 2,
  borderColor: "#2D8CFF",
})

const $title: ThemedStyle<TextStyle> = ({ spacing }) => ({
  marginBottom: spacing.sm,
  textAlign: "center",
})

const $subtitle: ThemedStyle<TextStyle> = ({ spacing, colors }) => ({
  marginBottom: spacing.xl,
  textAlign: "center",
  color: colors.textDim,
  paddingHorizontal: spacing.lg,
})

const $errorContainer: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  padding: spacing.md,
  backgroundColor: colors.errorBackground,
  borderRadius: 8,
  marginBottom: spacing.md,
  width: "100%",
})

const $errorText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.error,
  textAlign: "center",
})

const $connectButton: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.background,
  borderWidth: 2,
  borderColor: "#2D8CFF",
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.xl,
  borderRadius: 12,
  width: "100%",
  shadowColor: "#2D8CFF",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.4,
  shadowRadius: 8,
  elevation: 8,
})

const $buttonDisabled: ThemedStyle<ViewStyle> = () => ({
  opacity: 0.7,
})

const $buttonIcon: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginRight: spacing.sm,
})

const $connectButtonText: ThemedStyle<TextStyle> = () => ({
  fontSize: 18,
  fontWeight: "600",
  color: "#2D8CFF",
})

const $spinner: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginLeft: spacing.sm,
})

const $loadingText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  textAlign: "center",
  fontSize: 14,
  marginTop: spacing.md,
})

const $dividerContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  width: "100%",
  marginVertical: spacing.xl,
})

const $dividerLine: ThemedStyle<ViewStyle> = ({ colors }) => ({
  flex: 1,
  height: 1,
  backgroundColor: colors.border,
})

const $dividerText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  marginHorizontal: spacing.md,
  fontSize: 14,
})

const $skipButton: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.xl,
  borderRadius: 12,
  width: "100%",
  backgroundColor: colors.card,
})

const $skipButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.textDim,
})

const $infoText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  textAlign: "center",
  fontSize: 12,
  marginTop: spacing.xl,
  paddingHorizontal: spacing.lg,
  lineHeight: 18,
})
