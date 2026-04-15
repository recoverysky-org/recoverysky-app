/**
 * TopicPromptContent
 *
 * Inline panel used by SchedulePopup to capture a meeting topic (and
 * optionally host) after attendance is recorded. This is a plain View — NOT
 * an RN Modal — because it renders INSIDE SchedulePopup's existing modal,
 * which avoids the iOS modal-stacking race that prevented the standalone
 * TopicPromptModal from presenting while the Zoom SDK UI was mid-dismiss.
 */

import { FC, useEffect, useState } from "react"
import { Pressable, TextStyle, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

interface TopicPromptContentProps {
  /** Whether the panel is currently shown — used to reset inputs on each open */
  active: boolean
  meetingName?: string
  /**
   * When true, also prompt for a meeting host. External-zoom attendance needs
   * this because the SDK-side host capture isn't available when joining via
   * the installed Zoom app.
   */
  includeHost?: boolean
  onSave: (result: { topic: string; host?: string }) => void
  onSkip: () => void
}

export const TopicPromptContent: FC<TopicPromptContentProps> = ({
  active,
  meetingName,
  includeHost,
  onSave,
  onSkip,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const [topic, setTopic] = useState("")
  const [host, setHost] = useState("")
  // Guard against double-taps: the parent's onSave runs an async
  // attendanceRepo.update which isn't instant, and the panel may stay
  // mounted briefly while the parent animates it out — so without this flag
  // the user can queue multiple writes by tapping fast.
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (active) {
      setTopic("")
      setHost("")
      setSubmitting(false)
    }
  }, [active])

  const canSave = topic.trim().length > 0 && !submitting

  const handleSave = () => {
    if (!canSave) return
    setSubmitting(true)
    const trimmedHost = host.trim()
    onSave({
      topic: topic.trim(),
      host: trimmedHost.length > 0 ? trimmedHost : undefined,
    })
  }

  const handleSkip = () => {
    if (submitting) return
    setSubmitting(true)
    onSkip()
  }

  return (
    <View style={themed($card)}>
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

      {includeHost ? (
        <TextField
          value={host}
          onChangeText={setHost}
          placeholder={t("topicPrompt:hostPlaceholder")}
          autoFocus={active}
          returnKeyType="next"
          maxLength={100}
          containerStyle={themed($inputContainer)}
        />
      ) : null}

      <TextField
        value={topic}
        onChangeText={setTopic}
        placeholder={t("topicPrompt:placeholder")}
        autoFocus={active && !includeHost}
        returnKeyType="done"
        onSubmitEditing={handleSave}
        maxLength={200}
        containerStyle={themed($inputContainer)}
      />

      <View style={themed($buttonRow)}>
        <Pressable
          onPress={handleSkip}
          disabled={submitting}
          style={[themed($skipButton), submitting && themed($saveButtonDisabled)]}
          accessibilityRole="button"
          accessibilityState={{ disabled: submitting }}
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
  )
}

const $card: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
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
