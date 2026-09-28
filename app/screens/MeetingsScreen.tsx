import { FC, useState, useCallback, useEffect, useRef } from "react"
import { View, ViewStyle } from "react-native"
import { useRoute, useIsFocused, RouteProp } from "@react-navigation/native"
import { observer } from "mobx-react-lite"

import { MeetingFilterBar } from "@/components/MeetingFilterBar"
import { Screen } from "@/components/Screen"
import { SegmentedControl } from "@/components/SegmentedControl"
import { MeetingFiltersProvider, useMeetingFilters } from "@/context/MeetingFiltersContext"
import { MainTabParamList, MainTabScreenProps, MeetingsSegment } from "@/navigators/navigationTypes"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { ACTIVE_FELLOWSHIPS } from "@/utils/fellowships"
import { buildLanguageOptions } from "@/utils/meetingFiltersLogic"

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
 * The filter bar bound to MeetingFiltersContext. ADDED 2026-09-26.
 * Language options come from the ACTIVE segment's loaded list, so the picker
 * offers what the user is looking at, not the union of three tabs.
 */
const ConnectedFilterBar: FC<{ activeSegment: MeetingsSegment }> = function ConnectedFilterBar({
  activeSegment,
}) {
  const { fellowship, language, setFellowship, setLanguage, meetingsBySegment } =
    useMeetingFilters()
  const languageOptions = buildLanguageOptions(meetingsBySegment[activeSegment] ?? [], language)

  return (
    <MeetingFilterBar
      fellowship={fellowship}
      fellowshipOptions={ACTIVE_FELLOWSHIPS}
      language={language}
      languageOptions={languageOptions}
      onSelectFellowship={(value) => {
        setFellowship(value)
        trackEvent("meetings_fellowship_changed", { fellowship: value })
      }}
      onSelectLanguage={(value) => {
        setLanguage(value)
        trackEvent("meetings_language_changed", { language: value ?? "all" })
      }}
    />
  )
}

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
  // ADDED 2026-09-26: Live resets Starts In on every visit, including a return
  // to the Meetings tab from another tab, which activeSegment alone can't see.
  const isFocused = useIsFocused()

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
    // "live" when no segment is supplied.
    // CHANGED 2026-08-07: that fallback used to be justified as "push
    // notification deep links pass meetingId alone and are always live". Both
    // halves are now false — reminder pushes carry a `segment` and it is
    // "inperson" for a face-to-face meeting. The fallback itself is still
    // right, but it now covers pushes from API builds predating the field
    // rather than all pushes. The value arrives from the network, so it is
    // narrowed in app.tsx (parseDeepLinkSegment) before it reaches here — an
    // unrecognised key would hide all three content views below.
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
  // NOTE 2026-08-08: because this never reverts, it is NOT a usable answer to
  // "is In-Person on screen right now". Anything that must come down when the
  // segment is hidden — currently the map's GL surface — takes the separate
  // `visible` prop below instead. See InPersonContentProps in InPersonScreen.
  const [inPersonActivated, setInPersonActivated] = useState(false)
  useEffect(() => {
    if (activeSegment === "inperson") setInPersonActivated(true)
  }, [activeSegment])

  // Same latch for Search, added 2026-08-04 when its Radius filter started
  // touching location. All three views are mounted from app start, so without
  // this a location fix would be taken at launch for a segment the user may
  // never open — the exact thing the In-Person latch above exists to prevent.
  // Search's meeting *fetch* used to be deliberately not gated on this ("it has
  // always loaded on mount and that costs nothing but a request").
  // CHANGED 2026-09-09: it is gated now. The launch-time request was the only
  // fetch either static segment made without the user asking, and it re-fired
  // on every fellowship/day change while the tab was hidden.
  const [listingsActivated, setListingsActivated] = useState(false)
  useEffect(() => {
    if (activeSegment === "listings") setListingsActivated(true)
  }, [activeSegment])

  return (
    <MeetingFiltersProvider>
      <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={themed($container)}>
        {/* Shared filters (ADDED 2026-09-26): above the segments because they
            apply to all three. See MeetingFiltersContext.
            CHANGED 2026-09-27: moved directly below the segment tabs. The tabs
            are the primary navigation and read first; the bar still sits
            outside every segment, so it still applies to all three. */}
        <View style={themed($header)}>
          <SegmentedControl
            segments={SEGMENTS}
            selectedIndex={selectedIndex}
            onChange={handleSegmentChange}
          />
          <ConnectedFilterBar activeSegment={activeSegment} />
        </View>

        {/* Content Views - all three mounted, inactive ones hidden via display:none */}
        <View style={[$content, activeSegment === "live" ? $contentVisible : $contentHidden]}>
          <LiveContent
            meetingId={route.params?.meetingId}
            visible={isFocused && activeSegment === "live"}
          />
        </View>
        <View style={[$content, activeSegment === "inperson" ? $contentVisible : $contentHidden]}>
          <InPersonContent active={inPersonActivated} visible={activeSegment === "inperson"} />
        </View>
        <View style={[$content, activeSegment === "listings" ? $contentVisible : $contentHidden]}>
          <ListingsContent active={listingsActivated} />
        </View>
      </Screen>
    </MeetingFiltersProvider>
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
