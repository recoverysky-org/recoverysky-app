/**
 * useShortNameGate — blocks actions that would print a nameless document.
 *
 * `profileStore.shortName` is the name stamped on attendance reports
 * (`useReportSender`) and on the 90-in-90 certificate
 * (`NinetyInNinetyCard`). It defaulted to "Anon M." until 2026-08-13, which
 * guaranteed those two surfaces always had *something* to print; the default
 * is now "" so the input shows its real placeholder instead of a fake name a
 * user would walk past. This gate is what replaces that guarantee — call it
 * before generating either document and bail when it returns false.
 *
 * The dialog offers a trip to Settings → Attendance, which is the only place
 * Short Name can be edited now. There is deliberately NO return path back to
 * the interrupted action: the user sets their name and navigates back
 * themselves (decision: Jenova, 2026-08-13). Don't add a `returnTo` here —
 * that param belongs to the paywall round-trip, which consumes it on
 * *purchase success* (`useSubscriptionReturn`), not on a field being filled,
 * so reusing it would either misfire or never fire at all.
 *
 * "Anon M." is treated as SET, not unset. Existing installs still hold it in
 * encrypted SQLite, their reports have always gone out under it, and prompting
 * them about a name they never chose to change would be a new interruption for
 * a problem they don't have. Only genuinely empty (or whitespace) is blocked.
 */
import { useCallback } from "react"
import { Alert, Platform } from "react-native"
import { type NavigationProp, useNavigation } from "@react-navigation/native"

import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import type { MainTabParamList } from "@/navigators/navigationTypes"

export interface ShortNameGate {
  /**
   * Returns true when a name is set and the caller may proceed. Returns false
   * after presenting the "add your name" dialog — the caller must abort.
   */
  requireShortName: () => boolean
}

export function useShortNameGate(): ShortNameGate {
  const navigation = useNavigation<NavigationProp<MainTabParamList>>()
  const profileStore = useProfileStore()

  const requireShortName = useCallback((): boolean => {
    if (profileStore.shortName.trim()) return true

    const title = translate("settingsScreen:shortNameRequiredTitle")
    const message = translate("settingsScreen:shortNameRequiredMessage")
    const goToSettings = () => navigation.navigate("Settings", { section: "attendance" })

    // react-native-web's `Alert` is a literal no-op, so the native path below
    // would show the user nothing at all and silently swallow the action —
    // they'd tap "Get Certificate" and watch it do nothing. `window.confirm`
    // is web's synchronous two-button equivalent. Same trap and same fix as
    // useLocationGate; see the comments there.
    if (Platform.OS === "web") {
      if (window.confirm(`${title}\n\n${message}`)) goToSettings()
      return false
    }

    Alert.alert(title, message, [
      { text: translate("common:cancel"), style: "cancel" },
      { text: translate("settingsScreen:shortNameRequiredAction"), onPress: goToSettings },
    ])
    return false
  }, [navigation, profileStore])

  return { requireShortName }
}
