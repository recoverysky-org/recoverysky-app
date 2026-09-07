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
  AppState,
  AppStateStatus,
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

import { DaySelectorModal } from "@/components/DaySelectorModal"
import { InPersonListHeader } from "@/components/InPersonListHeader"
import { InPersonMapView } from "@/components/InPersonMapView"
import { InPersonPopup } from "@/components/InPersonPopup"
import type { InPersonViewMode } from "@/components/MapListToggle"
import { MeetingRow } from "@/components/MeetingRow"
import { Text } from "@/components/Text"
import { useToast } from "@/components/Toast"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { isInPersonVenue } from "@/context/meetingPools"
import { feedbackCache, type FeedbackRecord } from "@/db"
import { useLocationGate } from "@/hooks/useLocationGate"
import { useNearbySchedules } from "@/hooks/useNearbySchedules"
import { meetingHasReminder, useReminderLookup } from "@/hooks/useReminders"
import { useConfigStore, useNetworkStore, useProfileStore } from "@/models"
import {
  consumePendingMeetingId,
  peekPendingMeetingId,
  usePendingMeetingId,
} from "@/navigators/navigationUtilities"
import { api } from "@/services/api"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { ACTIVE_FELLOWSHIPS } from "@/utils/fellowships"
import {
  ANY_DAY,
  DEFAULT_SHORT_TIME,
  ISO_DAYS,
  matchesShortTime,
  SHORT_TIME_OPTIONS,
  type ShortTime,
} from "@/utils/filterLogic"
import { shouldShowMapToggle } from "@/utils/inPersonMapLogic"
import { logger } from "@/utils/logger"
import {
  formatDistance,
  localIsoDow,
  parseInPersonSortOrder,
  RADIUS_OPTIONS_KM,
  sortInPerson,
  type InPersonSortOrder,
} from "@/utils/nearbyLogic"
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

/** MMKV key for the persisted Distance / Start list order — same class of
 * display preference as the view mode above, and equally NOT location data. */
const SORT_ORDER_STORAGE_KEY = "inperson.sortOrder"

