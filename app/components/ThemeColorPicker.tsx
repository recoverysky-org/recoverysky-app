/**
 * ThemeColorPicker Component
 *
 * Color picker for app theme tint color.
 * Features preset colors and a custom color wheel picker.
 */

import { FC, useState, useCallback } from "react"
import { View, ViewStyle, TextStyle, Pressable, Modal } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import ColorPicker, { Panel1, HueSlider, Preview } from "reanimated-color-picker"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

// Preset vibrant colors
const PRESET_COLORS = [
  { name: "Hot Pink", hex: "#FF69B4" },
  { name: "Electric Pink", hex: "#FF1493" },
  { name: "Tangerine", hex: "#FF9966" },
  { name: "Orange", hex: "#FF6600" },
  { name: "Yellow", hex: "#FFD700" },
  { name: "Lime", hex: "#32CD32" },
  { name: "Cyan", hex: "#00CED1" },
  { name: "Purple", hex: "#9370DB" },
] as const

interface ThemeColorPickerProps {
  /** Whether the modal is visible */
  visible: boolean
  /** Callback when modal is closed */
  onClose: () => void
}

/**
 * ThemeColorPicker modal with preset colors and a custom color wheel.
 *
 * @example
 * <ThemeColorPicker
 *   visible={showPicker}
 *   onClose={() => setShowPicker(false)}
 * />
 */
export const ThemeColorPicker: FC<ThemeColorPickerProps> = ({ visible, onClose }) => {
  const { themed, theme, setThemeColor, themeColor } = useAppTheme()
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  const [customColor, setCustomColor] = useState(themeColor || theme.colors.tint)

  const currentColor = themeColor ?? theme.colors.tint

  const handlePresetSelect = useCallback(
    (hex: string) => {
      setThemeColor(hex)
      onClose()
    },
    [setThemeColor, onClose],
  )

  const handleCustomColorChange = useCallback((color: { hex: string }) => {
    setCustomColor(color.hex)
  }, [])

  const handleCustomConfirm = useCallback(() => {
    setThemeColor(customColor)
    setShowCustomPicker(false)
    onClose()
  }, [customColor, setThemeColor, onClose])

  const handleReset = useCallback(() => {
    setThemeColor(undefined)
    onClose()
  }, [setThemeColor, onClose])

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={themed($modalOverlay)}>
        <Pressable style={themed($backdropPress)} onPress={onClose} />

        <View style={themed($modalContent)}>
          <Text style={themed($modalTitle)}>Theme Color</Text>

          {/* Preset Colors Grid */}
          <View style={themed($presetsGrid)}>
            {PRESET_COLORS.map((color) => {
              const isSelected = currentColor.toUpperCase() === color.hex.toUpperCase()
              return (
                <Pressable
                  key={color.hex}
                  style={[
                    themed($colorCircle),
                    { backgroundColor: color.hex },
                    isSelected && themed($selectedCircle),
                  ]}
                  onPress={() => handlePresetSelect(color.hex)}
                >
                  {isSelected && <Ionicons name="checkmark" size={20} color="#fff" />}
                </Pressable>
              )
            })}

            {/* Custom Color Button */}
            <Pressable
              style={[themed($colorCircle), themed($customButton)]}
              onPress={() => setShowCustomPicker(true)}
            >
              <Ionicons name="color-palette" size={20} color={theme.colors.tint} />
            </Pressable>

            {/* Reset Button */}
            <Pressable style={[themed($colorCircle), themed($resetButton)]} onPress={handleReset}>
              <Ionicons name="refresh" size={20} color={theme.colors.textDim} />
            </Pressable>
          </View>

          {/* Custom Color Picker (inline when shown) */}
          {showCustomPicker && (
            <>
              <ColorPicker
                value={customColor}
                onComplete={handleCustomColorChange}
                style={themed($colorPicker)}
              >
                <Preview style={themed($preview)} />
                <Panel1 style={themed($panel)} />
                <HueSlider style={themed($hueSlider)} />
              </ColorPicker>

              <View style={themed($modalButtons)}>
                <Pressable style={themed($modalButton)} onPress={() => setShowCustomPicker(false)}>
                  <Text style={themed($modalButtonText)}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[themed($modalButton), { backgroundColor: theme.colors.tint }]}
                  onPress={handleCustomConfirm}
                >
                  <Text style={[themed($modalButtonText), { color: "#fff" }]}>Apply</Text>
                </Pressable>
              </View>
            </>
          )}

          {/* Close button when not in custom picker mode */}
          {!showCustomPicker && (
            <Pressable style={themed($closeButton)} onPress={onClose}>
              <Text style={[themed($modalButtonText), { color: theme.colors.tint }]}>Done</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  )
}

// ============================================================================
// Styles
// ============================================================================

const $presetsGrid: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.sm,
  justifyContent: "center",
})

const $backdropPress: ThemedStyle<ViewStyle> = () => ({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
})

const $colorCircle: ThemedStyle<ViewStyle> = () => ({
  width: 44,
  height: 44,
  borderRadius: 22,
  justifyContent: "center",
  alignItems: "center",
})

const $selectedCircle: ThemedStyle<ViewStyle> = () => ({
  borderWidth: 3,
  borderColor: "#fff",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.3,
  shadowRadius: 4,
  elevation: 4,
})

const $customButton: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
  borderWidth: 2,
  borderColor: colors.border,
  borderStyle: "dashed",
})

const $resetButton: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
})

const $modalOverlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  backgroundColor: "rgba(0, 0, 0, 0.6)",
  justifyContent: "center",
  alignItems: "center",
})

const $modalContent: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderRadius: 16,
  padding: spacing.lg,
  width: "85%",
  maxWidth: 320,
})

const $modalTitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 18,
  fontWeight: "700",
  color: colors.text,
  textAlign: "center",
  marginBottom: spacing.md,
})

const $colorPicker: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.md,
})

const $preview: ThemedStyle<ViewStyle> = () => ({
  height: 40,
  borderRadius: 8,
})

const $panel: ThemedStyle<ViewStyle> = () => ({
  height: 150,
  borderRadius: 8,
})

const $hueSlider: ThemedStyle<ViewStyle> = () => ({
  height: 30,
  borderRadius: 8,
})

const $modalButtons: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  marginTop: spacing.lg,
  gap: spacing.sm,
})

const $modalButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  paddingVertical: spacing.sm,
  borderRadius: 8,
  backgroundColor: colors.card,
  alignItems: "center",
})

const $modalButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.text,
})

const $closeButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  paddingVertical: spacing.sm,
  marginTop: spacing.md,
})
