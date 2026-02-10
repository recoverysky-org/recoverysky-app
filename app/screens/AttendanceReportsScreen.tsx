/**
 * AttendanceReportsScreen - View and manage attendance reports
 *
 * Displays list of generated attendance reports.
 * Layout mirrors AttendanceScreen for visual consistency.
 */

import { FC } from "react"
import { ViewStyle, View, TextStyle, TouchableOpacity, Alert, Pressable } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import { AppStackScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

/**
 * AttendanceReportsScreen displays attendance reports
 */
export const AttendanceReportsScreen: FC<AppStackScreenProps<"AttendanceReports">> = observer(
  function AttendanceReportsScreen({ navigation }) {
    const { themed, theme } = useAppTheme()
    const profileStore = useProfileStore()

    const handleSendReport = () => {
      if (!profileStore.reportEmail) {
        Alert.alert("Email Required", "Please enter an email address to send the report.")
        return
      }
      Alert.alert("Coming Soon", "Send report functionality will be available in a future update.")
    }

    return (
      <Screen preset="scroll" safeAreaEdges={["top"]} contentContainerStyle={$styles.container}>
        {/* Header */}
        <View style={themed($header)}>
          <View style={$headerRow}>
            <Pressable
              style={({ pressed }) => [$backLink, pressed && $pressed]}
              onPress={() => navigation.goBack()}
            >
              <Ionicons name="chevron-back" size={16} color={theme.colors.tint} />
              <Text style={{ color: theme.colors.tint }}>Attendance</Text>
            </Pressable>
            <Text preset="heading" text="Reports" />
          </View>
        </View>

        {/* Email Input */}
        <View style={themed($emailSection)}>
          <Text style={themed($emailLabel)} tx="settingsScreen:exportEmail" />
          <TextField
            value={profileStore.reportEmail}
            onChangeText={profileStore.setReportEmail}
            placeholder={translate("settingsScreen:exportEmailPlaceholder")}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            inputWrapperStyle={themed($emailInputWrapper)}
          />
        </View>

        {/* Send Report Button */}
        <TouchableOpacity
          style={themed($sendButton)}
          onPress={handleSendReport}
          accessibilityRole="button"
        >
          <Ionicons name="send" size={18} color={theme.colors.tint} />
          <Text style={themed($sendButtonText)} text="Resend Report" />
        </TouchableOpacity>

        {/* Empty State */}
        <View style={themed($emptyContainer)}>
          <Text preset="subheading" style={themed($emptyText)} text="No reports yet" />
          <Text
            style={themed($emptySubtext)}
            text="Select attendance records and generate a report"
          />
        </View>
      </Screen>
    )
  },
)

// ============================================================================
// Styles
// ============================================================================

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.md,
})

const $headerRow: ViewStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
}

const $backLink: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 2,
}

const $pressed: ViewStyle = {
  opacity: 0.7,
}

const $emailSection: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.md,
})

const $emailLabel: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 14,
  color: colors.textDim,
  marginBottom: spacing.xs,
})

const $emailInputWrapper: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
  borderColor: colors.border,
  borderRadius: 8,
})

const $sendButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#000",
  borderWidth: 1.5,
  borderColor: colors.tint,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.lg,
  borderRadius: 10,
  marginTop: spacing.sm,
  gap: spacing.xs,
  shadowColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $sendButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 16,
  fontWeight: "600",
})

const $emptyContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xxl,
})

const $emptyText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  textAlign: "center",
})

const $emptySubtext: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  textAlign: "center",
  marginTop: spacing.sm,
  fontSize: 14,
})
