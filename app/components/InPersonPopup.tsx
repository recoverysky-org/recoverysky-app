/**
 * InPersonPopup Component
 *
 * Modal popup shown when a user taps an in-person (face-to-face) meeting
 * row. Displays:
 * - Meeting name, fellowship badge, local time
 * - Meta row: time, duration, meeting count, language, hybrid note
 * - Meeting type tags
 * - Venue block: venue name, address, extra location info, approximate caveat
 * - Get Directions button (platform deep link, falls back to Maps web) with
 *   the favourite heart + 5-star rating beside it
 * - Published contacts (tap to call / email)
 * - Weekly schedule grid + reminders
 * - "I'm Here" attendance confirmation
 *
 * Structural shell (overlay Modal, card, close-on-overlay-press, auto-close
 * on screen blur via useIsFocused) and the reminder wiring are copied from
 * SchedulePopup.tsx — see that file for the online-meeting machinery this
 * deliberately omits (Zoom join, topic panel, rating soft-ask, the External
 * Zoom timer). In-person attendance is a single user-confirmed tap, not an
 * elapsed-time credit, so none of that applies.
 *
 * CHANGED 2026-08-04: the header used to stop at time + duration, and the
 * feedback controls were listed above as deliberately omitted. Both were
 * wrong once MeetingRow consolidated: an in-person row already *renders* the
 * heart and stars, so leaving them out of the popup meant a user could see
 * their rating but had nowhere to set it. Meeting count, language and the
 * type tags came along for the same reason — a meeting's identity shouldn't
 * shrink because it happens to have an address. The header now matches
 * SchedulePopup's block-for-block; keep them in step.
 */

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Alert,
  Linking,
  Platform,
  View,
  ViewStyle,
  TextStyle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useIsFocused } from "@react-navigation/native"
import { DateTime, FELLOWSHIP_COLORS, Fellowship } from "@recoverysky-org/common/browser"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { ReminderEditorModal } from "@/components/ReminderEditorModal"
import { ScheduleGrid } from "@/components/ScheduleGrid"
import { Text } from "@/components/Text"
import { useToast } from "@/components/Toast"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { useSubscription } from "@/context/SubscriptionContext"
import { feedbackCache, type FeedbackRecord, type ReminderRecord } from "@/db"
import { useReminders } from "@/hooks/useReminders"
import { translate } from "@/i18n"
import { useAuthenticationStore, useConfigStore, useProfileStore } from "@/models"
import { navigate } from "@/navigators/navigationUtilities"
import { hasLoggedToday, saveInPersonAttendance } from "@/services/inPerson/attendance"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { formatMillisToLocalTime } from "@/utils/formatTime"
import { logger } from "@/utils/logger"
import { buildDirectionsUrl, composeAddress } from "@/utils/nearbyLogic"
import { buildMeetingReturnTo } from "@/utils/returnToLogic"

const log = logger.child({ module: "InPersonPopup" })

/** Amber accent used for reminder cells (ScheduleGrid) and the "approximate
 * location" caveat row — matches the warm-accent convention established in
 * MeetingRow / ScheduleGrid rather than introducing a new hue. */
const WARNING_COLOR = "#f59e0b"

/** Feedback accents. Hard-coded rather than themed for the same reason
 * SchedulePopup and MeetingRow hard-code them: a favourited heart is red and
 * a filled star is gold in every theme, and all three surfaces must agree —
 * a row and the popup it opens showing different reds would read as two
 * different states. Keep these in sync with MeetingRow.tsx. */
const FAVORITE_COLOR = "#ef4444"
const STAR_COLOR = "#fbbf24"

interface InPersonPopupProps {
  visible: boolean
  meeting: MeetingWithTrex | null
  onClose: () => void
}

