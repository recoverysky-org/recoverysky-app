/**
 * MaintenanceBanner
 *
 * Sticky strip pinned to the top of the screen. Two variants, chosen by the
 * pure `decideBanner`:
 *
 * - "offline" — the device has no network. Muted blue-grey, informational:
 *   it's the user's connectivity, not our service, and it also explains why
 *   refreshes come up empty. Wins over maintenance (an offline device can't
 *   verify a maintenance claim).
 * - "maintenance" — the server flagged maintenance mode, or /config polling
 *   failed past the retry budget WHILE THE DEVICE WAS ONLINE (offline poll
 *   failures no longer flip maintenanceMode — see ConfigStore.fetchConfig).
 *   The original amber strip.
 *
 * Renders above every navigator including modals because it's mounted as an
 * absolutely-positioned overlay outside the navigation tree. Still
 * non-blocking: the navigator is never gated, so a mid-meeting external-Zoom
 * timer survives both variants.
 *
 * Replaces the old full-screen MaintenanceScreen takeover for runtime
 * maintenance. The full-screen flow is reserved for cold-start outages —
 * see `configStore.outageMode` and AppNavigator.
 * CHANGED 2026-09-06: split into the two variants above; previously a single
 * maintenance strip that offline users saw too (the false-banner complaint).
 */

import { FC } from "react"
import { StyleSheet, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Text } from "@/components/Text"
import { useConfigStore, useNetworkStore } from "@/models"
import { decideBanner } from "@/utils/connectivityLogic"

const MAINT_BG = "#FFC107" // amber 500 — high-contrast attention without being garish
const MAINT_FG = "#1C1C1E" // neutral 800 — dark text on amber for AA contrast
const OFFLINE_BG = "#546E7A" // blue-grey 600 — calm/informational, not alarm-amber
const OFFLINE_FG = "#FFFFFF" // white on blue-grey 600 ≈ 5.4:1, AA for this size/weight

export const MaintenanceBanner: FC = observer(function MaintenanceBanner() {
  const configStore = useConfigStore()
  const networkStore = useNetworkStore()
  const insets = useSafeAreaInsets()

  const banner = decideBanner({
    isOffline: networkStore.isOffline,
    maintenanceMode: configStore.maintenanceMode,
  })
  if (banner === "none") return null

  const offline = banner === "offline"

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: offline ? OFFLINE_BG : MAINT_BG, paddingTop: insets.top + 8 },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <View style={styles.row}>
        <Ionicons
          name={offline ? "cloud-offline-outline" : "warning-outline"}
          size={18}
          color={offline ? OFFLINE_FG : MAINT_FG}
        />
        <Text
          style={[styles.text, { color: offline ? OFFLINE_FG : MAINT_FG }]}
          tx={offline ? "common:offlineBanner" : "common:maintenanceBanner"}
        />
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
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
    fontSize: 13,
    fontWeight: "600",
  },
})
