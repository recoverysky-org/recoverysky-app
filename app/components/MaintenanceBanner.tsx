/**
 * MaintenanceBanner
 *
 * Sticky yellow strip pinned to the top of the screen whenever the server
 * has flagged maintenance mode (or our /config polling has been failing
 * past the retry budget). Renders above every navigator including modals
 * because it's mounted as an absolutely-positioned overlay outside the
 * navigation tree.
 *
 * Replaces the old full-screen MaintenanceScreen takeover for runtime
 * maintenance. The full-screen flow is now reserved for cold-start
 * outages only — see `configStore.outageMode` and AppNavigator.
 */

import { FC } from "react"
import { StyleSheet, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Text } from "@/components/Text"
import { useConfigStore } from "@/models"

const BANNER_BG = "#FFC107" // amber 500 — high-contrast attention without being garish
const BANNER_FG = "#1C1C1E" // neutral 800 — dark text on amber for AA contrast

export const MaintenanceBanner: FC = observer(function MaintenanceBanner() {
  const configStore = useConfigStore()
  const insets = useSafeAreaInsets()

  if (!configStore.maintenanceMode) return null

  return (
    <View
      style={[styles.container, { paddingTop: insets.top + 8 }]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <View style={styles.row}>
        <Ionicons name="warning-outline" size={18} color={BANNER_FG} />
        <Text style={styles.text} tx="common:maintenanceBanner" />
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    backgroundColor: BANNER_BG,
    left: 0,
    paddingBottom: 10,
    paddingHorizontal: 16,
    position: "absolute",
    right: 0,
    top: 0,
    // High zIndex so the banner sits above modals (Zoom timer, login,
    // import, etc.). Toast uses 9999; we sit just below it so a toast
    // can still appear on top during maintenance.
    zIndex: 9000,
  } satisfies ViewStyle,
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
  },
  text: {
    color: BANNER_FG,
    fontSize: 13,
    fontWeight: "600",
  },
})
