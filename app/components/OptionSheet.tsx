import { FC } from "react"
import { Modal, Pressable, TextStyle, View, ViewStyle } from "react-native"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import type { TxKeyPath } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export interface OptionSheetOption {
  key: string
  tx: TxKeyPath
  /** Painted in the error colour: removing a contact, not a neutral choice. */
  destructive?: boolean
}

interface OptionSheetProps {
  visible: boolean
  titleTx?: TxKeyPath
  options: ReadonlyArray<OptionSheetOption>
  /** Called with the tapped option's key. The sheet does not close itself: the caller closes it inside onSelect. */
  onSelect: (key: string) => void
  onClose: () => void
}

/**
 * A small cancellable list of choices in a transparent Modal (the
 * DaySelectorModal shape).
 *
 * ADDED 2026-11-06 for Support Contacts. It exists because Android's
 * `Alert.alert` takes at most three buttons, and the contact row's overflow
 * menu and the role sheet need four or more. It takes translation keys only,
 * so a caller cannot pass it a number or any other personal text by accident.
 *
 * Every option and the Cancel row is a labelled button. The backdrop tap and
 * the Android back button both go to `onClose`.
 */
export const OptionSheet: FC<OptionSheetProps> = ({
  visible,
  titleTx,
  options,
  onSelect,
  onClose,
}) => {
  const { t } = useTranslation()
  const { themed } = useAppTheme()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* The backdrop is a plain tap target that sits behind the sheet. It is
          hidden from screen readers (Cancel is the accessible way out) and the
          sheet itself is a sibling, so a tap inside never reaches it. */}
      <View style={themed($overlay)}>
        <Pressable
          style={$backdrop}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
        />
        <View style={themed($sheet)} accessibilityViewIsModal>
          {!!titleTx && (
            <Text style={themed($title)} accessibilityRole="header">
              {t(titleTx)}
            </Text>
          )}
          {options.map((option) => (
            <Pressable
              key={option.key}
              style={themed($row)}
              onPress={() => onSelect(option.key)}
              accessibilityRole="button"
              accessibilityLabel={t(option.tx)}
            >
              <Text style={themed(option.destructive ? $rowTextDestructive : $rowText)}>
                {t(option.tx)}
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={themed($row)}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("common:cancel")}
          >
            <Text style={themed($rowText)}>{t("common:cancel")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const $overlay: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.5)",
  justifyContent: "center",
  alignItems: "center",
  padding: spacing.md,
})

const $backdrop: ViewStyle = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }

const $sheet: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderRadius: 12,
  padding: spacing.xs,
  minWidth: 240,
  maxWidth: "90%",
})

const $title: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 16,
  fontWeight: "700",
  color: colors.text,
  textAlign: "center",
  padding: spacing.sm,
})

// 48 dp minimum touch target (repo a11y standard).
const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  minHeight: 48,
  justifyContent: "center",
  paddingHorizontal: spacing.md,
  borderRadius: 8,
})

const $rowText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
  textAlign: "center",
})

const $rowTextDestructive: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.error,
  textAlign: "center",
})
