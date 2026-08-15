import { FC } from "react"
import { Modal, Pressable, TextStyle, TouchableOpacity, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import type { TxKeyPath } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { ANY_DAY, ISO_DAYS } from "@/utils/filterLogic"

// MOVED 2026-08-14: `ISO_DAYS` used to be declared (and exported) here. It now
// lives in `@/utils/filterLogic` beside `ANY_DAY` and `coerceDay`, because
// `MeetingRow` needs the same weekday labels for its "Any" day badge and a row
// component importing from a modal is backwards. Import it from there.

interface DaySelectorModalProps {
  visible: boolean
  /** ISO day of week, 1=Monday..7=Sunday, or `ANY_DAY` (0) for every day */
  selectedDay: number
  /** Called with the tapped day; caller owns tracking + state */
  onSelect: (isoDow: number) => void
  onClose: () => void
  /**
   * Offer the "Any" row above the seven weekdays.
   *
   * Opt-in so the picker is unchanged for callers that have no use for it —
   * Any only makes sense where the result set is bounded by something else
   * (a radius), or it returns a week of noise. See `anyDayAllowedFor`.
   */
  allowAny?: boolean
  /**
   * Render "Any" as present-but-unavailable rather than selectable.
   *
   * Deliberately NOT the same as `allowAny={false}`: a hidden option is one
   * nobody discovers, and the users who most need Any (sparse areas) are the
   * least likely to go hunting for it. Showing it greyed with a reason teaches
   * the feature exists and what unlocks it. Ignored unless `allowAny`.
   */
  anyDisabled?: boolean
  /** Why Any is unavailable — rendered under it. Only used when `anyDisabled`. */
  anyDisabledTx?: TxKeyPath
}

/**
 * Day-of-week picker modal. Extracted from ListingsScreen (2026-08-03)
 * so the In-Person segment shares one implementation.
 *
 * CHANGED 2026-08-14: gained the optional "Any" row (all seven days at once).
 * Both new props default off, so every existing caller renders exactly what it
 * did before.
 */
export const DaySelectorModal: FC<DaySelectorModalProps> = ({
  visible,
  selectedDay,
  onSelect,
  onClose,
  allowAny = false,
  anyDisabled = false,
  anyDisabledTx,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={themed($modalOverlay)} onPress={onClose}>
        <View style={themed($modalContent)} accessibilityViewIsModal>
          <Text style={themed($modalTitle)}>{t("listingsScreen:selectDay")}</Text>
          {/* "Any" leads the list rather than trailing it: it's the widest
              choice, and a user who opens this picker because paging through
              seven days is tedious should meet the fix first, not after
              scrolling past the seven days that caused the problem. */}
          {allowAny && (
            <TouchableOpacity
              style={[
                themed($modalOption),
                selectedDay === ANY_DAY && !anyDisabled && themed($modalOptionSelected),
              ]}
              onPress={() => {
                onSelect(ANY_DAY)
                onClose()
              }}
              // A real `disabled` (not just an inert style): this must not be
              // tappable, and it must announce itself as unavailable. Contrast
              // with PermissionsSection's push row, which stays live-looking on
              // purpose because tapping it enters the subscription funnel —
              // there is nothing to sell here, only a venue to switch.
              disabled={anyDisabled}
              accessibilityRole="radio"
              accessibilityState={{
                selected: selectedDay === ANY_DAY && !anyDisabled,
                disabled: anyDisabled,
              }}
              // The hint is the whole reason this row is visible while
              // disabled, so it has to reach screen readers too — the visual
              // sub-label below is inside the same element, but VoiceOver reads
              // the row as one node and the hint is the actionable half.
              accessibilityHint={anyDisabled && anyDisabledTx ? t(anyDisabledTx) : undefined}
            >
              <View style={$anyTextColumn}>
                <Text
                  style={[
                    themed($modalOptionText),
                    selectedDay === ANY_DAY && !anyDisabled && themed($modalOptionTextSelected),
                    anyDisabled && themed($modalOptionTextDisabled),
                  ]}
                >
                  {t("listingsScreen:anyDay")}
                </Text>
                {anyDisabled && !!anyDisabledTx && (
                  <Text style={themed($modalOptionHint)}>{t(anyDisabledTx)}</Text>
                )}
              </View>
              {selectedDay === ANY_DAY && !anyDisabled && (
                <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
              )}
            </TouchableOpacity>
          )}
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

// Two lines (label + reason) where every other option is one, so the label
// can't be a bare sibling of the checkmark in the row's space-between.
const $anyTextColumn: ViewStyle = {
  flex: 1,
}

const $modalOptionTextDisabled: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
})

const $modalOptionHint: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
  marginTop: 2,
})
