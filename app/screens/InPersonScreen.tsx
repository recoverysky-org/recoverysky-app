/**
 * InPersonScreen — the In-Person segment of the Meetings tab.
 *
 * Nearest-first list via /schedules/nearby when we have a location fix, plain
 * day-browse (plus an explanatory banner) when we don't. All of the mode /
 * fetch / permission machinery lives in `useNearbySchedules`; this file is the
 * presentation layer and the analytics call sites.
 *
 * PRIVACY: nothing here may put a coordinate, a `distance_m`, or a directions
 * URL into `trackEvent` or a log call. The two events fired below carry a
 * weekday and a radius — display preferences, not position. See the header
 * comment in `app/hooks/useNearbySchedules.ts` for why the rule is about every
 * transport, not just log sites.
 */

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { DaySelectorModal, ISO_DAYS } from "@/components/DaySelectorModal"
import { InPersonPopup } from "@/components/InPersonPopup"
import { MeetingRow } from "@/components/MeetingRow"
import { Text } from "@/components/Text"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { useNearbySchedules } from "@/hooks/useNearbySchedules"
import { meetingHasReminder, useReminderLookup } from "@/hooks/useReminders"
import {
  consumePendingMeetingId,
  navigate,
  peekPendingMeetingId,
  usePendingMeetingId,
} from "@/navigators/navigationUtilities"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { ACTIVE_FELLOWSHIPS } from "@/utils/fellowships"
import {
  DEFAULT_SHORT_TIME,
  matchesShortTime,
  SHORT_TIME_OPTIONS,
  type ShortTime,
} from "@/utils/filterLogic"
import { logger } from "@/utils/logger"
import { formatDistance, RADIUS_OPTIONS_KM } from "@/utils/nearbyLogic"

const log = logger.child({ module: "InPersonScreen" })

/**
 * Translation key per bucket. A Record over the full `ShortTime` union rather
 * than a template string, so adding a bucket to SHORT_TIME_OPTIONS without a
 * label is a compile error instead of a `[missing key]` rendered on screen.
 */
const SHORT_TIME_TX: Record<ShortTime, string> = {
  all: "inPersonScreen:shortTimeAll",
  morning: "inPersonScreen:shortTimeMorning",
  afternoon: "inPersonScreen:shortTimeAfternoon",
  evening: "inPersonScreen:shortTimeEvening",
  overnight: "inPersonScreen:shortTimeOvernight",
}

// ============================================================================
// Radius selector modal
//
// Same chrome as DaySelectorModal, deliberately kept as its own copy rather
// than extracted: this screen is the only consumer, and ListingsScreen's three
// remaining modals still carry their own copies of these same constants (see
// the identical note at the bottom of DaySelectorModal.tsx). Extracting one of
// four copies would create a cross-file style dependency for no user value.
// ============================================================================

interface RadiusSelectorModalProps {
  visible: boolean
  /** Currently selected radius in kilometers */
  selectedKm: number
  /** Device locale uses miles — resolved once in useNearbySchedules */
  useMiles: boolean
  /** Called with the tapped radius; caller owns tracking + state */
  onSelect: (km: number) => void
  onClose: () => void
}

