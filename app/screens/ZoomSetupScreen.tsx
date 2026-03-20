import { FC, useEffect, useState } from "react"
import {
  Alert,
  Image,
  ImageStyle,
  Modal,
  View,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
  Platform,
  Pressable,
} from "react-native"
import * as WebBrowser from "expo-web-browser"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { useZoomAuth } from "@/services/auth"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "ZoomSetupScreen" })

const ZOOM_SIGNUP_URL = "https://zoom.us/signup"
const zoomSignupImage = require("@assets/images/zoom-signup-example.png")

interface ZoomSetupScreenProps extends AppStackScreenProps<"ZoomSetup"> {}

/**
 * ZoomSetupScreen - Zoom account setup gate
 *
 * Prompts users to connect a Zoom account before proceeding.
 * Users may skip and connect later from Settings.
 */
export const ZoomSetupScreen: FC<ZoomSetupScreenProps> = observer(function ZoomSetupScreen(_props) {
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()
  const { connect, isConnected, isLoading, error, clearError } = useZoomAuth()
  const [showSignupModal, setShowSignupModal] = useState(false)

  useEffect(() => {
    log.info("ZoomSetupScreen mounted")
    return () => log.debug("ZoomSetupScreen unmounted")
  }, [])

  // When Zoom is connected, set the flag and let navigation auto-advance
  useEffect(() => {
    if (isConnected) {
      log.info("Zoom connected, setting zoomConnected flag")
      trackEvent("zoom_connected")
      profileStore.setZoomConnected(true)
    }
  }, [isConnected, profileStore])

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

  const handleCreateAccountPress = () => {
    log.info("Create Zoom Account button pressed")
    setShowSignupModal(true)
  }

  const handleSignupContinue = () => {
    setShowSignupModal(false)
    WebBrowser.openBrowserAsync(ZOOM_SIGNUP_URL)
  }

  const handleSkipPress = () => {
    log.info("Continue anonymously pressed, showing warning")
    Alert.alert(
      translate("zoomSetupScreen:anonymousWarningTitle"),
      translate("zoomSetupScreen:anonymousWarningMessage"),
      [
        { text: translate("common:cancel"), style: "cancel" },
        {
          text: translate("zoomSetupScreen:continueAnonymously"),
          style: "destructive",
          onPress: () => {
            log.info("Anonymous warning accepted, bypassing Zoom setup")
            profileStore.setZoomConnected(true)
          },
        },
      ],
    )
  }

  return (
    <Screen
      preset="fixed"
      contentContainerStyle={themed($screenContentContainer)}
      safeAreaEdges={["top", "bottom"]}
    >
      {/* Header */}
      <View style={themed($headerContainer)}>
        <Text
          testID="zoom-setup-heading"
          tx="zoomSetupScreen:title"
          preset="heading"
          style={themed($title)}
        />
        <Text tx="zoomSetupScreen:subtitle" preset="subheading" style={themed($subtitle)} />
      </View>

      {/* Content */}
      <View style={themed($contentContainer)}>
        {/* Error message */}
        {error && (
          <View style={themed($errorContainer)}>
            <Text style={themed($errorText)}>{error}</Text>
          </View>
        )}

        {/* Connect with Zoom button */}
        <Pressable
          testID="zoom-setup-connect-button"
          style={[themed($connectButton), isLoading && themed($buttonDisabled)]}
          onPress={handleConnectPress}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel={translate("zoomSetupScreen:connectWithZoom")}
        >
          <Ionicons name="videocam" size={24} color="#2D8CFF" style={themed($buttonIcon)} />
          <Text style={themed($connectButtonText)} tx="zoomSetupScreen:connectWithZoom" />
          {isLoading && <ActivityIndicator size="small" color="#2D8CFF" style={themed($spinner)} />}
        </Pressable>

        {/* Loading text */}
        {isLoading && <Text style={themed($loadingText)} tx="zoomSetupScreen:openingBrowser" />}

        {/* Create Account button (hidden on iOS per App Store guidelines) */}
        {Platform.OS !== "ios" && (
          <Pressable
            testID="zoom-setup-create-button"
            style={themed($createButton)}
            onPress={handleCreateAccountPress}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel={translate("zoomSetupScreen:createAccount")}
          >
            <Ionicons
              name="person-add-outline"
              size={20}
              color={theme.colors.tint}
              style={themed($buttonIcon)}
            />
            <Text
              style={[themed($createButtonText), { color: theme.colors.tint }]}
              tx="zoomSetupScreen:createAccount"
            />
          </Pressable>
        )}

        {/* Divider */}
        <View style={themed($dividerContainer)}>
          <View style={themed($dividerLine)} />
          <Text style={themed($dividerText)} tx="zoomSetupScreen:or" />
          <View style={themed($dividerLine)} />
        </View>

        {/* Skip button */}
        <Pressable
          testID="zoom-setup-skip-button"
          style={themed($skipButton)}
          onPress={handleSkipPress}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel={translate("zoomSetupScreen:continueAnonymously")}
        >
          <Text style={themed($skipButtonText)} tx="zoomSetupScreen:continueAnonymously" />
        </Pressable>
      </View>

      {/* Signup info modal */}
      <Modal
        visible={showSignupModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSignupModal(false)}
      >
        <View style={themed($modalContainer)}>
          {/* Modal Header */}
          <View style={themed($modalHeader)}>
            <Text style={themed($modalTitle)} tx="zoomSetupScreen:signupModalTitle" />
            <Pressable
              onPress={() => setShowSignupModal(false)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={translate("common:close")}
            >
              <Ionicons name="close" size={24} color={theme.colors.text} />
            </Pressable>
          </View>

          {/* Modal Content */}
          <View style={themed($modalContent)}>
            <Text style={themed($modalText)} tx="zoomSetupScreen:signupModalBody" />

            <Image source={zoomSignupImage} style={themed($signupImage)} resizeMode="contain" />

            <Text style={themed($modalText)} tx="zoomSetupScreen:signupModalNote" />

            <Text style={themed($modalText)} tx="zoomSetupScreen:signupModalNote2" />
          </View>

          {/* Modal Footer */}
          <View style={themed($modalFooter)}>
            <Pressable
              style={themed($modalCancelButton)}
              onPress={() => setShowSignupModal(false)}
              accessibilityRole="button"
              accessibilityLabel={translate("common:cancel")}
            >
              <Text style={themed($modalCancelText)} tx="common:cancel" />
            </Pressable>
            <Pressable
              style={themed($modalContinueButton)}
              onPress={handleSignupContinue}
              accessibilityRole="button"
              accessibilityLabel={translate("zoomSetupScreen:signupModalContinue")}
            >
              <Text style={themed($modalContinueText)} tx="zoomSetupScreen:signupModalContinue" />
            </Pressable>
          </View>
        </View>
      </Modal>
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
  alignItems: "center",
  paddingTop: spacing.xxl,
})

const $title: ThemedStyle<TextStyle> = ({ spacing }) => ({
  marginBottom: spacing.sm,
  textAlign: "center",
})

const $subtitle: ThemedStyle<TextStyle> = ({ spacing, colors }) => ({
  marginBottom: spacing.lg,
  textAlign: "center",
  color: colors.textDim,
  paddingHorizontal: spacing.md,
})

const $contentContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  justifyContent: "center",
  alignItems: "center",
  paddingBottom: spacing.xxl,
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

const $createButton: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.xl,
  borderRadius: 12,
  width: "100%",
  marginTop: spacing.lg,
  backgroundColor: colors.card,
})