const loadSortOrder = (): InPersonSortOrder =>
  parseInPersonSortOrder(loadString(SORT_ORDER_STORAGE_KEY))

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
  const profileStore = useProfileStore()
  const { runGate } = useLocationGate()

  /**
   * True once the gate has run for the current visit; reset on leaving the
   * segment. See the effect below for why the visit — not the store value — is
   * what arms it.
   */
  const gateRanForVisitRef = useRef(false)

  /**
   * The location gate. Keyed on `visible` — the segment being on screen —
   * NOT on the `active` latch, which fires once per mount and would give a
   * once-ever prompt instead of the every-visit one the spec requires.
   *
   * Re-running on every visit is deliberate: switching away to another segment
   * and back re-reads the OS state, so a permission changed in the meantime is
   * picked up without a restart.
   *
   * CHANGED 2026-08-08 (TODO M1): this comment used to claim the same applied
   * to a user returning from device Settings. It did not. `visible` is
   * `activeSegment === "inperson"` (MeetingsScreen), which does not change when
   * the app backgrounds and resumes — so that trip re-fired nothing and a
   * freshly granted permission went unnoticed. The resume listener below is
   * what actually closes that path.
   *
   * CHANGED 2026-08-09: the gate now runs only on the false→true edge of
   * `visible`, not on every change of `locationEnabled`. The Meetings tab stays
   * mounted while the user is on the Settings tab, so `visible` was still true
   * over there — and Settings → Permissions → Location OFF writes
   * `locationEnabled = false`, which is precisely the write that both re-fired
   * this effect through its dependency array AND stopped the guard below from
   * short-circuiting. The result was a "turn location on?" dialog thrown on top
   * of the switch the user had just deliberately turned off. The gate asks when
   * you arrive at the segment; it does not argue with a choice made elsewhere.
   *
   * `locationEnabled` stays in the deps because the body reads it (and must
   * read a fresh value on a genuine visit) — the ref is what makes that read
   * non-triggering.
   */
  useEffect(() => {
    if (!visible) {
      // Leaving the segment arms the next visit.
      gateRanForVisitRef.current = false
      return
    }
    if (gateRanForVisitRef.current) return
    gateRanForVisitRef.current = true
    if (profileStore.locationEnabled) return
    void runGate()
  }, [visible, profileStore.locationEnabled, runGate])

  /**
   * ADDED 2026-08-08 (TODO M1): re-run the gate when the app returns to the
   * foreground while this segment is on screen — the device-Settings round trip
   * the effect above cannot see.
   *
   * GRANTED in device Settings is the case this exists for: nothing in the
   * store changed, so no dependency above re-fires and this effect is the only
   * thing that notices.
   *
   * CHANGED 2026-08-09: this block used to claim the REVOKED direction was
   * covered by app.tsx's resume sync writing `locationEnabled = false` and
   * re-firing the effect above through its dependency array. That re-fire is
   * gone — it was also what popped a dialog at anyone who switched the toggle
   * off in Settings (see above). Nothing raises an alert on a revoke now, which
   * is the better behavior anyway: someone who just turned location off in
   * device Settings does not need us telling them to go turn it on. The screen
   * still reflects it — `bannerReason` is observed, so the disabled banner
   * appears on the next render — and the next genuine visit re-runs the gate.
   *
   * The read below races app.tsx's async permission read on a revoke resume, so
   * it will usually still see `locationEnabled === true` and do nothing. That's
   * the outcome we want; it just isn't guaranteed by ordering. If it loses the
   * race it runs the gate, which yields an "open device settings" alert — the
   * same one the next visit would show. Harmless either way, which is why this
   * is documented rather than synchronized.
   */
  useEffect(() => {
    if (!visible) return

    let appState = AppState.currentState

    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appState.match(/inactive|background/) && nextState === "active") {
        // Read through the store rather than closing over a rendered value:
        // this callback outlives the render that created it, and app.tsx's
        // resume sync may write `locationEnabled` on this very transition.
        if (!profileStore.locationEnabled) void runGate()
      }
      appState = nextState
    })

    return () => {
      subscription.remove()
    }
  }, [visible, profileStore, runGate])

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

  /**
   * ADDED 2026-08-09 (whole-branch review, C2): re-acquire when the location
   * gate flips the toggle on mid-visit.
   *
   * Ordering, deterministic and otherwise silent: the driver effect inside
   * `useNearbySchedules` calls `acquireLocation()` as soon as the segment
   * activates, and that function's `profileStore.locationEnabled` short
   * circuit (see its header comment) fires SYNCHRONOUSLY, before its first
   * `await` — so on a first visit with the toggle off it latches
   * `permission: "denied"` and `coordsRef: null` immediately. The gate effect
   * above then resolves `runGate()` seconds later (an Alert or an OS prompt)
   * and flips `profileStore.locationEnabled` to true — but nothing re-fires
   * `acquireLocation`: its only dependency is `[profileStore]`, a stable MST
   * instance whose identity never changes, and it reads `locationEnabled`
   * INSIDE the callback rather than during render, so MobX has nothing to
   * track and the hook's driver effect never re-runs. Without this, granting
   * location lands the user on an empty list under a banner still telling
   * them to enable it, and pull-to-refresh can't recover it either —
   * `refresh()` guards on `permission === "granted"`, which stayed "denied".
   *
   * `requestLocation` is the exact re-acquire the banner tap already uses
   * (see `handleBannerPress` below) — reusing it here means granting the
   * toggle produces the same result as a manual banner tap would, instead of
   * a second, parallel re-fetch path. The ref is what turns "locationEnabled
   * is true" into an edge (false→true): without it this would also fire on
   * every render where it's already true, including the very first one,
   * duplicating the driver effect's own initial acquire.
   */
  const wasLocationEnabledRef = useRef(profileStore.locationEnabled)
  useEffect(() => {
    if (profileStore.locationEnabled && !wasLocationEnabledRef.current) {
      void requestLocation()
    }
    wasLocationEnabledRef.current = profileStore.locationEnabled
  }, [profileStore.locationEnabled, requestLocation])

  const [dayModalVisible, setDayModalVisible] = useState(false)
  const [radiusModalVisible, setRadiusModalVisible] = useState(false)
  const [shortTimeModalVisible, setShortTimeModalVisible] = useState(false)
  const [fellowshipModalVisible, setFellowshipModalVisible] = useState(false)
  // ADDED 2026-09-05: pull-to-refresh tracked separately from the hook's
  // `isLoading`. RefreshControl's `refreshing` used to be bound to
  // `isLoading && meetings.length > 0`, which ALSO went true on every
  // day / radius / fellowship change — and a programmatic `refreshing=true`
  // is unreliable as the reload signal (no FlatList in map mode, a plain View
  // on web, and on iOS a 250 ms content-offset animation that a fast fetch
  // beats, leaving no indicator at all). Now the native control reflects only
  // an actual pull, and criteria reloads are signalled by the header instead
  // (see `isRefetching` below).
  const [isPullRefreshing, setIsPullRefreshing] = useState(false)
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingWithTrex | null>(null)

  const [viewMode, setViewModeState] = useState<InPersonViewMode>(loadViewMode)
  const [sortOrder, setSortOrderState] = useState<InPersonSortOrder>(loadSortOrder)
  /** Meetings at a multi-meeting venue pin awaiting a chooser pick */
  const [venueMeetings, setVenueMeetings] = useState<MeetingWithTrex[]>([])

  const setViewMode = useCallback((next: InPersonViewMode) => {
    setViewModeState(next)
    saveString(VIEW_MODE_STORAGE_KEY, next)
  }, [])

  const handleSelectSort = useCallback((next: InPersonSortOrder) => {
    setSortOrderState(next)
    saveString(SORT_ORDER_STORAGE_KEY, next)
    // PRIVACY: a sort choice is a display preference, not a position.
    trackEvent("inperson_sort_changed", { sort: next })
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
  //
  // ADDED 2026-08-08 (`profileStore.locationEnabled`): with the Settings →
  // Permissions toggle off, `useNearbySchedules` never has a fix (see its
  // short circuit in `acquireLocation`), so a persisted `viewMode` of "map"
  // would otherwise land the user on a MapLibre surface centered on nothing —
  // `InPersonMapView`'s `getSearchCenter` returns `coordsRef.current`, which is
  // forced null the whole time the toggle is off. Forcing "list" here is the
  // same degrade the style-URL and platform checks already perform for a map
  // that isn't available; a map with no position to center on is exactly as
  // unavailable.
  const effectiveViewMode: InPersonViewMode =
    viewMode === "map" &&
    showMapToggle &&
    active &&
    visible &&
    !mapFailedThisSession &&
    profileStore.locationEnabled
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
  // Deep link / paywall return → InPersonPopup auto-open
  //
  // Two producers park an id in the module-level pending store under the
  // "inperson" target:
  //
  // 1. The premium gate in InPersonPopup.handleCellPress sends the user to the
  //    paywall with `returnTo: "Meetings:inperson:meetingId:<id>"`. On a
  //    successful purchase, SettingsScreen.navigateReturn() parks the id and
  //    navigates back here. Reopening the popup means the reminder they just
  //    paid to create is one tap away instead of a re-navigation away.
  // 2. A reminder push for an in-person meeting (app.tsx
  //    handleNotificationData, via the payload's `segment`).
  //
  // Same peek/consume shape as LiveContent's notification handler, and the
  // same store — the "inperson" target is what stops LiveContent, which is
  // mounted at the same time, from swallowing this id.
  //
  // CHANGED 2026-08-07: this used to have no API slow path, on the grounds
  // that "the only producer is the paywall round-trip, which leaves this
  // component mounted with its list intact, so the meeting is effectively
  // always in `meetings`". Producer 2 breaks every clause of that. A push tap
  // can MOUNT this component (cold start, or a segment the user has never
  // opened) with `meetings: []` and — because `useNearbySchedules` starts at
  // `isLoading: false` — no load yet in flight, so the old code dropped the id
  // on its very first run. Worse, even a fully-loaded list is filtered by
  // location permission, GPS fix, radius, day and fellowship, while a reminder
  // is for a meeting the user CHOSE: one set at home for a venue 20 miles away
  // is legitimately absent from a 5-mile list. So: fall back to fetching the
  // meeting by id, exactly like LiveContent does.
  // ---------------------------------------------------------------------------
  const pendingMeetingId = usePendingMeetingId("inperson")
  const consumedMeetingIdRef = useRef<string | undefined>(undefined)
  // Separate from `consumedMeetingIdRef` on purpose: the effect re-runs on
  // every `meetings` change, which can happen repeatedly while a fetch is in
  // flight (the id is deliberately NOT consumed until the popup opens). Without
  // this we'd fire a duplicate request per list update.
  const slowPathIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const targetId = peekPendingMeetingId("inperson")
    if (!targetId || targetId === consumedMeetingIdRef.current) return

    // Fast path: already in the list. Preferred over the fetch even when both
    // would work — only the list carries `distance_m`, so this is the one that
    // shows the distance in the popup header.
    const found = meetings.find((m) => m.id === targetId)
    if (found) {
      consumedMeetingIdRef.current = targetId
      consumePendingMeetingId()
      setSelectedMeeting(found)
      return
    }
    // A load is genuinely in flight — leave the id parked so the next list
    // lands it (and keeps its distance). This is the paywall-return case: the
    // list is intact or about to be, and the fetch below would be waste.
    if (isLoading) return
    if (slowPathIdRef.current === targetId) return
    slowPathIdRef.current = targetId

    // Slow path: fetch by id. Asks the in_person pool directly rather than
    // going through getScheduleByMeetingIdAnyVenue — we're on the "inperson"
    // target precisely because the sender resolved venueType for us, so the
    // any-venue helper's online-first attempt would just be a wasted round trip
    // before the same answer.
    api
      .getScheduleByMeetingId(targetId, "in_person")
      .then((result) => {
        // The list won the race while we were out — it already opened the
        // popup, with a distance we don't have. Leave it alone.
        if (consumedMeetingIdRef.current === targetId) return

        if (result.kind !== "ok") {
          log.warn("Failed to fetch in-person schedule for pending meetingId", {
            meetingId: targetId,
            kind: result.kind,
          })
          consumedMeetingIdRef.current = targetId
          consumePendingMeetingId()
          return
        }

        const s = result.schedule
        // Self-verify the venue rather than trusting the param, same reasoning
        // as `inPersonPoolOf`: a server that doesn't understand `venueType`
        // answers from the online pool regardless, and InPersonPopup on an
        // online record is a dead end — no address, no directions, and an
        // "I'm Here" presence check against a venue with no coordinates.
        if (!isInPersonVenue(s.meeting.venueType)) {
          log.info("Pending in-person meetingId resolved to a non-in-person venue; dropping", {
            meetingId: targetId,
            venueType: s.meeting.venueType,
          })
          consumedMeetingIdRef.current = targetId
          consumePendingMeetingId()
          return
        }

        // Same projection as `toMeetings` in useNearbySchedules, minus
        // `distance_m`: this record didn't come from /schedules/nearby, so
        // there is no distance to report. It's optional on MeetingWithTrex and
        // `formatDistance(undefined)` returns "", so the badge simply doesn't
        // render — do NOT synthesize one from the user's current position.
        const meetingWithTrex: MeetingWithTrex = {
          ...s.meeting,
          feedback: feedbackCache.get(s.meeting.id),
          sid: s.sid,
          millis: s.millis,
          duration_ms: s.duration_ms ?? 0,
          scheduleData: s.data,
        }
        consumedMeetingIdRef.current = targetId
        consumePendingMeetingId()
        setSelectedMeeting(meetingWithTrex)
      })
      .catch((err) => {
        log.error("Error fetching in-person schedule for pending meetingId", {
          meetingId: targetId,
          error: String(err),
        })
        consumedMeetingIdRef.current = targetId
        consumePendingMeetingId()
      })
  }, [pendingMeetingId, meetings, isLoading])

  // ISO_DAYS always covers 1..7 and selectedDay is derived from a Date, so the
  // lookup can't miss — the ternary just avoids a non-null assertion on the
  // find() result rather than guarding a case that can actually happen.
  // CHANGED 2026-08-14: `selectedDay` can now also be ANY_DAY (0), which is
  // deliberately absent from ISO_DAYS, so that case is answered before the
  // lookup rather than falling through to the "" the ternary yields.
  const isAnyDay = selectedDay === ANY_DAY
  const selectedDayEntry = ISO_DAYS.find((d) => d.iso === selectedDay)
  const selectedDayLabel = isAnyDay
    ? t("listingsScreen:anyDay")
    : selectedDayEntry
      ? t(selectedDayEntry.tx)
      : ""
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
  //
  // ADDED 2026-08-09 (fix round 1, D6 "Declining shows no meeting list"):
  // `!profileStore.locationEnabled` short-circuits to `[]` regardless of what
  // `meetings` holds. This is a real spec violation, not a nicety — nothing in
  // `useNearbySchedules` reactively clears `meetings` when the toggle flips
  // off; its `permission`/`coords` state only updates the next time
  // `acquireLocation` actually runs (a pull-to-refresh, a re-request). So a
  // user who turns the toggle off while the segment isn't visible, then
  // returns without refreshing, would otherwise keep seeing the
  // previously-fetched, distance-sorted list computed from a position they
  // just revoked — the app visibly still using a location it was told to
  // stop using. `visibleMeetings` is the single choke point feeding both the
  // list's `data` (below) and the map's `meetings` prop, so gating it here
  // covers both surfaces and makes `ListEmptyComponent` (which FlatList only
  // renders when `data.length === 0`) show the needs-location copy instead
  // of stale rows. Enforced at the screen, not threaded into
  // `useNearbySchedules` or the pure `nearbyLogic` module — same "app-level
  // gate sits above the data" rule the banner fix above already follows.
  //
  // CHANGED 2026-09-06: the user's Distance / Start pick is applied here too.
  // `useNearbySchedules` hands over a nearest-first list; re-sorting at this
  // choke point (rather than inside the hook) keeps the hook's ordering the
  // single documented default and means a sort change never triggers a fetch.
  // Only the nearby list is re-sorted — the day-browse fallback has no
  // `distance_m`, so its time order stands and the pill is hidden for it.
  const visibleMeetings = useMemo(() => {
    if (!profileStore.locationEnabled) return []
    const filtered =
      shortTime === DEFAULT_SHORT_TIME
        ? meetings
        : meetings.filter((m) => matchesShortTime(m.millis, shortTime))
    if (mode !== "nearby") return filtered
    // `localIsoDow` is the weekday reader the rest of this segment uses; Date.now()
    // is never 0, so the null branch is unreachable and the fallback is inert.
    return sortInPerson(filtered, sortOrder, isAnyDay, localIsoDow(Date.now()) ?? 1)
  }, [meetings, shortTime, profileStore.locationEnabled, mode, sortOrder, isAnyDay])

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
   * Banner tap routes five ways:
   * - location toggle off (app-level, not OS) → run the location gate.
   *   ADDED 2026-08-08 (Task 7): this must come FIRST. Without it, a user in
   *   this state falls into the `canAskAgain` branch below (leftover `true`
   *   from the last real OS call — see `useNearbySchedules`' short circuit in
   *   `acquireLocation`), which calls `requestLocation()`. That short-circuits
   *   the same way `acquireLocation` always does while the toggle is off, so
   *   the tap silently did nothing — the dead end this fix closes. Only
   *   `runGate()` can turn the toggle back on.
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
    if (!profileStore.locationEnabled) {
      void runGate()
      return
    }
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
  }, [profileStore.locationEnabled, runGate, bannerReason, canAskAgain, refresh, requestLocation])

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
        // Only under "Any" — on a list already filtered to one weekday, the
        // same badge on every row says nothing. See MeetingRow's `showDay`.
        showDay={isAnyDay}
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
    [mode, useMiles, reminderLookup, displayFeedback, isAnyDay],
  )

  const keyExtractor = useCallback((item: MeetingWithTrex) => item.id, [])

  const ItemSeparatorComponent = useCallback(() => <View style={themed($separator)} />, [themed])

  const ListEmptyComponent = useCallback(() => {
    // Highest priority: without location there is no list at all, so no other
    // empty-state copy can be true. Tappable, so the user has a route back in
    // without hunting through Settings.
    if (!profileStore.locationEnabled) {
      return (
        <Pressable
          style={themed($emptyContainer)}
          onPress={() => {
            void runGate()
          }}
          accessibilityRole="button"
        >
          <Text style={themed($emptyText)} tx="location:emptyNeedsLocation" />
        </Pressable>
      )
    }
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
            {isAnyDay
              ? t("inPersonScreen:emptyShortTimeAnyDay", { time: shortTimeLabel })
              : t("inPersonScreen:emptyShortTime", {
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
            {isAnyDay
              ? t("inPersonScreen:emptyNearbyAnyDay", { distance: radiusDistance })
              : t("inPersonScreen:emptyNearby", {
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
          {isAnyDay
            ? t("inPersonScreen:emptyFallbackAnyDay", { fellowship })
            : t("inPersonScreen:emptyFallback", {
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
    isAnyDay,
    handleOpenRadiusModal,
    shortTime,
    shortTimeLabel,
    meetings.length,
    handleOpenShortTimeModal,
    handleOpenFellowshipModal,
    bannerReason,
    handleBannerPress,
    profileStore.locationEnabled,
    runGate,
  ])

  // While we're waiting on a permission dialog / GPS fix, or on the very first
  // fetch, show a spinner instead of an empty-state message that would be
  // wrong a second later. RefreshControl owns the spinner once rows exist.
  // CHANGED 2026-09-05: RefreshControl now owns ONLY the pull gesture. A
  // criteria change over existing rows (`isRefetching`) shows the header's
  // count-slot indicator instead, in both list and map modes — the old rows
  // and count stay put until the new response lands, so without this the
  // user got no signal at all that a reload was in flight.
  const showSpinner = mode === "locating" || (isLoading && meetings.length === 0)
  const isRefetching = isLoading && meetings.length > 0 && !isPullRefreshing

  // Wraps the hook's `refresh` so the native pull spinner tracks the gesture's
  // own request end-to-end (location re-fix + fetch), not the hook's shared
  // `isLoading`. `finally` keeps the control from sticking on if the hook's
  // chain throws before it reaches `setIsLoading(false)`.
  const handlePullRefresh = useCallback(async () => {
    setIsPullRefreshing(true)
    try {
      await refresh()
    } finally {
      setIsPullRefreshing(false)
    }
  }, [refresh])

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

  // ADDED 2026-08-08: with location off there are no meetings to plot and no
  // idea where the user is, so a map has nothing to show. This is a separate
  // condition from `shouldShowMapToggle`'s style-URL kill switch — that one
  // answers "is a map configured", this one answers "is there anything to
  // put on it".
  const showMapToggleNow = showMapToggle && profileStore.locationEnabled

  // The map has no order and the day-browse fallback has no distances (see
  // the prop comment on InPersonListHeaderProps.showSortToggle).
  const showSortToggle = effectiveViewMode === "list" && mode === "nearby"

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
            // See the prop's doc comment on InPersonListHeaderProps: this is
            // the app-level gate, not the OS permission state `bannerReason`
            // already encodes, and it overrides the banner copy the same way
            // in both branches.
            locationDisabled={!profileStore.locationEnabled}
            showSpinner={showSpinner}
            isRefetching={isRefetching}
            onOpenFellowship={handleOpenFellowshipModal}
            onOpenDay={handleOpenDayModal}
            onOpenRadius={handleOpenRadiusModal}
            onOpenShortTime={handleOpenShortTimeModal}
            onBannerPress={handleBannerPress}
            // Same array the map plots and the list renders, so the count can
            // never disagree with what's actually on screen in either mode.
            resultCount={visibleMeetings.length}
            // See showMapToggleNow definition above — always true here since
            // effectiveViewMode can only be "map" when location is on.
            showMapToggle={showMapToggleNow}
            viewMode={effectiveViewMode}
            // See mapToggleDisabled definition above — always false here
            // since effectiveViewMode is narrowed to "map" in this branch.
            mapToggleDisabled={mapToggleDisabled}
            onToggleView={handleToggleView}
            showSortToggle={showSortToggle}
            sortOrder={sortOrder}
            onSelectSort={handleSelectSort}
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
              locationDisabled={!profileStore.locationEnabled}
              showSpinner={showSpinner}
              isRefetching={isRefetching}
              onOpenFellowship={handleOpenFellowshipModal}
              onOpenDay={handleOpenDayModal}
              onOpenRadius={handleOpenRadiusModal}
              onOpenShortTime={handleOpenShortTimeModal}
              onBannerPress={handleBannerPress}
              resultCount={visibleMeetings.length}
              showMapToggle={showMapToggleNow}
              viewMode={effectiveViewMode}
              // See mapToggleDisabled definition above.
              mapToggleDisabled={mapToggleDisabled}
              onToggleView={handleToggleView}
              showSortToggle={showSortToggle}
              sortOrder={sortOrder}
              onSelectSort={handleSelectSort}
            />
          }
          ItemSeparatorComponent={ItemSeparatorComponent}
          ListEmptyComponent={showSpinner ? null : ListEmptyComponent}
          contentContainerStyle={themed($listContent)}
          refreshControl={
            <RefreshControl
              refreshing={isPullRefreshing}
              onRefresh={handlePullRefresh}
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
        // Always offered here, and never disabled: this segment is in-person by
        // definition and every one of its queries is bounded by the radius, so
        // there is no venue choice that could make "Any" unaffordable. Search
        // needs the `anyDisabled` half; this screen never does.
        allowAny
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
                  // Same rule as the list rows above — the venue chooser can
                  // hold meetings from different days once "Any" is selected.
                  showDay={isAnyDay}
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