export const InPersonPopup: FC<InPersonPopupProps> = observer(function InPersonPopup({
  visible,
  meeting,
  onClose,
}) {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()
  const configStore = useConfigStore()
  const authStore = useAuthenticationStore()
  const { isPremium } = useSubscription()
  const toast = useToast()
  const isFocused = useIsFocused()

  // Auto-close when parent screen loses focus (e.g. navigating to Settings
  // from the premium-gate prompt below) — same rationale as SchedulePopup.
  useEffect(() => {
    if (!isFocused && visible) onClose()
  }, [isFocused, visible, onClose])

  // ==========================================================================
  // Reminders (copied wiring from SchedulePopup — same hook, same gates)
  // ==========================================================================

  const [reminderEditorVisible, setReminderEditorVisible] = useState(false)
  const [editingReminder, setEditingReminder] = useState<ReminderRecord | null>(null)
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null)
  const {
    reminderCells,
    createReminder,
    updateReminder,
    deleteReminder,
    findExistingReminder,
    checkOverlap,
  } = useReminders(visible ? meeting : null, meeting?.sid ?? "")

  // Handle schedule grid cell tap → open reminder editor (premium only)
  const handleCellPress = useCallback(
    (_millis: number, id: string, dayIndex: number, rowIndex: number) => {
      // Reminders rely on server-side push scheduling — block creation /
      // edit while we're in maintenance so users don't think they set a
      // reminder that we couldn't actually deliver. The locally-stored
      // record path also fires a fire-and-forget API sync, so disabling
      // entry is the right gate.
      if (configStore.maintenanceMode) {
        Alert.alert(t("maintenance:title"), t("common:maintenanceBanner"))
        return
      }

      if (!isPremium) {
        Alert.alert(t("reminderEditor:premiumTitle"), t("reminderEditor:premiumMessage"), [
          { text: t("reminderEditor:cancel"), style: "cancel" },
          {
            text: t("reminderEditor:goToSettings"),
            onPress: () => {
              onClose()
              navigate(
                "Settings" as never,
                {
                  section: "subscription",
                  // CHANGED 2026-08-03: was a hand-assembled
                  // `Meetings:meetingId:<id>`, copied verbatim from
                  // SchedulePopup per the plan. That form has no way to say
                  // "in-person", and SettingsScreen.navigateReturn() read it as
                  // live — so after paying, the user was dropped on the Live
                  // segment, which deliberately discards in-person records, and
                  // this popup never reopened. Build it with the helper rather
                  // than by hand; that is exactly how the wrong form got here.
                  returnTo: buildMeetingReturnTo("inperson", meeting!.id),
                } as never,
              )
            },
          },
        ])
        return
      }

      const existing = findExistingReminder(id, dayIndex)
      setEditingReminder(existing)
      setSelectedCell({ row: rowIndex, col: dayIndex })
      setReminderEditorVisible(true)
    },
    // `meeting` is intentionally absent from this array (eslint flags it —
    // do not silence with an eslint-disable, and do not add it back without
    // re-reading this comment). It is not stale: `findExistingReminder` IS
    // in the deps, and its own hook (useReminders.ts) declares its deps as
    // `[reminders, meeting?.id, meeting?.scheduleData]` — so whenever the
    // popup's `meeting` prop changes, `findExistingReminder` is re-created,
    // which transitively re-creates this callback too. That means the
    // `meeting!.id` read inside the `returnTo` closure below can never go
    // stale. Copied from SchedulePopup.tsx's identical handleCellPress,
    // which relies on the same mechanism (and carries the same eslint
    // warning) — verified against useReminders.ts before porting here.
    [isPremium, configStore, findExistingReminder, t, onClose],
  )

  const scheduleGridData = useMemo(() => meeting?.scheduleData ?? [], [meeting?.scheduleData])

  // Total weekly occurrences — every non-null cell in the grid. Same
  // derivation as SchedulePopup so the two popups can't disagree about how
  // many times a group meets.
  const meetingCount = useMemo(
    () => scheduleGridData.reduce((count, row) => count + row.filter(Boolean).length, 0),
    [scheduleGridData],
  )

  // Current day for highlighting (1=Mon, 7=Sun) — same source as SchedulePopup.
  const currentDow = DateTime.now().weekday

  // ==========================================================================
  // Feedback (favourite + rating) — same cache, same wiring as SchedulePopup
  //
  // SchedulePopup's joins row (below the stars) is deliberately NOT ported:
  // `joins` counts Zoom joins, which an in-person meeting never accrues. The
  // equivalent here is "I'm Here", and that's recorded as attendance.
  // ==========================================================================

  // Local mirror of the cached record. `feedbackCache.get` is a synchronous
  // read, so the heart/stars are correct on the popup's first frame rather
  // than popping in a moment later.
  const [feedback, setFeedback] = useState<FeedbackRecord | null>(null)

  useEffect(() => {
    if (visible && meeting?.id) {
      setFeedback(feedbackCache.get(meeting.id))
    } else {
      setFeedback(null)
    }
  }, [visible, meeting?.id])

  const isFavorite = feedback?.loves ?? false
  const rating = feedback?.rates ?? 0

  const handleToggleLove = useCallback(async () => {
    if (!meeting?.id) return
    const newLoves = await feedbackCache.toggleLove(meeting.id)
    setFeedback((prev) =>
      prev
        ? { ...prev, loves: newLoves }
        : { mid: meeting.id, loves: newLoves, rates: 0, joins: 0, lastJoin: 0 },
    )
    trackEvent("meeting_favorited", { action: newLoves ? "add" : "remove" })
  }, [meeting?.id])

  const handleSetRating = useCallback(
    async (star: number) => {
      if (!meeting?.id) return
      await feedbackCache.setRating(meeting.id, star)
      setFeedback((prev) =>
        prev
          ? { ...prev, rates: star }
          : { mid: meeting.id, loves: false, rates: star, joins: 0, lastJoin: 0 },
      )
    },
    [meeting?.id],
  )

  // ==========================================================================
  // Address
  // ==========================================================================

  // `meeting.formattedAddress` is dead data upstream (0 of 55,617 active
  // in-person meetings have it populated) — compose a display address from
  // the decomposed street/city/state/postalCode parts instead. See
  // composeAddress's own doc comment in nearbyLogic.ts for the full story.
  // Computed once here and reused by the venue block below and both
  // buildDirectionsUrl calls so all three stay in sync.
  const composedAddress = useMemo(
    () =>
      meeting
        ? composeAddress({
            formattedAddress: meeting.formattedAddress,
            street: meeting.street,
            city: meeting.city,
            state: meeting.state,
            postalCode: meeting.postalCode,
          })
        : "",
    [meeting],
  )

  // ==========================================================================
  // Directions
  // ==========================================================================

  const directionsUrl = useMemo(
    () =>
      meeting
        ? buildDirectionsUrl({
            platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web",
            latitude: meeting.latitude,
            longitude: meeting.longitude,
            venueName: meeting.venueName,
            formattedAddress: composedAddress,
          })
        : "",
    [meeting, composedAddress],
  )

  const handleDirections = useCallback(() => {
    if (!directionsUrl) return
    // PRIVACY: no payload — the destination coordinates must never ride
    // along with an analytics event (see nearbyLogic / useNearbySchedules
    // for the same rule applied to the fetch layer). The URL itself is
    // never logged either, for the same reason.
    trackEvent("inperson_directions_opened")
    // Best-effort: if the geo:/maps: scheme has no handler, fall back to
    // the universal Google Maps web URL rather than failing silently.
    Linking.openURL(directionsUrl).catch(() => {
      const web = buildDirectionsUrl({
        platform: "web",
        latitude: meeting?.latitude,
        longitude: meeting?.longitude,
        venueName: meeting?.venueName,
        formattedAddress: composedAddress,
      })
      if (web) Linking.openURL(web).catch(() => {})
    })
  }, [directionsUrl, meeting, composedAddress])

  // ==========================================================================
  // "I'm Here" attendance
  // ==========================================================================

  const [logState, setLogState] = useState<"idle" | "saving" | "logged">("idle")

  // Re-armed on mount (StrictMode double-mounts in dev — see the identical
  // pattern in useNearbySchedules.ts). Gates the probe's post-await setState
  // so a resolution arriving after unmount never touches state.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Monotonic sequence for the hasLoggedToday probe below. Without this, a
  // probe started for meeting A can resolve AFTER the popup closes or
  // reopens on meeting B and write "logged" onto B's state — the exact bug
  // class Task 6's useNearbySchedules hit and fixed with sequence numbers
  // (fixSeqRef/fetchSeqRef there). The seq is bumped unconditionally at the
  // top of the effect — including on the "closing" run — so a probe that
  // was in flight when the popup closed is invalidated even though closing
  // doesn't unmount the component.
  const probeSeqRef = useRef(0)

  // Reset + probe the double-log guard each time the popup opens on a meeting
  useEffect(() => {
    const seq = ++probeSeqRef.current
    const isCurrent = () => mountedRef.current && probeSeqRef.current === seq
    if (!visible || !meeting?.id) return
    setLogState("idle")
    hasLoggedToday(meeting.id).then((logged) => {
      if (!isCurrent()) return
      if (logged) setLogState("logged")
    })
  }, [visible, meeting?.id])

  // Synchronous in-flight guard for the "I'm Here" double-tap race. React
  // state updates are not synchronous, so two taps landing in the same
  // event-loop tick can both read `logState === "idle"` before the first
  // tap's setLogState("saving") commits — `logState !== "idle"` alone does
  // NOT close this gap (Task 8 review finding). A ref is mutated the instant
  // the first tap is accepted, so the second tap's check sees it immediately.
  // The `disabled` prop on the button below is a second, UI-level line of
  // defense, not a substitute for this ref.
  const savingInFlightRef = useRef(false)

  const handleImHere = useCallback(async () => {
    if (!meeting || savingInFlightRef.current || logState !== "idle") return
    savingInFlightRef.current = true
    setLogState("saving")
    try {
      const result = await saveInPersonAttendance({
        uid: authStore.userId || "anonymous",
        mid: meeting.id,
        zid: meeting.zid,
        meetingName: meeting.name,
        durationMs: meeting.duration_ms || 60 * 60 * 1000, // default 1 h if the wire omitted duration
      })
      if (result.ok) {
        setLogState("logged")
        trackEvent("inperson_attendance_logged")
        toast.showToast({ tx: "inPersonPopup:attendanceSaved", type: "success" })
      } else {
        setLogState("idle")
        Alert.alert(translate("inPersonPopup:attendanceError"))
      }
    } catch (err) {
      log.error("I'm Here save threw", { mid: meeting.id, error: String(err) })
      setLogState("idle")
      Alert.alert(translate("inPersonPopup:attendanceError"))
    } finally {
      savingInFlightRef.current = false
    }
  }, [meeting, logState, authStore.userId, toast])

  // ==========================================================================
  // Derived display values
  // ==========================================================================

  const fellowshipColor = meeting
    ? FELLOWSHIP_COLORS[meeting.fellowship as Fellowship] || FELLOWSHIP_COLORS[Fellowship.NONE]
    : "#888"

  const formattedTime = meeting ? formatMillisToLocalTime(meeting.millis) : null

  const durationLabel = meeting?.duration_ms
    ? `${Math.round(meeting.duration_ms / 60000)} ${t("liveScreen:min")}`
    : null

  const handleCall = useCallback((phone: string) => {
    Linking.openURL(`tel:${phone}`).catch(() => {})
  }, [])

  const handleEmail = useCallback((email: string) => {
    Linking.openURL(`mailto:${email}`).catch(() => {})
  }, [])

  if (!meeting) return null

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={themed($overlay)}>
        <Pressable style={themed($backdrop)} onPress={onClose} />

        <View style={themed($content)}>
          {/* Unlike SchedulePopup's $content (which survives a bare maxHeight
              because its body is roughly fixed-height), this card's body is
              unbounded: the venue block, Get Directions button, and contacts
              list all add variable height, and ScheduleGrid grows one row per
              schedule entry with no maxHeight or scrolling of its own (it's
              plain Views — verified in ScheduleGrid.tsx, no nested-scroll
              conflict). Without this ScrollView, a meeting with several
              contacts and a busy schedule overflows the 85% cap and the
              bottom-most element — the "I'm Here" CTA — gets clipped
              off-screen. `bounces={false}` matches ReminderEditorModal's
              identical pattern. Touches here never reach the overlay-dismiss
              Pressable behind it: this ScrollView is nested inside $content,
              which is rendered (and therefore hit-tested) on top of the
              backdrop, so scrolling can never accidentally close the popup. */}
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={themed($header)}>
              <View
                style={[
                  $fellowshipBadge,
                  { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
                ]}
              >
                <Text style={[$fellowshipBadgeText, { color: fellowshipColor }]}>
                  {meeting.fellowship || "?"}
                </Text>
              </View>

              {formattedTime && <Text style={themed($headerTime)}>{formattedTime}</Text>}

              <Text style={themed($title)} numberOfLines={1}>
                {meeting.name}
              </Text>

              <Pressable
                onPress={onClose}
                style={themed($closeButton)}
                accessibilityRole="button"
                accessibilityLabel={t("common:close")}
              >
                <Ionicons name="chevron-down" size={24} color={theme.colors.textDim} />
              </Pressable>
            </View>

            {/* Meta row: time, duration, weekly count, language, hybrid note.
                Wraps, so a long language + hybrid pair drops to a second line
                rather than truncating. */}
            <View style={themed($metaRow)}>
              {formattedTime && (
                <View style={$metaItem}>
                  <Ionicons name="time-outline" size={14} color={theme.colors.textDim} />
                  <Text style={themed($metaText)}>{formattedTime}</Text>
                </View>
              )}
              {durationLabel && (
                <View style={$metaItem}>
                  <Ionicons name="hourglass-outline" size={14} color={theme.colors.textDim} />
                  <Text style={themed($metaText)}>{durationLabel}</Text>
                </View>
              )}
              {meetingCount > 0 && (
                <View style={$metaItem}>
                  <Ionicons name="people-outline" size={14} color={theme.colors.textDim} />
                  <Text style={themed($metaText)}>
                    {meetingCount === 1
                      ? t("liveScreen:meeting", { count: meetingCount })
                      : t("liveScreen:meetings", { count: meetingCount })}
                  </Text>
                </View>
              )}
              {!!meeting.language && (
                <View style={$metaItem}>
                  <Ionicons name="globe-outline" size={14} color={theme.colors.textDim} />
                  <Text style={themed($metaText)}>{meeting.language.toUpperCase()}</Text>
                </View>
              )}
              {/* Hybrid note — this meeting also has an online option.
                  CHANGED 2026-08-04: was globe-outline, on its own row below
                  the meta row. Language moved into the meta row wearing the
                  globe (that's what it means in SchedulePopup), so hybrid
                  needed its own glyph — two globes side by side would read as
                  one concept. videocam says "also meets online" without
                  colliding. Note MeetingRow's hybrid glyph is still the globe:
                  the row has no language icon to collide with, and changing it
                  would churn a component this branch just consolidated. */}
              {meeting.hybrid && (
                <View style={$metaItem}>
                  <Ionicons name="videocam-outline" size={14} color={theme.colors.textDim} />
                  <Text style={themed($metaText)} tx="inPersonPopup:alsoOnline" />
                </View>
              )}
            </View>

            {/* Meeting tags — same flattening as SchedulePopup: `tags` and
                `meetingTypes` are two upstream fields the user reads as one
                set of labels. Renders nothing when both are empty. */}
            {!!(meeting.tags?.length || meeting.meetingTypes?.length) && (
              <View style={themed($tagsRow)}>
                {[...(meeting.tags || []), ...(meeting.meetingTypes || [])].map((tag, idx) => (
                  <View key={idx} style={themed($tag)}>
                    <Text style={themed($tagText)}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Venue block */}
            <View style={themed($venueBlock)}>
              {!!meeting.venueName && <Text style={themed($venueName)}>{meeting.venueName}</Text>}
              {/* meeting.formattedAddress is populated on 0% of live in-person
                meetings — composedAddress (memoized above) builds it from
                street/city/state/postalCode instead, falling back to
                formattedAddress verbatim if it's ever non-empty. */}
              {!!composedAddress && <Text style={themed($venueLine)}>{composedAddress}</Text>}
              {!!meeting.locationInfo && (
                <Text style={themed($venueLineDim)}>{meeting.locationInfo}</Text>
              )}
              {meeting.approximate && (
                <View style={$approximateRow}>
                  <Ionicons name="information-circle-outline" size={13} color={WARNING_COLOR} />
                  <Text
                    style={[themed($venueLineDim), $approximateText]}
                    tx="inPersonPopup:approximate"
                  />
                </View>
              )}
            </View>

            {/* Action row: Get Directions (left) + feedback (right) — the same
                shape as SchedulePopup's Join + feedback row, with directions
                standing in for the join. The feedback block keeps flex:1 and
                right-alignment so the heart and stars stay pinned to the edge
                whether or not there's a directions button beside them (there
                isn't when the meeting has no coordinates AND no address — see
                buildDirectionsUrl). */}
            <View style={themed($actionRow)}>
              {!!directionsUrl && (
                <Pressable
                  onPress={handleDirections}
                  style={themed($directionsButton)}
                  accessibilityRole="button"
                >
                  <Ionicons name="navigate-outline" size={16} color={theme.colors.tint} />
                  <Text style={themed($directionsButtonText)} tx="inPersonPopup:getDirections" />
                </Pressable>
              )}

              <View style={themed($feedbackSection)}>
                <View style={themed($heartStarsRow)}>
                  <Pressable
                    onPress={handleToggleLove}
                    style={themed($heartButton)}
                    accessibilityRole="button"
                    accessibilityLabel={t("accessibility:favoriteToggle")}
                    accessibilityState={{ selected: isFavorite }}
                    accessibilityHint={t("accessibility:doubleTapToToggleFavorite")}
                  >
                    <Ionicons
                      name={isFavorite ? "heart" : "heart-outline"}
                      size={26}
                      color={isFavorite ? FAVORITE_COLOR : theme.colors.textDim}
                    />
                  </Pressable>
                  <View style={$ratingContainer}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Pressable
                        key={star}
                        onPress={() => handleSetRating(star)}
                        accessibilityRole="button"
                        accessibilityLabel={t("accessibility:rateStars", { count: star })}
                        accessibilityState={{ selected: star <= rating }}
                        accessibilityHint={t("accessibility:doubleTapToRate")}
                      >
                        <Ionicons
                          name={star <= rating ? "star" : "star-outline"}
                          size={20}
                          color={star <= rating ? STAR_COLOR : theme.colors.textDim}
                        />
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            </View>

            {/* Contacts */}
            {!!meeting.contacts?.length && (
              <View style={themed($contactsSection)}>
                <Text style={themed($sectionTitle)} tx="inPersonPopup:contacts" />
                {meeting.contacts.map((contact, idx) => (
                  <View key={idx} style={$contactRow}>
                    {!!contact.name && <Text style={themed($contactName)}>{contact.name}</Text>}
                    {!!contact.phone && (
                      <Pressable
                        onPress={() => handleCall(contact.phone)}
                        accessibilityRole="button"
                      >
                        <View style={$contactLine}>
                          <Ionicons name="call-outline" size={14} color={theme.colors.tint} />
                          <Text style={themed($contactLinkText)}>{contact.phone}</Text>
                        </View>
                      </Pressable>
                    )}
                    {!!contact.email && (
                      <Pressable
                        onPress={() => handleEmail(contact.email)}
                        accessibilityRole="button"
                      >
                        <View style={$contactLine}>
                          <Ionicons name="mail-outline" size={14} color={theme.colors.tint} />
                          <Text style={themed($contactLinkText)}>{contact.email}</Text>
                        </View>
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Schedule grid + reminders */}
            <ScheduleGrid
              scheduleData={scheduleGridData}
              currentDow={currentDow}
              onCellPress={handleCellPress}
              reminderCells={reminderCells}
            />
            <Text style={themed($reminderHint)} tx="inPersonPopup:tapTimesHint" />

            {/* "I'm Here" — only surfaced when attendance tracking is on */}
            {profileStore.attendanceEnabled && (
              <Pressable
                onPress={handleImHere}
                disabled={logState !== "idle"}
                style={[
                  themed($imHereButton),
                  logState === "logged" && themed($imHereButtonLogged),
                  logState === "saving" && themed($imHereButtonDisabled),
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: logState !== "idle" }}
              >
                {logState === "logged" && (
                  <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                )}
                <Text
                  style={themed($imHereButtonText)}
                  tx={
                    logState === "logged"
                      ? "inPersonPopup:logged"
                      : logState === "saving"
                        ? "inPersonPopup:imHereSaving"
                        : "inPersonPopup:imHere"
                  }
                />
              </Pressable>
            )}
          </ScrollView>
        </View>
      </View>

      {/* Reminder Editor Modal */}
      {meeting && (
        <ReminderEditorModal
          visible={reminderEditorVisible}
          onClose={() => setReminderEditorVisible(false)}
          meeting={meeting}
          existingReminder={editingReminder}
          selectedCell={selectedCell}
          sid={meeting.sid}
          onCreate={createReminder}
          onUpdate={updateReminder}
          onDelete={deleteReminder}
          onCheckOverlap={checkOverlap}
        />
      )}
    </Modal>
  )
})

// ============================================================================
// Styles
// ============================================================================

const $overlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  justifyContent: "flex-end",
})

const $backdrop: ThemedStyle<ViewStyle> = () => ({
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "rgba(0, 0, 0, 0.85)",
})

const $content: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  maxHeight: "85%",
  paddingTop: spacing.md,
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.xl,
})

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  paddingBottom: spacing.sm,
  gap: spacing.xs,
})

const $headerTime: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  fontWeight: "600",
  color: colors.text,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  fontSize: 16,
  fontWeight: "700",
  color: colors.text,
})

const $fellowshipBadge: ViewStyle = {
  paddingHorizontal: 10,
  paddingVertical: 4,
  borderRadius: 12,
  backgroundColor: "#000",
  borderWidth: 1.5,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 6,
  elevation: 8,
}

const $fellowshipBadgeText: TextStyle = {
  fontSize: 12,
  fontWeight: "700",
}

const $closeButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  padding: spacing.xs,
})

