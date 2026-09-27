/**
 * InPersonListHeader — the header of the Meetings tab's In-Person segment.
 *
 * Extracted from InPersonScreen.tsx on 2026-09-05 so it can be jest-mounted
 * on its own: the screen imports InPersonMapView, whose maplibre dependency
 * calls TurboModuleRegistry.getEnforcing at module scope and throws under
 * jest. Presentational only — every value arrives as a prop, nothing here
 * reads a store or fires a side effect. The screen renders it in BOTH the
 * list branch (as FlatList's ListHeaderComponent) and the map branch, so
 * anything shown here is visible in both view modes.
 */
import { FC } from "react"
import { ActivityIndicator, TextStyle, TouchableOpacity, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { MapListToggle, type InPersonViewMode } from "@/components/MapListToggle"
import { SegmentedPill } from "@/components/SegmentedPill"
import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import type { InPersonSortOrder, NearbyBannerReason } from "@/utils/nearbyLogic"

// ============================================================================
// List header
//
// A standalone component at module scope, NOT an inline `useCallback` — house
// rule (CLAUDE.md "Component Patterns"): a header identity that churns on every
// render makes FlatList remount it, which drops focus and scroll position.
// `observer()` per the same rule; it reads no store today, but keeping the
// wrapper means a future store read here reacts instead of silently going
// stale.
// ============================================================================

/** Amber accent shared with the reminder bell / approximate-location caveat. */
const BANNER_ACCENT = "#f59e0b"

export interface InPersonListHeaderProps {
  /** Translated weekday name for the day selector's value column */
  selectedDayLabel: string
  /** Bare distance ("25 mi") for the radius selector's value column */
  radiusLabel: string
  /** Translated "Within 25 mi" — screen-reader-only, see the a11y label below */
  radiusA11yLabel: string
  /** Translated bucket name ("Any time", "Evening") for the time selector */
  shortTimeLabel: string
  /** Non-null only in fallback mode (the hook enforces that) */
  bannerReason: NearbyBannerReason | null
  /** OS still allows a permission prompt — decides re-ask vs deep link to Settings */
  canAskAgain: boolean
  /**
   * ADDED 2026-08-08 (Task 7, dead-end-banner fix): true when the Settings →
   * Permissions location toggle is off. `useNearbySchedules`' short circuit
   * (see its header comment) means `bannerReason` reports "denied" in this
   * state too — the OS permission is untouched, only our own app-level gate
   * is off — so without this the banner would show the OS-denial copy over a
   * tap that silently does nothing (`requestLocation()` never reaches the OS
   * while the toggle is off). This is checked FIRST, ahead of every
   * `bannerReason` branch below, and overrides both the copy and the a11y
   * hint to match what tapping actually does: run the app-level gate.
   */
  locationDisabled: boolean
  showSpinner: boolean
  /**
   * ADDED 2026-09-05: true while a criteria change (day / radius / fellowship)
   * is refetching OVER rows that are still on screen. Distinct from
   * `showSpinner`, which is the first-load / locating state with no rows yet.
   * The count slot swaps to a small indicator while this is up, because the
   * old rows and the old count stay visible until the new response lands and
   * nothing else on screen moves — RefreshControl can't be trusted with a
   * programmatic reload (absent in map mode, a no-op on web, and a 250 ms
   * content-offset animation on iOS that a fast fetch beats). Pull-to-refresh
   * is excluded by the screen so its native spinner isn't doubled here.
   */
  isRefetching: boolean
  onOpenDay: () => void
  onOpenRadius: () => void
  onOpenShortTime: () => void
  onBannerPress: () => void
  /**
   * How many meetings the current filters actually yield.
   *
   * ADDED 2026-08-12: shown as a subtitle under the segment title. It answers
   * the question the map/list pill next to it raises — "is there anything in
   * there worth opening?" — without making the user switch views to find out.
   * It is also the one number that tells an empty-looking screen apart from a
   * screen that is still loading: `showSpinner` suppresses it, so a `0` here
   * always means zero results, never "not yet".
   */
  resultCount: number
  /** Render the list/map toggle (config kill switch + platform rule). Sits in
   * the controls row under the filter grid, left of the sort pill. */
  showMapToggle: boolean
  viewMode: InPersonViewMode
  /** Offline → disabled (spec Error handling #3) */
  mapToggleDisabled: boolean
  onToggleView: () => void
  /**
   * ADDED 2026-09-06: the Distance / Start sort pill, right half of the
   * controls row under the filter grid.
   * The screen shows it only in list mode AND nearby mode — the map has no
   * order, and fallback mode has nothing to order (since 2026-09-09 it is an
   * empty list; before that a distance-less day list), so a "Distance" half
   * there would promise an order it cannot deliver.
   */
  showSortToggle: boolean
  sortOrder: InPersonSortOrder
  onSelectSort: (order: InPersonSortOrder) => void
}

export const InPersonListHeader: FC<InPersonListHeaderProps> = observer(
  function InPersonListHeader({
    selectedDayLabel,
    radiusLabel,
    radiusA11yLabel,
    shortTimeLabel,
    bannerReason,
    canAskAgain,
    locationDisabled,
    showSpinner,
    isRefetching,
    onOpenDay,
    onOpenRadius,
    onOpenShortTime,
    onBannerPress,
    resultCount,
    showMapToggle,
    viewMode,
    mapToggleDisabled,
    onToggleView,
    showSortToggle,
    sortOrder,
    onSelectSort,
  }) {
    const { t } = useTranslation()
    const { themed, theme } = useAppTheme()

    // A permanently-denied user can't be re-prompted by the OS, so the copy has
    // to send them to Settings instead of implying a tap will ask again.
    // CHANGED 2026-08-04: "fixFailed" split out of what used to be a single
    // "location" reason. It means permission is granted and the fix didn't land
    // — telling that user to enable location is both wrong and unactionable, so
    // it gets the retry copy instead.
    // CHANGED 2026-08-08: `locationDisabled` is now checked first — see its doc
    // comment on InPersonListHeaderProps. It reuses `location:emptyNeedsLocation`
    // (the same copy the list's empty state shows) rather than a bannerReason
    // branch, because "denied" here doesn't mean what it normally means: the OS
    // never said no, our own toggle did.
    const bannerText = locationDisabled
      ? t("location:emptyNeedsLocation")
      : bannerReason === "nearbyFailed"
        ? t("inPersonScreen:nearbyFailedBanner")
        : bannerReason === "fixFailed"
          ? t("inPersonScreen:locationFixFailedBanner")
          : bannerReason === "denied"
            ? canAskAgain
              ? t("inPersonScreen:locationBanner")
              : t("inPersonScreen:locationBannerDenied")
            : ""

    // The banner text says *why* we're in fallback; the hint says what a tap will
    // actually do. Those are three different actions (refetch / re-prompt / deep
    // link to Settings) behind one control, so without a hint a screen-reader
    // user has no way to tell them apart. Branches must stay 1:1 with
    // handleBannerPress in InPersonScreen — if you add a route there, add a hint.
    // CHANGED 2026-08-08: added the `locationDisabled` branch alongside
    // handleBannerPress's matching one — a tap now runs the location gate, which
    // is the same action `doubleTapToAllowLocation` already describes for the OS
    // re-ask case, so it's reused rather than adding a new string.
    const bannerHint = locationDisabled
      ? t("accessibility:doubleTapToAllowLocation")
      : bannerReason === "nearbyFailed"
        ? t("accessibility:doubleTapToRetry")
        : bannerReason === "fixFailed"
          ? t("accessibility:doubleTapToRetry")
          : bannerReason === "denied"
            ? canAskAgain
              ? t("accessibility:doubleTapToAllowLocation")
              : t("accessibility:doubleTapToOpenSettings")
            : undefined

    return (
      <View>
        {/* Title row, matching LiveContent's and ListingsContent's headers so all
          three segments of the Meetings tab read the same.

          CHANGED 2026-08-12: the settings gear that used to close this row is
          gone from all three segments (it duplicated the Settings tab a
          thumb-width away). The map/list toggle inherited the slot.
          CHANGED 2026-09-07 (Jenova): the map/list toggle moved down to the
          controls row under the filter grid, beside the new sort pill, so the
          two pills sit as one family on one line. This row is now title + count
          only, which is the same shape as the Live and Search headers. */}
        <View style={themed($header)}>
          {/* Title + count stack together so the count reads as a subtitle of
            the heading rather than as a third control competing with the pill.
            Suppressed while `showSpinner` is up: a count rendered mid-fetch is
            a number that is about to be wrong, and "0 meetings" flashing
            before results land is worse than no count at all.
            CHANGED 2026-09-05: while `isRefetching`, the slot shows a small
            indicator instead of the (now stale) count — see the prop comment.
            It is sized to the subtitle's line height so the title row doesn't
            jump when the count comes back. */}
          <View style={$headerTitleGroup}>
            <Text preset="heading" tx="inPersonScreen:title" />
            {isRefetching ? (
              <View style={$resultCountLoading}>
                <ActivityIndicator
                  testID="result-count-loading"
                  size="small"
                  color={theme.colors.textDim}
                  accessibilityLabel={t("common:loading")}
                />
              </View>
            ) : (
              !showSpinner && (
                <Text style={themed($resultCount)} testID="result-count">
                  {t("inPersonScreen:resultCount", { count: resultCount })}
                </Text>
              )
            )}
          </View>
        </View>

        {/* Four filters in a 2×2 grid (Jenova, 2026-08-04). The three-selector
          layout this replaced put Time on its own full-width row, which stopped
          scaling once Fellowship arrived — four full-width rows would have
          pushed the first meeting off the fold on a small phone.

          Every value here is short by construction so a half-width cell can
          hold it: fellowship codes ("AA"), abbreviated weekdays ("Mon"), a bare
          distance ("25 mi"), and one-word time buckets. That last one is why
          the radius cell shows "25 mi" and not "Within 25 mi" — the label
          column already says Radius, and the longer phrasing truncated to
          "RadiusWith…", hiding the actual value. The full phrase survives for
          screen readers via `radiusA11yLabel`.

          Cell order is Fellowship / Radius on top, Day / Time below (Jenova,
          2026-08-03): the two "where" filters share the first row and the two
          "when" filters the second, so the grid groups by question rather than
          alternating them.

          Keep `numberOfLines={1}` on all four values — a value that wrapped
          under its own chevron reads as a layout bug. The *labels* are
          deliberately left free to wrap: at ~160dp per cell the long ones
          (de "Gemeinschaft", ru "Сообщество") can need two lines, and since
          $selectorRow stretches, that just makes the row taller with both
          cells still matching. Truncating a label would be worse.

          CHANGED 2026-09-26: Fellowship left this grid for the shared filter
          bar below the segment tabs (MeetingFilterBar). The remaining three cells
          fit one row, which gives the list back a row of height. */}
        <View style={themed($selectorRow)}>
          <TouchableOpacity
            style={themed($selectorButton)}
            onPress={onOpenRadius}
            accessibilityRole="button"
            accessibilityLabel={`${t("inPersonScreen:selectRadius")}, ${radiusA11yLabel}`}
          >
            <Text style={themed($selectorLabel)}>{t("inPersonScreen:selectRadius")}</Text>
            <View style={$selectorValueRow}>
              <Text style={themed($selectorValue)} numberOfLines={1}>
                {radiusLabel}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={themed($selectorButton)}
            onPress={onOpenDay}
            accessibilityRole="button"
            accessibilityLabel={`${t("listingsScreen:dayLabel")}, ${selectedDayLabel}`}
          >
            <Text style={themed($selectorLabel)}>{t("listingsScreen:dayLabel")}</Text>
            <View style={$selectorValueRow}>
              <Text style={themed($selectorValue)} numberOfLines={1}>
                {selectedDayLabel}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={themed($selectorButton)}
            onPress={onOpenShortTime}
            accessibilityRole="button"
            accessibilityLabel={`${t("inPersonScreen:shortTimeLabel")}, ${shortTimeLabel}`}
          >
            <Text style={themed($selectorLabel)}>{t("inPersonScreen:shortTimeLabel")}</Text>
            <View style={$selectorValueRow}>
              <Text style={themed($selectorValue)} numberOfLines={1}>
                {shortTimeLabel}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Controls row: list/map pill on the left, Distance/Start sort pill on
          the right. Both are SegmentedPill, so they read as one family.

          ADDED 2026-09-06 as the sort row, with a "Sort by" label on the left.
          CHANGED 2026-09-07 (Jenova): the list/map pill replaced that label.
          It used to close the title row, but "In-Person" plus a pill already
          spanned a small phone, and a second pill up there would have wrapped;
          two pills on their own line under the grid fit and sit flush with the
          grid's two columns. Rendered whenever EITHER pill has something to
          show — on the map the sort half is empty but the way back to the list
          must still be here, and in fallback mode the sort pill is hidden but
          the map one may not be. The map slot is a plain spacer when
          hidden so the sort pill still lands under the right column.
          CHANGED 2026-09-26: "the grid's two columns" above is stale — the
          selector grid lost its two-row/two-column shape when Fellowship
          moved out to the shared filter bar (see the CHANGED note on
          $selectorRow above); it's a single row of three cells now. This
          controls row still sits flush underneath it either way, so the
          layout claim stands even though the grid it's describing changed
          shape. */}
        {(showMapToggle || showSortToggle) && (
          <View style={themed($controlsRow)}>
            <View>
              {showMapToggle && (
                <MapListToggle
                  viewMode={viewMode}
                  disabled={mapToggleDisabled}
                  onToggle={onToggleView}
                />
              )}
            </View>
            {showSortToggle && (
              <SegmentedPill<InPersonSortOrder>
                value={sortOrder}
                // The visible "Sort by" label is gone, so this is the only
                // place a screen-reader user hears what the halves choose
                // between. Keep it.
                accessibilityLabel={t("inPersonScreen:sortBy")}
                options={[
                  {
                    value: "distance",
                    label: t("inPersonScreen:sortDistance"),
                    icon: "navigate-outline",
                  },
                  { value: "start", label: t("inPersonScreen:sortStart"), icon: "time-outline" },
                ]}
                onSelect={onSelectSort}
              />
            )}
          </View>
        )}

        {/* Fallback banner — slim, tappable, and the only place the user is told
          why the list isn't distance-sorted. Absent in nearby/locating modes.
          CHANGED 2026-08-08: `locationDisabled` is OR'd in here so the banner
          shows as soon as the toggle goes off, even in the window where
          `bannerReason` hasn't caught up yet — `useNearbySchedules`' internal
          `permission` state only flips to "denied" the next time it actually
          runs `acquireLocation` (a pull-to-refresh, a re-request), so a user
          who flips the toggle off and returns to an already-loaded segment
          without refreshing would otherwise see no banner at all over a stale,
          location-derived list. */}
        {(locationDisabled || !!bannerReason) && (
          <TouchableOpacity
            style={themed($banner)}
            onPress={onBannerPress}
            accessibilityRole="button"
            accessibilityLabel={bannerText}
            accessibilityHint={bannerHint}
          >
            <Ionicons
              // Only a denial (OS or app-level toggle) is a location-settings
              // problem; the other two bannerReasons are "try that again", and
              // the glyph should say which.
              name={
                locationDisabled || bannerReason === "denied"
                  ? "location-outline"
                  : "refresh-outline"
              }
              size={14}
              color={BANNER_ACCENT}
            />
            <Text style={themed($bannerText)}>{bannerText}</Text>
          </TouchableOpacity>
        )}

        {showSpinner && (
          <View style={themed($loadingContainer)}>
            <ActivityIndicator size="large" color={theme.colors.tint} />
          </View>
        )}
      </View>
    )
  },
)

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingHorizontal: spacing.md,
  paddingTop: spacing.md,
  paddingBottom: spacing.sm,
})

