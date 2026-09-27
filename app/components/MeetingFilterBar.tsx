/**
 * MeetingFilterBar: the Fellowship | Lang bar above the Meetings segments.
 *
 * ADDED 2026-09-26. Fellowship and Language apply to all three segments, so
 * they live here once instead of inside each segment's own filter grid.
 * Presentational only: values and options arrive as props, picks leave as
 * callbacks, and nothing here reads a store or context. That lets the jest
 * test mount it bare (the PermissionsSection pattern). The only local state
 * is which modal is open.
 *
 * Fellowship has no "All": In-Person and Search send it as a server fetch
 * param, and "All" would mean an unfiltered fetch of every fellowship.
 * Language does, stored as `null`.
 *
 * Cell + modal chrome copied from InPersonListHeader / InPersonScreen, kept as
 * a local copy for the same reason those files keep theirs.
 */
import { FC, useState } from "react"
import {
  Modal,
  Pressable,
  ScrollView,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { getLanguageDisplayName } from "@/utils/meetingFiltersLogic"

export interface MeetingFilterBarProps {
  fellowship: string
  fellowshipOptions: readonly string[]
  /** `null` = all languages */
  language: string | null
  languageOptions: readonly string[]
  onSelectFellowship: (value: string) => void
  onSelectLanguage: (value: string | null) => void
}

export const MeetingFilterBar: FC<MeetingFilterBarProps> = ({
  fellowship,
  fellowshipOptions,
  language,
  languageOptions,
  onSelectFellowship,
  onSelectLanguage,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const [open, setOpen] = useState<"fellowship" | "language" | null>(null)
  const close = () => setOpen(null)

  const languageLabel = language
    ? getLanguageDisplayName(language)
    : t("meetingsScreen:allLanguages")

  const renderOption = (
    testID: string,
    label: string,
    isSelected: boolean,
    onPress: () => void,
  ) => (
    <TouchableOpacity
      key={testID}
      testID={testID}
      style={[themed($modalOption), isSelected && themed($modalOptionSelected)]}
      onPress={() => {
        onPress()
        close()
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={label}
    >
      <Text style={[themed($modalOptionText), isSelected && themed($modalOptionTextSelected)]}>
        {label}
      </Text>
      {isSelected && <Ionicons name="checkmark" size={18} color={theme.colors.tint} />}
    </TouchableOpacity>
  )

  return (
    <View style={themed($row)}>
      <TouchableOpacity
        testID="filter-bar-fellowship"
        style={themed($cell)}
        onPress={() => setOpen("fellowship")}
        accessibilityRole="button"
        accessibilityLabel={`${t("meetingsScreen:filterFellowship")}, ${fellowship}`}
      >
        <Text style={themed($cellLabel)}>{t("meetingsScreen:filterFellowship")}</Text>
        <View style={$cellValueRow}>
          <Text style={themed($cellValue)} numberOfLines={1}>
            {fellowship}
          </Text>
          <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        testID="filter-bar-language"
        style={themed($cell)}
        onPress={() => setOpen("language")}
        accessibilityRole="button"
        accessibilityLabel={`${t("meetingsScreen:filterLanguageA11y")}, ${languageLabel}`}
      >
        <Text style={themed($cellLabel)}>{t("meetingsScreen:filterLang")}</Text>
        <View style={$cellValueRow}>
          <Text style={themed($cellValue)} numberOfLines={1}>
            {languageLabel}
          </Text>
          <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
        </View>
      </TouchableOpacity>

      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={themed($modalOverlay)} onPress={close}>
          <View style={themed($modalContent)} accessibilityViewIsModal>
            <Text style={themed($modalTitle)}>
              {open === "fellowship"
                ? t("settingsScreen:selectFellowship")
                : t("meetingsScreen:selectLanguage")}
            </Text>
            <ScrollView bounces={false}>
              {open === "fellowship" &&
                fellowshipOptions.map((f) =>
                  renderOption(`fellowship-option-${f}`, f, f === fellowship, () =>
                    onSelectFellowship(f),
                  ),
                )}
              {open === "language" && (
                <>
                  {renderOption(
                    "language-option-all",
                    t("meetingsScreen:allLanguages"),
                    language === null,
                    () => onSelectLanguage(null),
                  )}
                  {languageOptions.map((code) =>
                    renderOption(
                      `language-option-${code}`,
                      getLanguageDisplayName(code),
                      code === language,
                      () => onSelectLanguage(code),
                    ),
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "stretch",
  marginHorizontal: spacing.md,
  marginBottom: spacing.sm,
  gap: spacing.sm,
})
const $cell: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderRadius: 8,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
})
const $cellLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})
const $cellValueRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  flexShrink: 1,
}
const $cellValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.tint,
  flexShrink: 1,
})
const $modalOverlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.5)",
  justifyContent: "center",
  alignItems: "center",
})
const $modalContent: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderRadius: 12,
  padding: spacing.md,
  minWidth: 200,
  maxWidth: "80%",
  maxHeight: "70%",
})
const $modalTitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 18,
  fontWeight: "700",
  color: colors.text,
  marginBottom: spacing.md,
  textAlign: "center",
})
const $modalOption: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.sm,
  borderRadius: 8,
})
const $modalOptionSelected: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
})
const $modalOptionText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
})
const $modalOptionTextSelected: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontWeight: "600",
})
