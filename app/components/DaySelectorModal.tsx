import { FC } from "react"
import { Modal, Pressable, TextStyle, TouchableOpacity, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import type { TxKeyPath } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

// ISO day of week: 1=Monday, 7=Sunday. Keys stay in the listingsScreen
// namespace even though this component is shared — renaming i18n keys
// would churn both translation files for zero user value.
export const ISO_DAYS: { iso: number; tx: TxKeyPath }[] = [
  { iso: 1, tx: "listingsScreen:monday" },
  { iso: 2, tx: "listingsScreen:tuesday" },
  { iso: 3, tx: "listingsScreen:wednesday" },
  { iso: 4, tx: "listingsScreen:thursday" },
  { iso: 5, tx: "listingsScreen:friday" },
  { iso: 6, tx: "listingsScreen:saturday" },
  { iso: 7, tx: "listingsScreen:sunday" },
]

interface DaySelectorModalProps {
  visible: boolean
  /** ISO day of week, 1=Monday..7=Sunday */
  selectedDay: number
  /** Called with the tapped day; caller owns tracking + state */
  onSelect: (isoDow: number) => void
  onClose: () => void
}

/**
 * Day-of-week picker modal. Extracted from ListingsScreen (2026-08-03)
 * so the In-Person segment shares one implementation.
 */
export const DaySelectorModal: FC<DaySelectorModalProps> = ({
  visible,
  selectedDay,
  onSelect,
  onClose,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={themed($modalOverlay)} onPress={onClose}>
        <View style={themed($modalContent)} accessibilityViewIsModal>
          <Text style={themed($modalTitle)}>{t("listingsScreen:selectDay")}</Text>
          {ISO_DAYS.map((day) => (
            <TouchableOpacity
              key={day.iso}
              style={[
                themed($modalOption),
                selectedDay === day.iso && themed($modalOptionSelected),
              ]}
              onPress={() => {
                onSelect(day.iso)
                onClose()
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedDay === day.iso }}
            >
              <Text
                style={[
                  themed($modalOptionText),
                  selectedDay === day.iso && themed($modalOptionTextSelected),
                ]}
              >
                {t(day.tx)}
              </Text>
              {selectedDay === day.iso && (
                <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  )
}

// ============================================================================
// Styles
//
// Copied verbatim from ListingsScreen rather than imported from a shared
// styles module — ListingsScreen's other three modals (language, fellowship,
// time) still hold their own copies of these same constants, so this
// component is deliberately self-contained instead of creating a cross-file
// style dependency. See task-5 brief.
// ============================================================================

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
