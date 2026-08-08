/**
 * InPersonScreen — the In-Person segment of the Meetings tab.
 *
 * Nearest-first list via /schedules/nearby when we have a location fix, plain
 * day-browse (plus an explanatory banner) when we don't. All of the mode /
 * fetch / permission machinery lives in `useNearbySchedules`; this file is the
 * presentation layer and the analytics call sites.
 *
 * PRIVACY: nothing here may put a coordinate, a `distance_m`, or a directions
 * URL into `trackEvent` or a log call. Every event fired below carries a
 * display preference — a weekday, a radius, a time bucket, a fellowship code,
 * a list/map choice — never a position. See the header comment in
 * `app/hooks/useNearbySchedules.ts` for why the rule is about every transport,
 * not just log sites.
 * CHANGED 2026-08-07 (map view): the sentence above used to say "the two
 * events fired below carry a weekday and a radius", which had already gone
 * stale as filters were added and would have gone staler again here. It is
 * phrased as a rule over all events now rather than an enumeration that has
 * to be maintained. This screen also gained `getCoords` — the hook's accessor
 * into its coords ref — which it passes STRAIGHT THROUGH to InPersonMapView
 * as `getSearchCenter` and never calls itself; the fix must not be read into
 * a variable, a prop value, state, or an event here.
 */

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { DaySelectorModal, ISO_DAYS } from "@/components/DaySelectorModal"
import { InPersonMapView } from "@/components/InPersonMapView"
import { InPersonPopup } from "@/components/InPersonPopup"
import { MapListToggle, type InPersonViewMode } from "@/components/MapListToggle"
import { MeetingRow } from "@/components/MeetingRow"
import { Text } from "@/components/Text"
import { useToast } from "@/components/Toast"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { feedbackCache, type FeedbackRecord } from "@/db"
import { useNearbySchedules } from "@/hooks/useNearbySchedules"
import { meetingHasReminder, useReminderLookup } from "@/hooks/useReminders"
import { useConfigStore, useNetworkStore } from "@/models"
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
import { shouldShowMapToggle } from "@/utils/inPersonMapLogic"
import { logger } from "@/utils/logger"
import { formatDistance, type NearbyBannerReason, RADIUS_OPTIONS_KM } from "@/utils/nearbyLogic"
import { loadString, saveString } from "@/utils/storage"

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

/** MMKV key for the persisted list/map choice (a display preference, NOT
 * location data — same class as inperson.radius). */
const VIEW_MODE_STORAGE_KEY = "inperson.viewMode"

