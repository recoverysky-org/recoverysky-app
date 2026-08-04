import { FC, useState, useCallback, useEffect, useRef } from "react"
import { View, ViewStyle } from "react-native"
import { useRoute, RouteProp } from "@react-navigation/native"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { SegmentedControl } from "@/components/SegmentedControl"
import { MainTabParamList, MainTabScreenProps, MeetingsSegment } from "@/navigators/navigationTypes"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { InPersonContent } from "./InPersonScreen"
import { ListingsContent } from "./ListingsScreen"
import { LiveContent } from "./LiveScreen"

const SEGMENTS = [
  { key: "live", tx: "meetingsScreen:liveSegment" as const },
  { key: "inperson", tx: "meetingsScreen:inPersonSegment" as const },
  { key: "listings", tx: "meetingsScreen:listingsSegment" as const },
]
// Index↔key mapping is positional; keep this array aligned with SEGMENTS.
const SEGMENT_KEYS: MeetingsSegment[] = ["live", "inperson", "listings"]

/**
 * MeetingsScreen - Consolidated meetings tab with segment control
 *
 * Combines Live and Listings views into a single tab with iOS-style
 * SegmentedControl. Both views stay mounted for state preservation
 * and continued background polling.
 * CHANGED 2026-08-03: added a third "In-Person" segment (key "inperson")
 * between Live and Listings, and relabeled the Listings segment's display
 * text to "Search" — its route key stays "listings" so deep links and
 * stored nav state keep working. All three content views stay mounted and
 * toggle via style, same pattern as before.
 */
export const MeetingsScreen: FC<MainTabScreenProps<"Meetings">> = observer(function MeetingsScreen({
  navigation: meetingsNavigation,
}) {
  const { themed } = useAppTheme()
  const route = useRoute<RouteProp<MainTabParamList, "Meetings">>()

  // Initialize segment from route params or default to "live"
  const [activeSegment, setActiveSegment] = useState<MeetingsSegment>(
    route.params?.segment ?? "live",
  )

  // Track last route param to detect navigation-triggered changes
  const lastRouteSegment = useRef(route.params?.segment)

  // Sync segment only when route params change from navigation (not local state)
  useEffect(() => {
    const newSegment = route.params?.segment
    const meetingId = route.params?.meetingId
    // A meetingId means "open this meeting's popup", so the segment that owns
    // that popup must win over both local state and the unchanged-param
    // short-circuit below.
    // CHANGED 2026-08-03: this used to hardcode "live". Both Live and
    // In-Person now restore a popup this way (paywall return, see
    // SettingsScreen.navigateReturn), and forcing live sent in-person users to
    // a segment that deliberately discards in-person records. Fall back to
    // "live" when no segment is supplied — push-notification deep links pass
    // meetingId alone and are always live.
    const forced = newSegment ?? "live"
    if (meetingId && activeSegment !== forced) {
      setActiveSegment(forced)
      lastRouteSegment.current = forced
      return
    }
    if (newSegment && newSegment !== lastRouteSegment.current) {
      lastRouteSegment.current = newSegment
      setActiveSegment(newSegment)
    }
    // `activeSegment` is read but deliberately NOT a dep (eslint warns; this
    // predates the 2026-08-03 change and is still correct). This effect exists
    // to react to NAVIGATION, not to local segment taps — adding it would make
    // the effect re-fire on every tap of the segmented control and re-force the
    // route's segment, trapping the user on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.segment, route.params?.meetingId])

  // Clear meetingId from route params after LiveContent reads it,
  // so it doesn't persist in navigation state and re-trigger on app restart
  useEffect(() => {
    if (route.params?.meetingId) {
      trackEvent("deeplink_meeting_opened")
      meetingsNavigation.setParams({ meetingId: undefined })
    }
  }, [route.params?.meetingId, meetingsNavigation])

  const handleSegmentChange = useCallback((index: number) => {
    setActiveSegment(SEGMENT_KEYS[index] ?? "live")
  }, [])

  const selectedIndex = Math.max(0, SEGMENT_KEYS.indexOf(activeSegment))

  // Once the user has opened In-Person we keep it "active" so its state
  // machine (location, fetches) survives segment switches like the other
  // stay-mounted views.
  const [inPersonActivated, setInPersonActivated] = useState(false)
  useEffect(() => {
    if (activeSegment === "inperson") setInPersonActivated(true)
  }, [activeSegment])

  // Same latch for Search, added 2026-08-04 when its Radius filter started
  // touching location. All three views are mounted from app start, so without
  // this a location fix would be taken at launch for a segment the user may
  // never open — the exact thing the In-Person latch above exists to prevent.
  // Search's meeting *fetch* is deliberately not gated on this; it has always
  // loaded on mount and that costs nothing but a request.
  const [listingsActivated, setListingsActivated] = useState(false)
  useEffect(() => {
    if (activeSegment === "listings") setListingsActivated(true)
  }, [activeSegment])

  return (
    <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={themed($container)}>
      {/* Segment Control */}
      <View style={themed($header)}>
        <SegmentedControl
          segments={SEGMENTS}
          selectedIndex={selectedIndex}
          onChange={handleSegmentChange}
        />
      </View>

      {/* Content Views - all three mounted, inactive ones hidden via display:none */}
      <View style={[$content, activeSegment === "live" ? $contentVisible : $contentHidden]}>
        <LiveContent meetingId={route.params?.meetingId} />
      </View>
      <View style={[$content, activeSegment === "inperson" ? $contentVisible : $contentHidden]}>
        <InPersonContent active={inPersonActivated} />
      </View>
      <View style={[$content, activeSegment === "listings" ? $contentVisible : $contentHidden]}>
        <ListingsContent active={listingsActivated} />
      </View>
    </Screen>
  )
})

const $container: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
})

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingVertical: spacing.sm,
})

const $content: ViewStyle = {
  flex: 1,
}

const $contentVisible: ViewStyle = {
  display: "flex",
}

const $contentHidden: ViewStyle = {
  display: "none",
}
