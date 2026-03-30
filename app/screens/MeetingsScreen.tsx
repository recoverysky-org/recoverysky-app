import { FC, useState, useCallback, useEffect, useRef } from "react"
import { View, ViewStyle } from "react-native"
import { useRoute, RouteProp } from "@react-navigation/native"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { SegmentedControl } from "@/components/SegmentedControl"
import { MainTabParamList, MainTabScreenProps, MeetingsSegment } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { ListingsContent } from "./ListingsScreen"
import { LiveContent } from "./LiveScreen"

const SEGMENTS = [
  { key: "live", tx: "meetingsScreen:liveSegment" as const },
  { key: "listings", tx: "meetingsScreen:listingsSegment" as const },
]

/**
 * MeetingsScreen - Consolidated meetings tab with segment control
 *
 * Combines Live and Listings views into a single tab with iOS-style
 * SegmentedControl. Both views stay mounted for state preservation
 * and continued background polling.
 */
export const MeetingsScreen: FC<MainTabScreenProps<"Meetings">> = observer(
  function MeetingsScreen({ navigation: meetingsNavigation }) {
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
      // Force live segment when meetingId is provided
      if (meetingId && activeSegment !== "live") {
        setActiveSegment("live")
        lastRouteSegment.current = "live"
        return
      }
      if (newSegment && newSegment !== lastRouteSegment.current) {
        lastRouteSegment.current = newSegment
        setActiveSegment(newSegment)
      }
    }, [route.params?.segment, route.params?.meetingId])

    // Clear meetingId from route params after LiveContent reads it,
    // so it doesn't persist in navigation state and re-trigger on app restart
    useEffect(() => {
      if (route.params?.meetingId) {
        meetingsNavigation.setParams({ meetingId: undefined })
      }
    }, [route.params?.meetingId, meetingsNavigation])

    const handleSegmentChange = useCallback((index: number) => {
      setActiveSegment(index === 0 ? "live" : "listings")
    }, [])

    const selectedIndex = activeSegment === "live" ? 0 : 1

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

        {/* Content Views - both mounted, inactive one hidden */}
        <View style={[$content, activeSegment === "live" ? $contentVisible : $contentHidden]}>
          <LiveContent meetingId={route.params?.meetingId} />
        </View>
        <View style={[$content, activeSegment === "listings" ? $contentVisible : $contentHidden]}>
          <ListingsContent />
        </View>
      </Screen>
    )
  },
)

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