const loadViewMode = (): InPersonViewMode =>
  loadString(VIEW_MODE_STORAGE_KEY) === "map" ? "map" : "list"

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
  bannerReason: NearbyBannerReason | null
  /** OS still allows a permission prompt — decides re-ask vs deep link to Settings */
  canAskAgain: boolean
  showSpinner: boolean
  onOpenFellowship: () => void
  onOpenDay: () => void
  onOpenRadius: () => void
  onOpenShortTime: () => void
  onBannerPress: () => void
  /** Render the list/map toggle (config kill switch + platform rule) */
  showMapToggle: boolean
  viewMode: InPersonViewMode
  /** Offline → disabled (spec Error handling #3) */
  mapToggleDisabled: boolean
  onToggleView: () => void
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
  showMapToggle,
  viewMode,
  mapToggleDisabled,
  onToggleView,
}) {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()

  // A permanently-denied user can't be re-prompted by the OS, so the copy has
  // to send them to Settings instead of implying a tap will ask again.
  // CHANGED 2026-08-04: "fixFailed" split out of what used to be a single
  // "location" reason. It means permission is granted and the fix didn't land
  // — telling that user to enable location is both wrong and unactionable, so
  // it gets the retry copy instead.
  const bannerText =
    bannerReason === "nearbyFailed"
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
  const bannerHint =
    bannerReason === "nearbyFailed"
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
      {/* Title + settings gear, matching LiveContent's and ListingsContent's
          headers so all three segments of the Meetings tab read the same. */}
      <View style={themed($header)}>
        <Text preset="heading" tx="inPersonScreen:title" />
        {/* The toggle sits to the LEFT of the gear so the gear stays the
            right-most control here, as it is in Live's and Search's headers —
            the three segments share this row and muscle memory for it. */}
        <View style={$headerActions}>
          {showMapToggle && (
            <MapListToggle
              viewMode={viewMode}
              disabled={mapToggleDisabled}
              onToggle={onToggleView}
            />
          )}
          <TouchableOpacity
            onPress={() => navigate("Settings" as never, { section: "profile" } as never)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("mainNavigator:settingsTab")}
          >
            <Ionicons name="settings-outline" size={22} color={theme.colors.textDim} />
          </TouchableOpacity>
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
            // Only a denial is a location-settings problem; the other two
            // reasons are "try that again", and the glyph should say which.
            name={bannerReason === "denied" ? "location-outline" : "refresh-outline"}
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

interface InPersonContentProps {
  /**
   * Latch: true from the first time the user opens the In-Person segment,
   * never false again. Owns the lazy-location contract — see below.
   */
  active: boolean
  /**
   * Live: true only while In-Person is the segment actually on screen.
   * ADDED 2026-08-08 for the map. Deliberately separate from `active` because
   * the two answer different questions, and using either one for the other's
   * job is a real bug in both directions: gating the data hook on `visible`
   * would tear down location/fetch state on every segment switch, and gating
   * the map on `active` leaves a GL surface alive inside a `display: "none"`
   * view for the rest of the session.
   */
  visible: boolean
}

/**
 * InPersonContent - In-person meetings: nearest-first via /schedules/nearby,
 * day-browse fallback without location. Composed into MeetingsScreen as the
 * middle segment (2026-08-03 in-person UI spec).
 *
 * `active` flips true the first time the user opens the segment — location
 * permission is requested lazily off it, never at app start. `visible` is the
 * live companion to that latch: it is true only while In-Person is the
 * on-screen segment. Everything that should survive a segment switch keys off
 * `active`; only the map subtree keys off `visible` (see `effectiveViewMode`).
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
 * CHANGED 2026-08-07 (map view): there IS visible store access again —
 * `useConfigStore()` for the two map style URLs (the remote kill switch) and
 * `useNetworkStore()` for the offline-disabled toggle. Both are read in the
 * body below rather than in `InPersonListHeader`, which takes them as plain
 * props: the header is a module-scope component whose identity must not churn,
 * and keeping every store read on this side means one component to reason
 * about when asking why something did or didn't re-render.
 */
export const InPersonContent: FC<InPersonContentProps> = observer(function InPersonContent({
  active,
  visible,
}) {
  const { t } = useTranslation()
  const { themed, theme, themeContext } = useAppTheme()
  const reminderLookup = useReminderLookup()
  const { showToast } = useToast()
  // Read inside this observed component so MobX tracks them — the map toggle's
  // visibility and its offline-disabled state both have to react. See the
  // `observer()` note above: this file's store reads must all live in here.
  const configStore = useConfigStore()
  const networkStore = useNetworkStore()

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
    // PRIVACY: passed straight through to InPersonMapView's `getSearchCenter`
    // and never called in this file. Calling it here would put a coordinate in
    // a local — see this file's header.
    getCoords,
  } = useNearbySchedules(active)

  const [dayModalVisible, setDayModalVisible] = useState(false)
  const [radiusModalVisible, setRadiusModalVisible] = useState(false)
  const [shortTimeModalVisible, setShortTimeModalVisible] = useState(false)
  const [fellowshipModalVisible, setFellowshipModalVisible] = useState(false)
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingWithTrex | null>(null)

  const [viewMode, setViewModeState] = useState<InPersonViewMode>(loadViewMode)
  /** Meetings at a multi-meeting venue pin awaiting a chooser pick */
  const [venueMeetings, setVenueMeetings] = useState<MeetingWithTrex[]>([])

  const setViewMode = useCallback((next: InPersonViewMode) => {
    setViewModeState(next)
    saveString(VIEW_MODE_STORAGE_KEY, next)
  }, [])

  /**
   * Session-only "the map didn't load" override. NOT persisted, and that is the
   * entire point: a style/tile load failure is usually transient (flaky
   * network, a momentary MapTiler hiccup), and `setViewMode` writes through to
   * MMKV — so routing handleMapFailed through it silently and permanently
   * rewrote the user's saved preference to "list". They were never told, and on
   * the next launch they were on the list with no memory of ever having chosen
   * the map. Cleared by handleToggleView so tapping back to map is a real
   * retry rather than a no-op.
   */
  const [mapFailedThisSession, setMapFailedThisSession] = useState(false)

  const showMapToggle = shouldShowMapToggle({
    platform: Platform.OS,
    styleUrlLight: configStore.mapStyleUrlLight,
    styleUrlDark: configStore.mapStyleUrlDark,
  })
  const mapStyleUrl =
    themeContext === "dark" ? configStore.mapStyleUrlDark : configStore.mapStyleUrlLight

  // A persisted "map" preference must degrade to the list whenever the toggle
  // isn't actually available — a fresh launch against a server that no longer
  // sends the style URLs (ConfigStore isn't persisted; on relaunch it's simply
  // reconstructed with empty defaults, so the URLs are absent until the next
  // successful /config fetch), or a platform where the map can't render at all
  // (web). Without this the user would restore straight into a blank area with
  // no way back, because the control that would take them there isn't rendered
  // either.
  // Note this is a LAUNCH-time and availability-time degrade, not a mid-session
  // one: ConfigStore only assigns the URLs when the incoming values are truthy,
  // so a /config poll that CLEARS them cannot switch the feature off until the
  // next cold start.
  //
  // `active` is also required, and is NOT redundant with the persisted
  // preference: MeetingsScreen mounts all three segments from app start and
  // hides the inactive ones with `display: "none"` (see the comment there).
  // Without gating on `active`, a user who toggled to map on some earlier visit
  // would get `effectiveViewMode === "map"` on every later cold start even
  // while sitting on the Live segment — mounting <InPersonMapView> (a MapLibre
  // GL surface plus a native <NativeUserLocation /> location consumer) inside a
  // hidden view for a segment they never opened. `useNearbySchedules` honors
  // the `active` latch, but the map's native location path does not go through
  // that hook, so this conjunct is the only thing gating it. `active` latches
  // true on first open and never reverts to false, so this only changes
  // behavior before the segment's first activation.
  //
  // CHANGED 2026-08-08: the sentence that used to end the paragraph above —
  // "it does not affect the map once the user has actually opened In-Person" —
  // was accurate and was the bug. `active` closed the cold-start hole and left
  // the post-activation half wide open: once In-Person had been opened in map
  // mode, switching to Live/Search (or another tab) left the MapLibre GL
  // surface and <NativeUserLocation /> mounted inside the `display: "none"`
  // view for the rest of the session, with no user action short of a force-quit
  // to unmount them. `visible` is the live value MeetingsScreen already has,
  // threaded in alongside the latch so that ONLY the map subtree comes down on
  // a segment switch — `useNearbySchedules` still keys off `active`, because
  // its location/fetch state machine is exactly the thing that must survive.
  // Returning to the segment remounts the map and re-fits the camera, which is
  // already the documented behavior of every list→map toggle.
  //
  // `!mapFailedThisSession` is the session-only fallback described at that
  // state's definition above: a failed style load drops us to the list for this
  // session without touching the persisted preference.
  const effectiveViewMode: InPersonViewMode =
    viewMode === "map" && showMapToggle && active && visible && !mapFailedThisSession
      ? "map"
      : "list"

  // Deliberately NOT persisted, unlike radius. Day and time are per-visit browse
  // choices: coming back tomorrow to a list silently narrowed to "Overnight" by
  // a tap you made last week is the kind of unexplained-empty-list confusion
  // this filter is supposed to relieve, not cause.
  const [shortTime, setShortTime] = useState<ShortTime>(DEFAULT_SHORT_TIME)

  // ---------------------------------------------------------------------------
  // Live feedback, for DISPLAY only — never for sorting (2026-08-04)
  //
  // Same split Live and Search use, and the split is the point: the heart and
  // stars on a row must update the instant the user taps them in the popup,
  // but the ORDER must not. `useNearbySchedules` stamps a feedback snapshot at
  // fetch time and sorts on that, so a row can never reorder itself out from
  // under the finger that's touching it. It settles into its new position on
  // the next refresh, which is what Live has always done.
  // ---------------------------------------------------------------------------
  const [displayFeedback, setDisplayFeedback] = useState<Map<string, FeedbackRecord>>(() =>
    feedbackCache.getAll(),
  )

  useEffect(() => {
    const unsubscribe = feedbackCache.subscribe((mid, feedback) => {
      setDisplayFeedback((prev) => {
        const next = new Map(prev)
        next.set(mid, feedback)
        return next
      })
    })
    return unsubscribe
  }, [])

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
   * Banner tap routes four ways:
   * - nearby fetch failed → just retry the fetch
   * - fix failed (permission granted) → take another run at the position;
   *   `requestLocation` resolves without a dialog when permission is already
   *   held, so this is a retry, not a re-prompt. This is the case that used to
   *   be indistinguishable from a denial.
   * - location off, OS will still prompt → re-request permission
   * - location permanently denied → `requestLocation()` would resolve without
   *   ever showing a dialog, so send the user to the OS Settings page instead.
   */
  const handleBannerPress = useCallback(() => {
    if (bannerReason === "nearbyFailed") {
      void refresh()
      return
    }
    if (bannerReason === "fixFailed") {
      void requestLocation()
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

  const handleToggleView = useCallback(() => {
    const next: InPersonViewMode = effectiveViewMode === "list" ? "map" : "list"
    // ADDED 2026-08-08: clearing the session override is what makes "tap the
    // toggle to try the map again" actually work. Without it, a user who hit a
    // style-load failure would tap map, `viewMode` would already be "map" (it
    // is never rewritten to "list" any more), the override would still be set,
    // and the tap would be a silent no-op.
    if (next === "map") setMapFailedThisSession(false)
    setViewMode(next)
    // PRIVACY: a view-mode choice is a display preference, not a position.
    trackEvent("inperson_view_toggled", { view: next })
  }, [effectiveViewMode, setViewMode])

  const handleMapFailed = useCallback(() => {
    // Style/tile load failure (network, MapTiler cap, bad style) → say so and
    // fall back to the list; the toggle stays visible for a manual retry.
    // CHANGED 2026-08-08: this used to call setViewMode("list"), which writes
    // through to MMKV — so one transient failure permanently discarded a
    // preference the user had deliberately set, silently. Flip the session-only
    // override instead; the persisted choice survives and the next launch (or
    // the next toggle tap) puts them back on the map.
    showToast({ message: t("inPersonScreen:mapUnavailable"), type: "error" })
    setMapFailedThisSession(true)
  }, [showToast, t])

  const handleVenuePress = useCallback(
    (meetingIds: string[]) => {
      // Resolve against the UNFILTERED day list, not visibleMeetings: the pin
      // was built from what the map renders, but ids are stable either way and
      // the popup can show any meeting of the day.
      const found = meetings.filter((m) => meetingIds.includes(m.id))
      if (found.length === 1) {
        setSelectedMeeting(found[0])
      } else if (found.length > 1) {
        setVenueMeetings(found)
      }
    },
    [meetings],
  )

  const handleVenueChooserPick = useCallback((meeting: MeetingWithTrex) => {
    setVenueMeetings([])
    setSelectedMeeting(meeting)
  }, [])

  const handleVenueChooserClose = useCallback(() => setVenueMeetings([]), [])

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
        // ADDED 2026-08-04 alongside the favourites-first ordering. Without the
        // glyphs, a favourite sitting above a nearer meeting looks like the
        // distance sort is broken — the heart is what explains the position.
        // Read from the LIVE map, not from `item.feedback` (the sort snapshot),
        // so a heart tapped in the popup lights up immediately.
        rating={displayFeedback.get(item.id)?.rates ?? 0}
        isFavorite={displayFeedback.get(item.id)?.loves ?? false}
        hasReminder={meetingHasReminder(item, reminderLookup)}
        onPress={setSelectedMeeting}
      />
    ),
    [mode, useMiles, reminderLookup, displayFeedback],
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
    // No position → no request was made at all (see useNearbySchedules'
    // fetchMeetings). Added 2026-08-04 alongside dropping the worldwide
    // day-browse fallback: without this branch the user would land on
    // `emptyFallback` below, which blames the fellowship and the day for an
    // absence that is really about location. Tappable, and it runs the exact
    // same routing as the banner above it — the two are saying the same thing,
    // so they must do the same thing.
    if (bannerReason === "denied" || bannerReason === "fixFailed") {
      return (
        <Pressable
          style={themed($emptyContainer)}
          onPress={handleBannerPress}
          accessibilityRole="button"
        >
          <Text style={themed($emptyText)}>
            {t(
              bannerReason === "fixFailed"
                ? "inPersonScreen:emptyFixFailed"
                : "inPersonScreen:emptyNoLocation",
            )}
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
    bannerReason,
    handleBannerPress,
  ])

  // While we're waiting on a permission dialog / GPS fix, or on the very first
  // fetch, show a spinner instead of an empty-state message that would be
  // wrong a second later. RefreshControl owns the spinner once rows exist.
  const showSpinner = mode === "locating" || (isLoading && meetings.length === 0)

  // Only block ENTERING map mode while offline (blank tiles beat nobody —
  // spec Error handling #3). Computed once here, outside the two JSX
  // branches below, and passed to both — inside the `effectiveViewMode ===
  // "map"` branch TS narrows the type to the literal "map", which makes an
  // inline `effectiveViewMode === "list"` comparison a compile error (no
  // overlap) even though the intent — never disable while the map is
  // showing — is exactly what this variable already encodes. Leaving map
  // mode must always be possible, so a user who goes offline mid-browse on
  // the map is never stranded there with no way back to the list.
  const mapToggleDisabled = effectiveViewMode === "list" && networkStore.isOffline

  return (
    <View style={$screenContainer}>
      {/* The SAME header renders in both modes — deliberately. The filters,
          the day/radius/fellowship selectors and the permission banner all
          stay reachable while the map is up; a map you can't re-filter without
          switching back to the list would make the toggle a dead end. */}
      {effectiveViewMode === "map" ? (
        <View style={$screenContainer}>
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
            showMapToggle={showMapToggle}
            viewMode={effectiveViewMode}
            // See mapToggleDisabled definition above — always false here
            // since effectiveViewMode is narrowed to "map" in this branch.
            mapToggleDisabled={mapToggleDisabled}
            onToggleView={handleToggleView}
          />
          <InPersonMapView
            meetings={visibleMeetings}
            mapStyleUrl={mapStyleUrl}
            getSearchCenter={getCoords}
            radiusKm={radiusKm}
            onVenuePress={handleVenuePress}
            onMapFailed={handleMapFailed}
          />
        </View>
      ) : (
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
              showMapToggle={showMapToggle}
              viewMode={effectiveViewMode}
              // See mapToggleDisabled definition above.
              mapToggleDisabled={mapToggleDisabled}
              onToggleView={handleToggleView}
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
      )}

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

      {/* Venue chooser — a pin holding more than one of the day's meetings.
          Same modal chrome as RadiusSelectorModal above, copied rather than
          extracted for the reason documented there.

          Inline rather than a module-scope component like the three selectors:
          those take scalars, while this needs `meetings`, `displayFeedback`,
          `reminderLookup`, `mode` and `useMiles` to render rows identical to
          the list's — five props to relocate one `.map()`. It is not a
          FlatList header, so the identity-churn rule that governs
          InPersonListHeader does not apply here.

          A venue is one address, and a clubhouse can host 8-12 meetings in a
          single day — this list is data-driven and unbounded, unlike the fixed,
          short option lists the other selector modals show. $modalContent's
          maxHeight: "70%" caps the CARD's height, not the row count — it does
          NOT make overflowed rows reachable. Without the ScrollView below,
          rows past what fits are clipped (Android) or drawn outside the card
          and untappable (iOS). Plain ScrollView rather than FlatList to stay
          consistent with the inline-`.map()` shape above; revisit if a venue
          list large enough to need virtualization ever turns up. */}
      <Modal
        visible={venueMeetings.length > 0}
        transparent
        animationType="fade"
        onRequestClose={handleVenueChooserClose}
      >
        <Pressable style={themed($modalOverlay)} onPress={handleVenueChooserClose}>
          <View style={themed($modalContent)} accessibilityViewIsModal>
            <Text style={themed($modalTitle)}>{t("inPersonScreen:venueMeetings")}</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {venueMeetings.map((m) => (
                // Every prop mirrors the list's `renderItem` exactly — a row that
                // reads differently here than three taps away in the list would
                // look like two different meetings.
                <MeetingRow
                  key={m.id}
                  meeting={m}
                  distanceLabel={
                    mode === "nearby"
                      ? formatDistance(m.distance_m, useMiles) || undefined
                      : undefined
                  }
                  rating={displayFeedback.get(m.id)?.rates ?? 0}
                  isFavorite={displayFeedback.get(m.id)?.loves ?? false}
                  hasReminder={meetingHasReminder(m, reminderLookup)}
                  onPress={handleVenueChooserPick}
                />
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
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

// Toggle + settings gear, side by side at the end of the title row. A fixed
// gap rather than a spacing token: both children are 22px Ionicons and this is
// the distance that keeps two bare glyphs from reading as one control.
const $headerActions: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 16,
}

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
