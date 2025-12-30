import { FC, useState, useCallback, useEffect } from "react"
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
  function MeetingsScreen(_props) {
    const { themed } = useAppTheme()
    const route = useRoute<RouteProp<MainTabParamList, "Meetings">>()

    // Initialize segment from route params or default to "live"
    const initialSegment: MeetingsSegment = route.params?.segment ?? "live"
    const [activeSegment, setActiveSegment] = useState<MeetingsSegment>(initialSegment)

    // Sync segment when route params change (for deep linking from help cards)
    useEffect(() => {
      if (route.params?.segment && route.params.segment !== activeSegment) {
        setActiveSegment(route.params.segment)
      }
    }, [route.params?.segment, activeSegment])

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
        <View style={[$content, { display: activeSegment === "live" ? "flex" : "none" }]}>
          <LiveContent />
        </View>
        <View style={[$content, { display: activeSegment === "listings" ? "flex" : "none" }]}>
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