const $createButtonText: ThemedStyle<TextStyle> = () => ({
  fontSize: 16,
  fontWeight: "600",
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

const $modalContainer: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  backgroundColor: colors.background,
  paddingTop: spacing.lg,
})

const $modalHeader: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: spacing.lg,
  paddingBottom: spacing.md,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
})

const $modalTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 20,
  fontWeight: "700",
  color: colors.text,
})

const $modalContent: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  padding: spacing.lg,
  alignItems: "center",
})

const $modalText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 15,
  lineHeight: 22,
  color: colors.text,
  textAlign: "center",
  marginBottom: spacing.lg,
})

const $signupImage: ThemedStyle<ImageStyle> = ({ spacing }) => ({
  width: 280,
  height: 140,
  marginBottom: spacing.lg,
})

const $modalFooter: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flexDirection: "row",
  gap: spacing.md,
  padding: spacing.lg,
  borderTopWidth: 1,
  borderTopColor: colors.border,
})

const $modalCancelButton: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.md,
  borderRadius: 12,
  backgroundColor: colors.card,
})

const $modalCancelText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.textDim,
})

const $modalContinueButton: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.md,
  borderRadius: 12,
  backgroundColor: colors.background,
  borderWidth: 1.5,
  borderColor: "#2D8CFF",
  shadowColor: "#2D8CFF",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $modalContinueText: ThemedStyle<TextStyle> = () => ({
  fontSize: 16,
  fontWeight: "600",
  color: "#2D8CFF",
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
