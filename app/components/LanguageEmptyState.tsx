/**
 * Empty state for "the list has meetings, but none in the selected language".
 *
 * ADDED 2026-09-26. The language filter is remembered across restarts and
 * shared by all three segments, so it is routinely stale: "ES" chosen on Live
 * yesterday, applied to a nearby list with no Spanish meetings today. A bare
 * "No meetings" would blame the wrong thing. This names the filter and offers
 * the one tap that clears it. Shared by Live, In-Person and Search.
 */
import { FC } from "react"
import { TextStyle, TouchableOpacity, View, ViewStyle } from "react-native"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { getLanguageDisplayName } from "@/utils/meetingFiltersLogic"

export interface LanguageEmptyStateProps {
  language: string
  onShowAll: () => void
}

export const LanguageEmptyState: FC<LanguageEmptyStateProps> = ({ language, onShowAll }) => {
  const { t } = useTranslation()
  const { themed } = useAppTheme()

  return (
    <View style={themed($container)}>
      <Text style={themed($message)}>
        {t("meetingsScreen:noMeetingsInLanguage", { language: getLanguageDisplayName(language) })}
      </Text>
      <TouchableOpacity
        style={themed($button)}
        onPress={onShowAll}
        accessibilityRole="button"
        accessibilityLabel={t("meetingsScreen:showAllLanguages")}
      >
        <Text style={themed($buttonText)}>{t("meetingsScreen:showAllLanguages")}</Text>
      </TouchableOpacity>
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  paddingVertical: spacing.xl,
  paddingHorizontal: spacing.lg,
  gap: spacing.md,
})
const $message: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.textDim,
  textAlign: "center",
})
const $button: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: colors.tint,
})
const $buttonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  fontWeight: "600",
  color: colors.tint,
})