const RadiusSelectorModal: FC<RadiusSelectorModalProps> = ({
  visible,
  selectedKm,
  useMiles,
  onSelect,
  onClose,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={themed($modalOverlay)} onPress={onClose}>
        <View style={themed($modalContent)} accessibilityViewIsModal>
          <Text style={themed($modalTitle)}>{t("inPersonScreen:selectRadius")}</Text>
          {RADIUS_OPTIONS_KM.map((km) => {
            const isSelected = km === selectedKm
            // formatDistance takes meters; RADIUS_OPTIONS_KM is kilometers.
            const label = formatDistance(km * 1000, useMiles)
            return (
              <TouchableOpacity
                key={km}
                style={[themed($modalOption), isSelected && themed($modalOptionSelected)]}
                onPress={() => {
                  onSelect(km)
                  onClose()
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
              >
                <Text
                  style={[themed($modalOptionText), isSelected && themed($modalOptionTextSelected)]}
                >
                  {label}
                </Text>
                {isSelected && <Ionicons name="checkmark" size={18} color={theme.colors.tint} />}
              </TouchableOpacity>
            )
          })}
        </View>
      </Pressable>
    </Modal>
  )
}

// ============================================================================
// Time-of-day selector modal
//
// Same chrome as RadiusSelectorModal above, and kept as its own copy for the
// same reason documented there.
// ============================================================================

interface ShortTimeSelectorModalProps {
  visible: boolean
  selected: ShortTime
  /** Called with the tapped bucket; caller owns tracking + state */
  onSelect: (value: ShortTime) => void
  onClose: () => void
}

const ShortTimeSelectorModal: FC<ShortTimeSelectorModalProps> = ({
  visible,
  selected,
  onSelect,
  onClose,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={themed($modalOverlay)} onPress={onClose}>
        <View style={themed($modalContent)} accessibilityViewIsModal>
          <Text style={themed($modalTitle)}>{t("inPersonScreen:shortTimeLabel")}</Text>
          {SHORT_TIME_OPTIONS.map((option) => {
            const isSelected = option === selected
            return (
              <TouchableOpacity
                key={option}
                style={[themed($modalOption), isSelected && themed($modalOptionSelected)]}
                onPress={() => {
                  onSelect(option)
                  onClose()
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
              >
                <Text
                  style={[themed($modalOptionText), isSelected && themed($modalOptionTextSelected)]}
                >
                  {t(SHORT_TIME_TX[option])}
                </Text>
                {isSelected && <Ionicons name="checkmark" size={18} color={theme.colors.tint} />}
              </TouchableOpacity>
            )
          })}
        </View>
      </Pressable>
    </Modal>
  )
}

// ============================================================================
// Fellowship selector modal
//
// Mirrors LiveContent's fellowship picker (same options, same "browsing isn't
// a preference change" semantics) and shares this file's modal chrome. There
// is deliberately no "All" option — LiveContent's picker has none either, and
// here it would be worse than cosmetic: the nearby/daily endpoints filter by
// fellowship server-side, so "all" would mean an unfiltered fetch of every
// fellowship's meetings rather than a client-side widening.
// ============================================================================

interface FellowshipSelectorModalProps {
  visible: boolean
  /** Undefined when the user has never picked one — no row is checked */
  selected?: string
  /** Called with the tapped fellowship; caller owns tracking + state */
  onSelect: (value: string) => void
  onClose: () => void
}

const FellowshipSelectorModal: FC<FellowshipSelectorModalProps> = ({
  visible,
  selected,
  onSelect,
  onClose,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={themed($modalOverlay)} onPress={onClose}>
        <View style={themed($modalContent)} accessibilityViewIsModal>
          <Text style={themed($modalTitle)}>{t("settingsScreen:selectFellowship")}</Text>
          {ACTIVE_FELLOWSHIPS.map((value) => {
            const isSelected = value === selected
            return (
              <TouchableOpacity
                key={value}
                style={[themed($modalOption), isSelected && themed($modalOptionSelected)]}
                onPress={() => {
                  onSelect(value)
                  onClose()
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={value}
              >
                <Text
                  style={[themed($modalOptionText), isSelected && themed($modalOptionTextSelected)]}
                >
                  {value}
                </Text>
                {isSelected && <Ionicons name="checkmark" size={18} color={theme.colors.tint} />}
              </TouchableOpacity>
            )
          })}
        </View>
      </Pressable>
    </Modal>
  )
}

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

interface InPersonListHeaderProps {
  /** Fellowship code ("AA") for the fellowship selector's value column */
  fellowshipLabel: string
  /** Translated weekday name for the day selector's value column */
  selectedDayLabel: string
  /** Bare distance ("25 mi") for the radius selector's value column */
  radiusLabel: string
  /** Translated "Within 25 mi" — screen-reader-only, see the a11y label below */
  radiusA11yLabel: string
  /** Translated bucket name ("Any time", "Evening") for the time selector */
  shortTimeLabel: string
  /** Non-null only in fallback mode (the hook enforces that) */
  bannerReason: "location" | "nearbyFailed" | null
  /** OS still allows a permission prompt — decides re-ask vs deep link to Settings */
  canAskAgain: boolean
  showSpinner: boolean
  onOpenFellowship: () => void
  onOpenDay: () => void
  onOpenRadius: () => void
  onOpenShortTime: () => void
  onBannerPress: () => void
}

const InPersonListHeader: FC<InPersonListHeaderProps> = observer(function InPersonListHeader({
  fellowshipLabel,
  selectedDayLabel,
  radiusLabel,
  radiusA11yLabel,
  shortTimeLabel,
  bannerReason,
  canAskAgain,
  showSpinner,
  onOpenFellowship,
  onOpenDay,
  onOpenRadius,
  onOpenShortTime,
  onBannerPress,
}) {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()

  // A permanently-denied user can't be re-prompted by the OS, so the copy has
  // to send them to Settings instead of implying a tap will ask again.
  const bannerText =
    bannerReason === "nearbyFailed"
      ? t("inPersonScreen:nearbyFailedBanner")
      : bannerReason === "location"
        ? canAskAgain
          ? t("inPersonScreen:locationBanner")
          : t("inPersonScreen:locationBannerDenied")
        : ""

  // The banner text says *why* we're in fallback; the hint says what a tap will
  // actually do. Those are three different actions (refetch / re-prompt / deep
  // link to Settings) behind one control, so without a hint a screen-reader
  // user has no way to tell them apart. Branches must stay 1:1 with
  // handleBannerPress in InPersonScreen — if you add a route there, add a hint.
  const bannerHint =
    bannerReason === "nearbyFailed"
      ? t("accessibility:doubleTapToRetry")
      : bannerReason === "location"
        ? canAskAgain
          ? t("accessibility:doubleTapToAllowLocation")
          : t("accessibility:doubleTapToOpenSettings")
        : undefined

  return (
    <View>
      {/* Title + settings gear, matching LiveContent's and ListingsContent's
          headers so all three segments of the Meetings tab read the same. */}
      <View style={themed($header)}>
        <Text preset="heading" tx="inPersonScreen:title" />
        <TouchableOpacity
          onPress={() => navigate("Settings" as never, { section: "profile" } as never)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("mainNavigator:settingsTab")}
        >
          <Ionicons name="settings-outline" size={22} color={theme.colors.textDim} />
        </TouchableOpacity>
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

          Keep `numberOfLines={1}` on all four values — a value that wrapped
          under its own chevron reads as a layout bug. The *labels* are
          deliberately left free to wrap: at ~160dp per cell the long ones
          (de "Gemeinschaft", ru "Сообщество") can need two lines, and since
          $selectorRow stretches, that just makes the row taller with both
          cells still matching. Truncating a label would be worse. */}
      <View style={themed($selectorRow)}>
        <TouchableOpacity
          style={themed($selectorButton)}
          onPress={onOpenFellowship}
          accessibilityRole="button"
          accessibilityLabel={`${t("inPersonScreen:fellowshipLabel")}, ${fellowshipLabel}`}
        >
          <Text style={themed($selectorLabel)}>{t("inPersonScreen:fellowshipLabel")}</Text>
          <View style={$selectorValueRow}>
            <Text style={themed($selectorValue)} numberOfLines={1}>
              {fellowshipLabel}
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

      <View style={themed($selectorRow)}>
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
      </View>

      {/* Fallback banner — slim, tappable, and the only place the user is told
          why the list isn't distance-sorted. Absent in nearby/locating modes. */}
      {!!bannerReason && (
        <TouchableOpacity
          style={themed($banner)}
          onPress={onBannerPress}
          accessibilityRole="button"
          accessibilityLabel={bannerText}
          accessibilityHint={bannerHint}
        >
          <Ionicons
            name={bannerReason === "nearbyFailed" ? "refresh-outline" : "location-outline"}
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
})

// ============================================================================
// Screen
// ============================================================================

/**
 * InPersonContent - In-person meetings: nearest-first via /schedules/nearby,
 * day-browse fallback without location. Composed into MeetingsScreen as the
 * middle segment (2026-08-03 in-person UI spec).
 *
 * `active` flips true the first time the user opens the segment — location
 * permission is requested lazily off it, never at app start.
 *
 * `observer()` is LOAD-BEARING and its absence fails silently: `useNearbySchedules`
 * reads `configStore.maintenanceMode` and `profileStore.fellowship` during
 * render specifically so MobX tracks them for this component. Unwrapped, the
 * local controls (day, radius) keep working while the maintenance-exit refetch
 * and the fellowship-change refetch just stop happening — the screen still
 * looks fine, so nobody notices. Do not remove it.
 * CHANGED 2026-08-04: this component no longer calls `useProfileStore()` itself
 * (the Fellowship picker reads the effective value off the hook instead), so
 * there is now NO store access visible in this file at all — which makes the
 * `observer()` above look even more removable than it did before. It isn't.
 */
export const InPersonContent: FC<{ active: boolean }> = observer(function InPersonContent({
  active,
}) {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const reminderLookup = useReminderLookup()

  const {
    mode,
    meetings,
    isLoading,
    error,
    bannerReason,
    selectedDay,
    setSelectedDay,
    radiusKm,
    setRadiusKm,
    fellowship,
    setFellowship,
    useMiles,
    refresh,
    requestLocation,
    canAskAgain,
  } = useNearbySchedules(active)

  const [dayModalVisible, setDayModalVisible] = useState(false)
  const [radiusModalVisible, setRadiusModalVisible] = useState(false)
  const [shortTimeModalVisible, setShortTimeModalVisible] = useState(false)
  const [fellowshipModalVisible, setFellowshipModalVisible] = useState(false)
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingWithTrex | null>(null)

  // Deliberately NOT persisted, unlike radius. Day and time are per-visit browse
  // choices: coming back tomorrow to a list silently narrowed to "Overnight" by
  // a tap you made last week is the kind of unexplained-empty-list confusion
  // this filter is supposed to relieve, not cause.
  const [shortTime, setShortTime] = useState<ShortTime>(DEFAULT_SHORT_TIME)

  // Segment-view analytics, once per activation. `active` only ever flips
  // false→true (MeetingsScreen latches it), so this fires exactly once per
  // mount rather than on every segment switch.
  useEffect(() => {
    if (active) trackEvent("inperson_segment_viewed")
  }, [active])

  // ---------------------------------------------------------------------------
  // Paywall return → InPersonPopup auto-open
  //
  // The premium gate in InPersonPopup.handleCellPress sends the user to the
  // paywall with `returnTo: "Meetings:inperson:meetingId:<id>"`. On a
  // successful purchase, SettingsScreen.navigateReturn() parks that id in the
  // module-level pending store under the "inperson" target and navigates back
  // here. Reopening the popup means the reminder they just paid to create is
  // one tap away instead of a re-navigation away.
  //
  // Same peek/consume shape as LiveContent's notification handler, and the
  // same store — the "inperson" target is what stops LiveContent, which is
  // mounted at the same time, from swallowing this id.
  //
  // Unlike LiveContent there is deliberately no API slow path. The only
  // producer is the paywall round-trip, which leaves this component mounted
  // with its list intact, so the meeting is effectively always in `meetings`.
  // If it somehow isn't, give up once loading settles rather than hold the id
  // forever — the user still lands on the right segment, which is already the
  // behavior this fix was written to restore.
  // ---------------------------------------------------------------------------
  const pendingMeetingId = usePendingMeetingId("inperson")
  const consumedMeetingIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const targetId = peekPendingMeetingId("inperson")
    if (!targetId || targetId === consumedMeetingIdRef.current) return

    const found = meetings.find((m) => m.id === targetId)
    if (found) {
      consumedMeetingIdRef.current = targetId
      consumePendingMeetingId()
      setSelectedMeeting(found)
      return
    }
    // Still fetching — leave the id parked so the next list lands it.
    if (isLoading) return

    log.warn("Pending in-person meeting not in the current list; dropping", {
      meetingId: targetId,
    })
    consumedMeetingIdRef.current = targetId
    consumePendingMeetingId()
  }, [pendingMeetingId, meetings, isLoading])

  // ISO_DAYS always covers 1..7 and selectedDay is derived from a Date, so the
  // lookup can't miss — the ternary just avoids a non-null assertion on the
  // find() result rather than guarding a case that can actually happen.
  const selectedDayEntry = ISO_DAYS.find((d) => d.iso === selectedDay)
  const selectedDayLabel = selectedDayEntry ? t(selectedDayEntry.tx) : ""
  const radiusDistance = formatDistance(radiusKm * 1000, useMiles)
  // Visible value is the bare distance; the "Within …" phrasing is kept for the
  // screen reader only (see the grid comment in InPersonListHeader).
  const radiusA11yLabel = t("inPersonScreen:withinRadius", { distance: radiusDistance })
  const shortTimeLabel = t(SHORT_TIME_TX[shortTime])
  // An em dash, not the ProfileStore default: the user genuinely has no
  // fellowship set here, and showing "AA" would claim a filter that isn't
  // applied — the hook fetches nothing at all until one is chosen.
  const fellowshipLabel = fellowship || "—"

  // Client-side only: the time bucket never reaches the API. `/schedules/nearby`
  // and the day-browse fallback both return a whole day, so narrowing here costs
  // one pass over an already-fetched list and — unlike day or radius — triggers
  // no refetch. Keep `meetings` (unfiltered) around: the empty state and the
  // paywall-return popup both need to know what the day actually holds.
  const visibleMeetings = useMemo(
    () =>
      shortTime === DEFAULT_SHORT_TIME
        ? meetings
        : meetings.filter((m) => matchesShortTime(m.millis, shortTime)),
    [meetings, shortTime],
  )

  const handleDaySelect = useCallback(
    (day: number) => {
      setSelectedDay(day)
      // PRIVACY: a weekday is not location data. Never add distance/coords here.
      trackEvent("inperson_day_changed", { day })
    },
    [setSelectedDay],
  )

  const handleRadiusSelect = useCallback(
    (km: number) => {
      setRadiusKm(km)
      // PRIVACY: a search radius is a display preference, not a position.
      trackEvent("inperson_radius_changed", { km })
    },
    [setRadiusKm],
  )

  const handleShortTimeSelect = useCallback((value: ShortTime) => {
    setShortTime(value)
    // PRIVACY: a time-of-day bucket is a display preference, not a position.
    trackEvent("inperson_shorttime_changed", { shortTime: value })
  }, [])

  const handleFellowshipSelect = useCallback(
    (value: string) => {
      // Browse-only — `setFellowship` writes to the hook's local override, not
      // to ProfileStore, so Settings and the Live tab are left alone.
      setFellowship(value)
      // PRIVACY: a fellowship code is a display preference, not a position.
      trackEvent("inperson_fellowship_changed", { fellowship: value })
    },
    [setFellowship],
  )

  const handleOpenDayModal = useCallback(() => setDayModalVisible(true), [])
  const handleOpenRadiusModal = useCallback(() => setRadiusModalVisible(true), [])
  const handleOpenShortTimeModal = useCallback(() => setShortTimeModalVisible(true), [])
  const handleOpenFellowshipModal = useCallback(() => setFellowshipModalVisible(true), [])

  /**
   * Banner tap routes three ways:
   * - nearby fetch failed → just retry the fetch
   * - location off, OS will still prompt → re-request permission
   * - location permanently denied → `requestLocation()` would resolve without
   *   ever showing a dialog, so send the user to the OS Settings page instead.
   */
  const handleBannerPress = useCallback(() => {
    if (bannerReason === "nearbyFailed") {
      void refresh()
      return
    }
    if (canAskAgain) {
      void requestLocation()
      return
    }
    // `.catch` rather than `void`: openSettings rejects on Android when no
    // activity can handle the intent, and an unhandled rejection here would
    // reach the global handler and ship a bogus error to Loki + Sentry. The
    // user just sees the banner do nothing, which is the same outcome as a
    // silent failure — matches the guarded Linking calls in InPersonPopup.
    Linking.openSettings().catch(() => {})
  }, [bannerReason, canAskAgain, refresh, requestLocation])

  const handleClosePopup = useCallback(() => setSelectedMeeting(null), [])

  const renderItem = useCallback(
    ({ item }: { item: MeetingWithTrex }) => (
      <MeetingRow
        meeting={item}
        // Distance badge only in nearby mode: the day-browse fallback's rows
        // carry no `distance_m`, and formatDistance returns "" for undefined —
        // `|| undefined` keeps the row from rendering an empty badge.
        distanceLabel={
          mode === "nearby" ? formatDistance(item.distance_m, useMiles) || undefined : undefined
        }
        hasReminder={meetingHasReminder(item, reminderLookup)}
        onPress={setSelectedMeeting}
      />
    ),
    [mode, useMiles, reminderLookup],
  )

  const keyExtractor = useCallback((item: MeetingWithTrex) => item.id, [])

  const ItemSeparatorComponent = useCallback(() => <View style={themed($separator)} />, [themed])

  const ListEmptyComponent = useCallback(() => {
    // Order matters: "you haven't picked a fellowship" outranks any error or
    // empty copy, because the hook treats no-fellowship as a legitimate state
    // that never even issues a request.
    // CHANGED 2026-08-04: the copy used to send the user to Settings and the
    // message wasn't tappable. Now that the header carries a Fellowship picker,
    // pointing at Settings would route them past the control that's already on
    // screen — so this opens that picker instead.
    if (!fellowship) {
      return (
        <Pressable
          style={themed($emptyContainer)}
          onPress={handleOpenFellowshipModal}
          accessibilityRole="button"
        >
          <Text style={themed($emptyText)}>{t("inPersonScreen:selectFellowship")}</Text>
        </Pressable>
      )
    }
    if (error) {
      return (
        <View style={themed($emptyContainer)}>
          <Text style={themed($errorText)}>{error}</Text>
        </View>
      )
    }
    // The time filter emptied a day that DOES have meetings. This has to
    // outrank both branches below, because their copy blames the radius or the
    // fellowship and the radius one opens the radius picker — sending the user
    // to widen a search that was never the problem. Only reachable when the
    // unfiltered day is non-empty; when the day is genuinely empty we fall
    // through so the real reason still gets named.
    if (shortTime !== DEFAULT_SHORT_TIME && meetings.length > 0) {
      return (
        <Pressable
          style={themed($emptyContainer)}
          onPress={handleOpenShortTimeModal}
          accessibilityRole="button"
        >
          <Text style={themed($emptyText)}>
            {t("inPersonScreen:emptyShortTime", {
              day: selectedDayLabel,
              time: shortTimeLabel,
            })}
          </Text>
        </Pressable>
      )
    }
    if (mode === "nearby") {
      // Tappable: the copy tells the user to try a wider radius, so the whole
      // message opens the radius picker rather than making them hunt for it.
      return (
        <Pressable
          style={themed($emptyContainer)}
          onPress={handleOpenRadiusModal}
          accessibilityRole="button"
        >
          <Text style={themed($emptyText)}>
            {t("inPersonScreen:emptyNearby", {
              distance: radiusDistance,
              day: selectedDayLabel,
            })}
          </Text>
        </Pressable>
      )
    }
    return (
      <View style={themed($emptyContainer)}>
        <Text style={themed($emptyText)}>
          {t("inPersonScreen:emptyFallback", {
            fellowship,
            day: selectedDayLabel,
          })}
        </Text>
      </View>
    )
  }, [
    themed,
    t,
    fellowship,
    error,
    mode,
    radiusDistance,
    selectedDayLabel,
    handleOpenRadiusModal,
    shortTime,
    shortTimeLabel,
    meetings.length,
    handleOpenShortTimeModal,
    handleOpenFellowshipModal,
  ])

  // While we're waiting on a permission dialog / GPS fix, or on the very first
  // fetch, show a spinner instead of an empty-state message that would be
  // wrong a second later. RefreshControl owns the spinner once rows exist.
  const showSpinner = mode === "locating" || (isLoading && meetings.length === 0)

  return (
    <View style={$screenContainer}>
      <FlatList
        data={visibleMeetings}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={
          <InPersonListHeader
            fellowshipLabel={fellowshipLabel}
            selectedDayLabel={selectedDayLabel}
            radiusLabel={radiusDistance}
            radiusA11yLabel={radiusA11yLabel}
            shortTimeLabel={shortTimeLabel}
            bannerReason={bannerReason}
            canAskAgain={canAskAgain}
            showSpinner={showSpinner}
            onOpenFellowship={handleOpenFellowshipModal}
            onOpenDay={handleOpenDayModal}
            onOpenRadius={handleOpenRadiusModal}
            onOpenShortTime={handleOpenShortTimeModal}
            onBannerPress={handleBannerPress}
          />
        }
        ItemSeparatorComponent={ItemSeparatorComponent}
        ListEmptyComponent={showSpinner ? null : ListEmptyComponent}
        contentContainerStyle={themed($listContent)}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && meetings.length > 0}
            onRefresh={refresh}
            tintColor={theme.colors.tint}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      <DaySelectorModal
        visible={dayModalVisible}
        selectedDay={selectedDay}
        onSelect={handleDaySelect}
        onClose={() => setDayModalVisible(false)}
      />

      <RadiusSelectorModal
        visible={radiusModalVisible}
        selectedKm={radiusKm}
        useMiles={useMiles}
        onSelect={handleRadiusSelect}
        onClose={() => setRadiusModalVisible(false)}
      />

      <ShortTimeSelectorModal
        visible={shortTimeModalVisible}
        selected={shortTime}
        onSelect={handleShortTimeSelect}
        onClose={() => setShortTimeModalVisible(false)}
      />

      <FellowshipSelectorModal
        visible={fellowshipModalVisible}
        selected={fellowship}
        onSelect={handleFellowshipSelect}
        onClose={() => setFellowshipModalVisible(false)}
      />

      <InPersonPopup
        visible={selectedMeeting !== null}
        meeting={selectedMeeting}
        onClose={handleClosePopup}
      />
    </View>
  )
})

// ============================================================================
// Styles
//
// Selector / modal / list styles mirror ListingsScreen's so the three Meetings
// segments stay visually identical; see the note on RadiusSelectorModal above
// for why they're copied rather than shared.
// ============================================================================

const $screenContainer: ViewStyle = {
  flex: 1,
}

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingHorizontal: spacing.md,
  paddingTop: spacing.md,
  paddingBottom: spacing.sm,
})

const $selectorRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "stretch",
  marginHorizontal: spacing.md,
  marginVertical: spacing.sm,
  gap: spacing.sm,
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

const $listContent: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.xl,
  flexGrow: 1,
})

const $separator: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: 1,
  backgroundColor: colors.border,
  opacity: 0.5,
})

const $emptyContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.xxl,
})

const $emptyText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 16,
  textAlign: "center",
})

const $errorText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.error,
  fontSize: 16,
  textAlign: "center",
})

const $loadingContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xxl,
})

const $modalOverlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.5)",
  justifyContent: "center",
  alignItems: "center",
})

const $modalContent: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderRadius: 12,
  padding: spacing.md,
  minWidth: 200,
  maxWidth: "80%",
  maxHeight: "70%",
})

const $modalTitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 18,
  fontWeight: "700",
  color: colors.text,
  marginBottom: spacing.md,
  textAlign: "center",
})

const $modalOption: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.sm,
  borderRadius: 8,
})

const $modalOptionSelected: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
})

const $modalOptionText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
})

const $modalOptionTextSelected: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontWeight: "600",
})