const $metaRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  gap: spacing.md,
  paddingBottom: spacing.xs,
})

const $metaItem: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  paddingBottom: 6,
}

const $metaText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $venueBlock: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingTop: spacing.xs,
  paddingBottom: spacing.sm,
})

const $venueName: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  fontWeight: "700",
  color: colors.text,
  marginBottom: 2,
})

const $venueLine: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.text,
  marginBottom: 2,
})

const $venueLineDim: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
  marginBottom: 2,
})

const $approximateRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  marginTop: 2,
}

const $approximateText: TextStyle = {
  marginBottom: 0,
}

// CHANGED 2026-08-04: dropped `marginBottom` — the button now lives inside
// $actionRow, which owns the gap to whatever follows. Left in place it
// double-spaced the row.
const $directionsButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#000",
  borderWidth: 1.5,
  borderColor: colors.tint,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.lg,
  borderRadius: 10,
  gap: spacing.xs,
  shadowColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $directionsButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 15,
  fontWeight: "600",
})

// Tags / feedback styles mirror SchedulePopup's so the two popups' headers
// are visually identical — a user moving between an online and an in-person
// meeting shouldn't feel the layout shift under them.
const $tagsRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.xs,
  paddingBottom: spacing.sm,
})

const $tag: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.border,
  paddingHorizontal: 10,
  paddingVertical: 4,
  borderRadius: 12,
})

