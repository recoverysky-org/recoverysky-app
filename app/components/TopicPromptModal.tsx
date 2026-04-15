/**
 * TopicPromptModal
 *
 * Cross-platform prompt that asks the user for a meeting topic after an
 * attendance record is finalized. Shown when `profileStore.enableMeetingTopic`
 * is on and the attendance was marked valid. On Save, the typed topic is
 * persisted to the attendance record via the caller's `onSave`; Skip dismisses
 * without writing anything.
 */

import { FC, useEffect, useState } from "react"
import { Modal, Pressable, StyleSheet, TextStyle, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

interface TopicPromptModalProps {
  visible: boolean
  meetingName?: string
  onSave: (topic: string) => void
  onSkip: () => void
}

export const TopicPromptModal: FC<TopicPromptModalProps> = ({
  visible,
  meetingName,
  onSave,
  onSkip,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const [topic, setTopic] = useState("")

  // Reset on each open so the field is empty for the next meeting
  useEffect(() => {
    if (visible) setTopic("")
  }, [visible])

  const canSave = topic.trim().length > 0

  const handleSave = () => {
    if (!canSave) return
    onSave(topic.trim())
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onSkip}
      statusBarTranslucent
    >
      <View style={themed($overlay)}>
        <Pressable style={themed($backdrop)} onPress={onSkip} />

        <View style={themed($card)} accessibilityViewIsModal>
          <View style={themed($header)}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={theme.colors.tint} />
            <Text style={themed($title)} tx="topicPrompt:title" />
          </View>

          {meetingName ? (
            <Text style={themed($meetingName)} numberOfLines={2}>
              {meetingName}
            </Text>
          ) : null}

          <Text style={themed($hint)} tx="topicPrompt:hint" />

          <TextField
            value={topic}
            onChangeText={setTopic}
            placeholder={t("topicPrompt:placeholder")}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSave}
            maxLength={200}
            containerStyle={themed($inputContainer)}
          />

          <View style={themed($buttonRow)}>
            <Pressable
              onPress={onSkip}
              style={themed($skipButton)}
              accessibilityRole="button"
              accessibilityLabel={t("topicPrompt:skip")}
            >
              <Text style={themed($skipButtonText)} tx="topicPrompt:skip" />
            </Pressable>

            <Pressable
              onPress={handleSave}
              disabled={!canSave}
              style={[themed($saveButton), !canSave && themed($saveButtonDisabled)]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave }}
              accessibilityLabel={t("topicPrompt:save")}
            >
              <Text
                style={[themed($saveButtonText), !canSave && themed($saveButtonTextDisabled)]}
                tx="topicPrompt:save"
              />
            </Pressable>
          </View>
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
  gap: spacing.sm,
})

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "700",
  color: colors.text,
})

const $meetingName: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $hint: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $inputContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.xs,
})

const $buttonRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  gap: spacing.md,
  marginTop: spacing.sm,
})

const $skipButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  paddingVertical: spacing.sm,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: colors.border,
  alignItems: "center",
  justifyContent: "center",
})

const $skipButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 15,
  fontWeight: "600",
})

const $saveButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: spacing.xs,
  paddingVertical: spacing.sm,
  backgroundColor: "#000",
  borderWidth: 1.5,
  borderColor: colors.tint,
  borderRadius: 10,
})

const $saveButtonDisabled: ThemedStyle<ViewStyle> = ({ colors }) => ({
  opacity: 0.5,
  borderColor: colors.border,
})

const $saveButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 15,
  fontWeight: "600",
})

const $saveButtonTextDisabled: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
})
