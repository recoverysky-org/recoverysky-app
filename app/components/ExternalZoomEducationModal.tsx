/**
 * ExternalZoomEducationModal
 *
 * One-time educational popup shown the first time a user taps Join with
 * "Use External Zoom" enabled. Explains that the Zoom app must be installed,
 * a timer will be started, and they must return to RecoverySky to save
 * attendance credit.
 */

import { FC } from "react"
import { Modal, Pressable, StyleSheet, TextStyle, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

interface ExternalZoomEducationModalProps {
  visible: boolean
  onContinue: () => void
}

export const ExternalZoomEducationModal: FC<ExternalZoomEducationModalProps> = ({
  visible,
  onContinue,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onContinue}
      statusBarTranslucent
    >
      <View style={themed($overlay)}>
        <Pressable style={themed($backdrop)} onPress={onContinue} />

        <View style={themed($card)} accessibilityViewIsModal>
          <View style={themed($header)}>
            <Ionicons name="information-circle" size={22} color={theme.colors.tint} />
            <Text style={themed($title)} tx="externalZoomEducation:title" />
          </View>

          <Text style={themed($body)} tx="externalZoomEducation:body" />

          <Pressable
            onPress={onContinue}
            style={themed($continueButton)}
            accessibilityRole="button"
            accessibilityLabel={t("externalZoomEducation:continue")}
          >
            <Text style={themed($continueButtonText)} tx="externalZoomEducation:continue" />
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const $overlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
})

const $backdrop: ThemedStyle<ViewStyle> = () => ({
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "rgba(0, 0, 0, 0.85)",
})

const $card: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  width: "85%",
  maxWidth: 400,
  backgroundColor: colors.card,
  borderRadius: 16,
  padding: spacing.lg,
  gap: spacing.md,
})

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 17,
  fontWeight: "700",
  color: colors.text,
})

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  lineHeight: 20,
  color: colors.text,
})

const $continueButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.sm,
  backgroundColor: "#000",
  borderWidth: 1.5,
  borderColor: colors.tint,
  borderRadius: 10,
  shadowColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
  marginTop: spacing.sm,
})

const $continueButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 15,
  fontWeight: "600",
})