// Heading + result-count subtitle. `flexShrink` so a long localized count
// (ru "12 собраний") gives way to the pill rather than pushing it off-screen.
const $headerTitleGroup: ViewStyle = {
  flexShrink: 1,
}

const $selectorRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "stretch",
  marginHorizontal: spacing.md,
  marginVertical: spacing.sm,
  gap: spacing.sm,
})

// Same horizontal inset as `$selectorRow` so the two pills sit flush under the
// grid's two columns. No top margin: the grid row above already carries
// `marginVertical: spacing.sm`, which is the gap we want.
// CHANGED 2026-09-26: "the grid's two columns" is stale — Fellowship left the
// grid for the shared filter bar below the segment tabs, so `$selectorRow` is now
// one row of three cells (Radius / Day / Time), not a 2×2 grid. The shared
// horizontal inset is still the point: these two pills line up with that
// row's left and right edges either way.
const $controlsRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginHorizontal: spacing.md,
  marginBottom: spacing.sm,
})

const $selectorButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderRadius: 8,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
})

const $resultCount: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
  // `preset="heading"` above carries its own generous lineHeight; without this
  // the count floats away from the title instead of sitting under it.
  lineHeight: 16,
})

// Same 16px footprint as `$resultCount` so swapping the two doesn't reflow the
// title row. Left-aligned to sit where the count's first glyph would.
const $resultCountLoading: ViewStyle = {
  height: 16,
  justifyContent: "center",
  alignItems: "flex-start",
}

const $selectorLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})

const $selectorValueRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  flexShrink: 1,
}

const $selectorValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.tint,
  flexShrink: 1,
})

const $banner: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  marginHorizontal: spacing.md,
  marginBottom: spacing.sm,
  paddingHorizontal: spacing.sm,
  paddingVertical: spacing.xs,
  borderRadius: 8,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: BANNER_ACCENT,
})

const $bannerText: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  fontSize: 12,
  color: colors.textDim,
})

const $loadingContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xxl,
})
