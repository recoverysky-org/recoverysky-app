/**
 * AttendanceReportsScreen - View and manage attendance reports
 *
 * Displays list of generated attendance reports.
 */

import { FC } from "react"
import { ViewStyle, View, TextStyle, TouchableOpacity, Alert } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import { AppStackScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * AttendanceReportsScreen displays attendance reports
 */
export const AttendanceReportsScreen: FC<AppStackScreenProps<"AttendanceReports">> = observer(
  function AttendanceReportsScreen(_props) {
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
      <Screen preset="scroll" contentContainerStyle={themed($container)}>
        {/* Email Input */}
        <View style={themed($emailSection)}>
          <Text style={themed($label)} tx="settingsScreen:exportEmail" />
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
          <Ionicons name="send" size={18} color="#FFFFFF" />
          <Text style={$sendButtonText} text="Resend Report" />
        </TouchableOpacity>

        {/* Empty State */}
        <View style={themed($emptyContainer)}>
          <Text style={themed($emptyText)} text="No reports yet" />
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

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingTop: spacing.md,
})

const $emailSection: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginBottom: spacing.md,
})

const $label: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
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
  backgroundColor: colors.tint,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.lg,
  borderRadius: 8,
  marginBottom: spacing.lg,
  gap: spacing.xs,
})

const $sendButtonText: TextStyle = {
  color: "#FFFFFF",
  fontSize: 16,
  fontWeight: "600",
}

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