const $tagText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  fontWeight: "600",
  color: colors.text,
})

// `alignItems: "flex-start"` keeps the directions button its natural height
// instead of stretching to match the stars column.
const $actionRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "flex-start",
  gap: spacing.md,
  marginBottom: spacing.md,
})

const $feedbackSection: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  alignItems: "flex-end",
})

const $heartStarsRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
})

const $heartButton: ThemedStyle<ViewStyle> = () => ({
  paddingHorizontal: 4,
})

const $ratingContainer: ViewStyle = {
  flexDirection: "row",
  gap: 4,
}

const $contactsSection: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.sm,
})

const $sectionTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  fontWeight: "700",
  color: colors.textDim,
  textTransform: "uppercase",
  marginBottom: 6,
})

const $contactRow: ViewStyle = {
  marginBottom: 8,
}

const $contactName: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  fontWeight: "600",
  color: colors.text,
  marginBottom: 2,
})

const $contactLine: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  paddingVertical: 2,
}

const $contactLinkText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.tint,
})

const $reminderHint: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 11,
  color: colors.textDim,
  textAlign: "center",
  marginTop: spacing.xs,
  marginBottom: spacing.md,
})

const $imHereButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.tint,
  paddingVertical: spacing.sm,
  borderRadius: 10,
  gap: spacing.xs,
})

const $imHereButtonDisabled: ThemedStyle<ViewStyle> = () => ({
  opacity: 0.7,
})

const $imHereButtonLogged: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.tintInactive,
})

const $imHereButtonText: ThemedStyle<TextStyle> = () => ({
  color: "#FFFFFF",
  fontSize: 16,
  fontWeight: "700",
})
