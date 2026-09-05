/**
 * SchedulePopup Component
 *
 * Modal popup showing meeting details and weekly schedule grid.
 * Displays:
 * - Meeting name with live indicator
 * - Fellowship badge (color-coded)
 * - Time, meeting count, language
 * - Meeting types (tags)
 * - Join Meeting button
 * - Favorite heart (UI only)
 * - 5-star rating (UI only)
 * - Weekly schedule grid
 */

import { FC, useMemo, useState, useEffect, useCallback, useRef } from "react"
import {
  Alert,
  Animated,
  InteractionManager,
  Linking,
  View,
  ViewStyle,
  TextStyle,
  Modal,
  Pressable,
  StyleSheet,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useIsFocused } from "@react-navigation/native"
import { FELLOWSHIP_COLORS, DateTime, Fellowship } from "@recoverysky-org/common/browser"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { ExternalZoomEducationModal } from "@/components/ExternalZoomEducationModal"
import { ExternalZoomTimerModal } from "@/components/ExternalZoomTimerModal"
import { ReminderEditorModal } from "@/components/ReminderEditorModal"
import { ScheduleGrid } from "@/components/ScheduleGrid"
import { Text } from "@/components/Text"
import { TopicPanelOverlay } from "@/components/TopicPanelOverlay"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { useSubscription } from "@/context/SubscriptionContext"
import { attendanceEvents, feedbackCache, type FeedbackRecord, type ReminderRecord } from "@/db"
import { useReminders } from "@/hooks/useReminders"
import { useTopicPanel } from "@/hooks/useTopicPanel"
import { useConfigStore, useProfileStore } from "@/models"
import { navigate } from "@/navigators/navigationUtilities"
import { maybePresentRatingPrompt } from "@/services/rating"
import { trackEvent } from "@/services/tracking"
import { useZoomMeeting, extractZoomMeetingNumber, buildExternalZoomUrl } from "@/services/zoom"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { decideScheduleLove } from "@/utils/favoriteLogic"
import { formatMillisToLocalTime } from "@/utils/formatTime"
import { logger } from "@/utils/logger"
import { buildMeetingReturnTo } from "@/utils/returnToLogic"
import { load, save } from "@/utils/storage"

const log = logger.child({ module: "SchedulePopup" })

// MMKV flag: shown once per install the first time the user joins a meeting
// with External Zoom enabled. Version suffix lets us reset if copy changes.
const EXTERNAL_ZOOM_EDUCATION_SEEN_KEY = "external-zoom-education-seen-v1"

// How long to wait after this popup's `visible` flips false before presenting
// the rating soft-ask. The outer Modal animates out with animationType="slide"
// (~300ms); we wait past that so the Alert lands on the clean screen underneath
// and never over a dismissing modal (presenting mid-dismiss freezes iOS UIKit —
// the v4.5.0-7/-8 bug). This is the cross-platform fallback; iOS additionally
// fires the Modal's onDismiss (precise, earlier) and a ref guards against both
// presenting for the same close.
const RATING_PROMPT_AFTER_CLOSE_MS = 550

interface SchedulePopupProps {
  visible: boolean
  meeting: MeetingWithTrex | null
  onClose: () => void
}

export const SchedulePopup: FC<SchedulePopupProps> = observer(function SchedulePopup({
  visible,
  meeting,
  onClose,
}) {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()
  const configStore = useConfigStore()
  const isFocused = useIsFocused()

  // Auto-close when parent screen loses focus (e.g. navigating to Settings from review prompt)
  useEffect(() => {
    if (!isFocused && visible) onClose()
  }, [isFocused, visible, onClose])

  // Present the rating soft-ask AFTER this popup fully closes — never while it
  // (or the nested timer modal) is mid-dismiss, which freezes iOS UIKit. The
  // rating engine counts the meeting from inside the timer Save flow but defers
  // presentation to here (see recordEvent / maybePresentRatingPrompt). Eligibility
  // is re-checked inside maybePresentRatingPrompt, so a close with nothing to show
  // is a no-op.
  const ratingShownForCloseRef = useRef(false)
  const prevVisibleRef = useRef(visible)
  const presentRatingAfterClose = useCallback((trigger: string) => {
    // Guard: at most one present per close. onDismiss (iOS) and the settle-timeout
    // fallback both target the same close — whichever fires first wins.
    if (ratingShownForCloseRef.current) {
      log.info("rating[diag]: present-after-close already fired this cycle", { trigger })
      return
    }
    ratingShownForCloseRef.current = true
    log.info("rating[diag]: present-after-close firing", { trigger })
    maybePresentRatingPrompt()
  }, [])
  useEffect(() => {
    const wasVisible = prevVisibleRef.current
    prevVisibleRef.current = visible
    if (visible) {
      ratingShownForCloseRef.current = false // re-arm for the next close
      return undefined
    }
    if (!wasVisible) return undefined // already closed; not a fresh close
    // Popup just closed. Fallback path (covers Android, which never calls
    // onDismiss, and any transparent-modal onDismiss no-show on iOS): present
    // once the slide-out has finished. See RATING_PROMPT_AFTER_CLOSE_MS.
    log.info("rating[diag]: popup closed → scheduling present-after-close", {
      delayMs: RATING_PROMPT_AFTER_CLOSE_MS,
    })
    const id = setTimeout(() => presentRatingAfterClose("timeout"), RATING_PROMPT_AFTER_CLOSE_MS)
    return () => clearTimeout(id)
  }, [visible, presentRatingAfterClose])
  const { isJoining } = useZoomMeeting()
  const { isPremium } = useSubscription()
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)

  // External Zoom timer modal state
  const [timerVisible, setTimerVisible] = useState(false)

  // First-time External Zoom education popup. Shown once per install, gated
  // by the MMKV flag. While visible, the actual join action is deferred and
  // stashed in the ref, then invoked when the user taps Continue.
  const [educationVisible, setEducationVisible] = useState(false)
  const educationActionRef = useRef<(() => void) | null>(null)

  // Topic/host prompt shown after attendance is recorded for this meeting.
  // Rendered INLINE as a slide-up panel over the popup's body so it doesn't
  // present a new RN Modal during the Zoom SDK's native dismiss animation
  // (which iOS silently refuses). Both SDK and external paths funnel through
  // the shared `attendanceEvents` "processed" subscription, which now lives
  // inside useTopicPanel (see below).
  // EXTRACTED 2026-08-05: state, both animation drivers, the "processed"
  // subscription, and the save/skip handlers moved into useTopicPanel so
  // InPersonPopup (Task 10) can render the identical panel instead of a
  // hand-written second copy.
  const {
    topicActive: _topicActive,
    cardAnimatedStyle,
    onCardLayout,
    panelProps,
  } = useTopicPanel({
    visible,
    meetingId: meeting?.id,
    meetingName: meeting?.name,
    // Always true: the external-Zoom path has no SDK-side host capture, so the
    // user is the only source for it. Replaces the old attendanceSourceRef
    // check, which could only ever be "external" after the 4.5.0 SDK removal.
    includeHost: true,
  })

  // Reminder state
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
                  // `Meetings:meetingId:<id>` (the legacy form, which
                  // parseReturnTo still accepts for strings already persisted
                  // in MMKV). Emitting the explicit form via the helper keeps
                  // every producer on one grammar — hand-assembly is how the
                  // in-person popup ended up sending a live-only string.
                  returnTo: buildMeetingReturnTo("live", meeting!.id),
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
    [isPremium, configStore, findExistingReminder, t, onClose],
  )

  // Local feedback state - initialized from cache, updated on interactions
  const [feedback, setFeedback] = useState<FeedbackRecord | null>(null)

  // Attendance banner state
  const [showBanner, setShowBanner] = useState(false)
  const bannerOpacity = useRef(new Animated.Value(0)).current
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Subscribe to attendance events. The popup owns one reaction here — the
  // "processed" → topic-panel reaction moved into useTopicPanel above.
  //   "acknowledged" → show the "Attendance Saved" banner.
  useEffect(() => {
    if (!visible || !meeting?.id) return

    const unsub = attendanceEvents.subscribe((event) => {
      if (event.mid !== meeting.id) return

      // Banner fires on "acknowledged" (emitted by useTopicPanel after the
      // topic panel resolves, or immediately when topic capture is disabled)
      // so it never flashes behind the topic UI.
      if (event.type === "acknowledged" && event.valid) {
        setShowBanner(true)
        Animated.timing(bannerOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start()

        // Auto-hide after 4 seconds
        bannerTimeoutRef.current = setTimeout(() => {
          Animated.timing(bannerOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start(() => setShowBanner(false))
        }, 4000)
      }
    })

    return () => {
      unsub()
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current)
    }
  }, [visible, meeting?.id, bannerOpacity])

  // Reset banner when popup closes
  useEffect(() => {
    if (!visible) {
      setShowBanner(false)
      bannerOpacity.setValue(0)
      if (bannerTimeoutRef.current) {
        clearTimeout(bannerTimeoutRef.current)
        bannerTimeoutRef.current = null
      }
    }
  }, [visible, bannerOpacity])

  // Track popup views
  useEffect(() => {
    if (visible && meeting?.id) {
      trackEvent("schedule_popup_viewed", { fellowship: meeting.fellowship || "" })
    }
  }, [visible, meeting?.id])

  // Load feedback from cache when popup opens (synchronous read)
  useEffect(() => {
    if (visible && meeting?.id) {
      const cached = feedbackCache.get(meeting.id)
      setFeedback(cached)
      log.debug("Loaded feedback from cache", { mid: meeting.id, hasValue: !!cached })
    } else {
      setFeedback(null)
    }
  }, [visible, meeting?.id])

  // Derived state from feedback
  const isFavorite = feedback?.loves ?? false
  const rating = feedback?.rates ?? 0
  const joinCount = feedback?.joins ?? 0
  const lastJoin = feedback?.lastJoin ?? 0

  // Toggle love/favorite
  // CHANGED 2026-09-04: favoriting is schedule-wide — the tap's new value is
  // SET on every meeting in `scheduleData` (decideScheduleLove picks the mids
  // and the value), so a Monday favorite favorites the whole schedule. Current
  // state is read from the cache, not the local mirror, and local state is
  // read back afterwards rather than hand-built — that way a persist
  // failure's revert inside setLoveForMids shows here too.
  const handleToggleLove = useCallback(async () => {
    if (!meeting?.id) return
    const { mids, loves } = decideScheduleLove({
      tappedMid: meeting.id,
      currentLoves: feedbackCache.get(meeting.id)?.loves ?? false,
      scheduleData: meeting.scheduleData,
    })
    await feedbackCache.setLoveForMids(mids, loves)
    setFeedback(feedbackCache.get(meeting.id))
    // One event per gesture, not one per sibling meeting.
    trackEvent("meeting_favorited", {
      action: loves ? "add" : "remove",
      scheduleSize: mids.length,
    })
    log.debug("Toggled love", { mid: meeting.id, loves, scheduleSize: mids.length })
  }, [meeting?.id, meeting?.scheduleData])

  // Set rating
  const handleSetRating = useCallback(
    async (star: number) => {
      if (!meeting?.id) return
      await feedbackCache.setRating(meeting.id, star)
      setFeedback((prev: FeedbackRecord | null) =>
        prev
          ? { ...prev, rates: star }
          : { mid: meeting.id, loves: false, rates: star, joins: 0, lastJoin: 0 },
      )
      log.debug("Set rating", { mid: meeting.id, rating: star })
    },
    [meeting?.id],
  )

  // Schedule grid data comes directly from API
  const scheduleGridData = useMemo(() => {
    return meeting?.scheduleData || []
  }, [meeting?.scheduleData])

  // Meeting count from schedule data
  const meetingCount = useMemo(() => {
    if (!scheduleGridData.length) return 0
    // Count non-null entries across all rows
    return scheduleGridData.reduce((count, row) => {
      return count + row.filter((cell) => cell !== null).length
    }, 0)
  }, [scheduleGridData])

  // Current day for highlighting (1=Mon, 7=Sun)
  const currentDow = DateTime.now().weekday

  // Memoized meeting payload for ExternalZoomTimerModal — prevents the
  // timer from resetting whenever SchedulePopup re-renders (which happens
  // frequently as an observer). See ExternalZoomTimerModal for details.
  const timerMeeting = useMemo(() => {
    if (!meeting?.url || !meeting?.id) return null
    return {
      id: meeting.id,
      name: meeting.name,
      url: buildExternalZoomUrl({
        meetingNumber: extractZoomMeetingNumber(meeting.url) ?? "",
        meetingUrl: meeting.url,
        password: meeting.password,
        passwordEnc: meeting.passwordEnc,
        userName: profileStore.displayName,
      }),
    }
  }, [
    meeting?.id,
    meeting?.url,
    meeting?.name,
    meeting?.password,
    meeting?.passwordEnc,
    profileStore.displayName,
  ])

  const fellowshipColor = meeting
    ? FELLOWSHIP_COLORS[meeting.fellowship as Fellowship] || FELLOWSHIP_COLORS[Fellowship.NONE]
    : "#888"

  const formattedTime = meeting ? formatMillisToLocalTime(meeting.millis) : null

  const handleJoin = async () => {
    if (!meeting?.url || !meeting?.id) return

    // Record the join in feedback BEFORE joining
    await feedbackCache.recordJoin(meeting.id)
    const now = Date.now()
    setFeedback((prev: FeedbackRecord | null) =>
      prev
        ? { ...prev, joins: prev.joins + 1, lastJoin: now }
        : { mid: meeting.id, loves: false, rates: 0, joins: 1, lastJoin: now },
    )
    log.info("Recorded join", { mid: meeting.id, joins: (feedback?.joins ?? 0) + 1 })
    trackEvent("meeting_joined", { fellowship: meeting.fellowship || "" })

    // Extract meeting number from URL
    const meetingNumber = extractZoomMeetingNumber(meeting.url)
    // SDK expects the plaintext passcode, not the encrypted pwd from URLs
    const password = meeting.password || ""

    if (!meetingNumber) {
      // Fallback for non-Zoom URLs. Guarded: Linking.openURL throws
      // synchronously on non-string args (rare but possible if the meeting
      // record is malformed) and rejects on no-handler — both are caught
      // here so an unhandled rejection can't terminate the app.
      const fallbackUrl = meeting.url
      if (typeof fallbackUrl !== "string" || fallbackUrl.length === 0) {
        log.warn("Skipping non-Zoom launch: meeting.url is not a usable string", {
          mid: meeting.id,
        })
        return
      }
      try {
        await Linking.openURL(fallbackUrl)
      } catch (err) {
        log.error("Failed to open non-Zoom URL", {
          mid: meeting.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }

    // All joins go through the external Zoom app (the in-app SDK was
    // removed in 4.5.0). Show the timer modal first when attendance is
    // enabled — the modal launches Zoom and captures the user-confirmed
    // attendance window. When attendance is off, open Zoom directly.
    const proceedExternalJoin = () => {
      if (profileStore.attendanceEnabled) {
        // Tag the source so the "processed" subscription shows the host
        // field when the topic panel slides in.
        // CHANGED 2026-08-05: attendanceSourceRef removed — useTopicPanel now
        // takes includeHost as a static prop (always true, see the hook call
        // above) because both SchedulePopup and the in-person popup want the
        // host field, and external-Zoom was the only source this ref could
        // ever hold since the 4.5.0 SDK removal anyway.
        setTimerVisible(true)
      } else {
        const zoomUrl = buildExternalZoomUrl({
          meetingNumber,
          meetingUrl: meeting.url,
          password: meeting.password,
          passwordEnc: meeting.passwordEnc,
          userName: profileStore.displayName,
        })
        // Guarded: buildExternalZoomUrl always returns a string today, but
        // a defensive check costs nothing and stops a malformed-record
        // class of crash. .catch is mandatory — without it, a no-handler
        // rejection (Zoom not installed, bad URL) bubbles up as an
        // unhandled rejection that release builds with strict-mode
        // promise tracking will treat as fatal.
        if (typeof zoomUrl !== "string" || zoomUrl.length === 0) {
          log.warn("Skipping external Zoom launch: empty URL", { mid: meeting.id })
          return
        }
        Linking.openURL(zoomUrl).catch((err: unknown) => {
          log.error("Failed to open external Zoom", {
            mid: meeting.id,
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }
    }

    // First-time education: defer the actual join until the user taps
    // Continue in the education modal.
    const educationSeen = load<boolean>(EXTERNAL_ZOOM_EDUCATION_SEEN_KEY) === true
    if (!educationSeen) {
      educationActionRef.current = proceedExternalJoin
      setEducationVisible(true)
      return
    }

    proceedExternalJoin()
  }

  const handleEducationContinue = useCallback(() => {
    save(EXTERNAL_ZOOM_EDUCATION_SEEN_KEY, true)
    setEducationVisible(false)
    const next = educationActionRef.current
    educationActionRef.current = null
    if (!next) return
    // Defer the next action until the Education modal's dismiss animation
    // settles. iOS UIKit will throw "Application tried to present X while
    // presentation is in progress" if a second modal mounts (TimerModal) or
    // a system sheet appears (Linking → Zoom universal-link confirmation)
    // while the dismiss is still animating. runAfterInteractions waits for
    // the current animation/gesture batch to complete before running.
    InteractionManager.runAfterInteractions(next)
  }, [])

  if (!meeting) return null

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      // iOS: fires once the slide-out finishes — the precise, earliest-safe
      // moment to present the rating soft-ask (the useEffect timeout above is the
      // Android / no-show fallback; a ref dedupes the two).
      onDismiss={() => presentRatingAfterClose("onDismiss")}
      statusBarTranslucent
    >
      <View style={themed($overlay)}>
        <Pressable style={themed($backdrop)} onPress={onClose} />

        {/* cardAnimatedStyle and onCardLayout are load-bearing for the topic
            panel, which is NOT defined in this file: cardAnimatedStyle is a
            useNativeDriver:false tween owned by useTopicPanel (layout props
            like minHeight/maxHeight/borderRadius can't be native-driven), and
            onCardLayout feeds the height measurement TopicPanelOverlay
            translates by when it slides in. Swapping either out — e.g. for a
            local measurement or a different maxHeight source — silently
            breaks the panel two files away. See the EXTRACTED 2026-08-05
            block above (near the useTopicPanel call) for the full picture. */}
        <Animated.View
          style={[themed($content), cardAnimatedStyle]}
          accessibilityViewIsModal
          onLayout={onCardLayout}
        >
          {/* Attendance banner */}
          {showBanner && (
            <Pressable
              onPress={() => {
                onClose()
                navigate("Attendance", { section: "new" })
              }}
            >
              <Animated.View
                style={[
                  $attendanceBanner,
                  { backgroundColor: theme.colors.tint, opacity: bannerOpacity },
                ]}
              >
                <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                <Text style={$attendanceBannerText} tx="zoomMeeting:attendanceSaved" />
              </Animated.View>
            </Pressable>
          )}

          {/* Header */}
          <View style={themed($header)}>
            {/* Fellowship badge */}
            <View
              style={[
                themed($fellowshipBadge),
                { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
              ]}
            >
              <Text style={[$fellowshipBadgeText, { color: fellowshipColor }]}>
                {meeting.fellowship || "?"}
              </Text>
            </View>

            {/* Time */}
            {formattedTime && <Text style={themed($headerTime)}>{formattedTime}</Text>}

            {/* Meeting name */}
            <Text style={themed($title)} numberOfLines={1}>
              {meeting.name}
            </Text>

            {/* Close button */}
            <Pressable
              onPress={onClose}
              style={themed($closeButton)}
              accessibilityRole="button"
              accessibilityLabel={t("common:close")}
            >
              <Ionicons name="chevron-up" size={24} color={theme.colors.textDim} />
            </Pressable>
          </View>

          {/* Meta info */}
          <View style={themed($metaRow)}>
            {formattedTime && (
              <View style={$metaItem}>
                <Ionicons name="time-outline" size={14} color={theme.colors.textDim} />
                <Text style={themed($metaText)}>{formattedTime}</Text>
              </View>
            )}
            <View style={$metaItem}>
              <Ionicons name="hourglass-outline" size={14} color={theme.colors.textDim} />
              <Text style={themed($metaText)}>
                {meeting.duration_ms
                  ? `${Math.round(meeting.duration_ms / 60000)} ${t("liveScreen:min")}`
                  : "24h"}
              </Text>
            </View>
            <View style={$metaItem}>
              <Ionicons name="people-outline" size={14} color={theme.colors.textDim} />
              <Text style={themed($metaText)}>
                {meetingCount === 1
                  ? t("liveScreen:meeting", { count: meetingCount })
                  : t("liveScreen:meetings", { count: meetingCount })}
              </Text>
            </View>
            {meeting.language && (
              <View style={$metaItem}>
                <Ionicons name="globe-outline" size={14} color={theme.colors.textDim} />
                <Text style={themed($metaText)}>{meeting.language.toUpperCase()}</Text>
              </View>
            )}
          </View>

          {/* Meeting tags */}
          <View style={themed($tagsRow)}>
            {[...(meeting.tags || []), ...(meeting.meetingTypes || [])].map((tag, idx) => (
              <View key={idx} style={themed($tag)}>
                <Text style={themed($tagText)}>{tag}</Text>
              </View>
            ))}
          </View>

          {/* Join button and Feedback row */}
          <View style={themed($actionRow)}>
            {/* Join button (left) */}
            {meeting.url && (
              <Pressable
                onPress={handleJoin}
                style={[themed($joinButton), isJoining && themed($joinButtonDisabled)]}
                disabled={isJoining}
                accessibilityRole="button"
                accessibilityLabel={
                  isJoining ? t("liveScreen:joining") : t("liveScreen:joinMeeting")
                }
                accessibilityState={{ disabled: isJoining }}
              >
                <Text style={themed($joinButtonText)}>
                  {isJoining ? t("liveScreen:joining") : t("liveScreen:joinMeeting")}
                </Text>
                <Ionicons name="open-outline" size={16} color={theme.colors.tint} />
              </Pressable>
            )}

            {/* Feedback section (right) */}
            <View style={themed($feedbackSection)}>
              {/* Heart and Stars row */}
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
                    color={isFavorite ? "#ef4444" : theme.colors.textDim}
                  />
                </Pressable>
                <View style={themed($ratingContainer)}>
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
                        color={star <= rating ? "#fbbf24" : theme.colors.textDim}
                      />
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Joins and time ago row */}
              {joinCount > 0 && (
                <View style={themed($joinsRow)}>
                  <Ionicons name="enter-outline" size={14} color={theme.colors.textDim} />
                  <Text style={themed($joinsText)}>
                    {joinCount} {joinCount === 1 ? t("liveScreen:join") : t("liveScreen:joins")}
                    {lastJoin > 0 && ` · ${DateTime.fromMillis(lastJoin).toRelative()}`}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Description - tap to expand */}
          {meeting.description ? (
            <Pressable
              onPress={() => setDescriptionExpanded(!descriptionExpanded)}
              accessibilityRole="button"
              accessibilityLabel={t("accessibility:expandDescription")}
              accessibilityHint={t("accessibility:doubleTapToExpand")}
            >
              <Text
                style={themed($description)}
                numberOfLines={descriptionExpanded ? undefined : 5}
              >
                {meeting.description}
              </Text>
              {!descriptionExpanded && meeting.description.length > 200 && (
                <Text style={themed($readMore)}>{t("liveScreen:tapToReadMore")}</Text>
              )}
            </Pressable>
          ) : null}

          {/* Schedule Grid */}
          <ScheduleGrid
            scheduleData={scheduleGridData}
            currentDow={currentDow}
            onCellPress={handleCellPress}
            reminderCells={reminderCells}
          />

          <Text style={themed($reminderHint)} tx="liveScreen:tapTimesHint" />

          {/* Slide-in topic panel. Rendered inside $content (not as its own
              Modal) so iOS doesn't have to present a second native modal
              over the Zoom SDK's dismiss animation — which is the race that
              broke the previous TopicPromptModal approach.
              EXTRACTED 2026-08-05: render moved into TopicPanelOverlay; all
              state/animation lives in useTopicPanel above (panelProps). */}
          <TopicPanelOverlay {...panelProps} />
        </Animated.View>
      </View>

      {/* External Zoom first-time Education Modal */}
      <ExternalZoomEducationModal visible={educationVisible} onContinue={handleEducationContinue} />

      {/* External Zoom Timer Modal */}
      {meeting && (
        <ExternalZoomTimerModal
          visible={timerVisible}
          meeting={timerMeeting}
          onClose={() => setTimerVisible(false)}
          onSaved={() => {
            // Just close the timer. saveTimerAttendance (inside the timer
            // modal) already emitted `attendanceEvents.processed`, which
            // the subscription above picks up to slide in the topic panel
            // or fire the banner directly.
            setTimerVisible(false)
          }}
        />
      )}

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

// Was a plain ViewStyle with a hardcoded "#000". CHANGED 2026-08-09: black
// against the light-mode sheet (colors.background) read as an unstyled slab.
// colors.card is the elevated surface in both themes, so it sits a step above
// the sheet either way. borderColor / shadowColor are still supplied inline at
// the call site because they track the fellowship tint, not the theme.
const $fellowshipBadge: ThemedStyle<ViewStyle> = ({ colors }) => ({
  paddingHorizontal: 10,
  paddingVertical: 4,
  borderRadius: 12,
  backgroundColor: colors.card,
  borderWidth: 1.5,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 6,
  elevation: 8,
})

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
  paddingBottom: spacing.sm,
})

const $metaItem: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
}

const $metaText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $description: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 14,
  color: colors.textDim,
  lineHeight: 20,
  marginBottom: spacing.xs,
})

const $readMore: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 13,
  color: colors.tint,
  marginBottom: spacing.sm,
})

const $reminderHint: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 11,
  color: colors.textDim,
  textAlign: "center",
  marginTop: spacing.xs,
})

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

const $joinsRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  marginTop: spacing.xs,
})

const $joinsText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $heartButton: ThemedStyle<ViewStyle> = () => ({
  paddingHorizontal: 4,
})

const $joinButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  // Was a hardcoded "#000". CHANGED 2026-08-09: same light-mode black-slab fix
  // as the Settings CTA buttons — colors.card follows the theme instead.
  backgroundColor: colors.card,
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

const $joinButtonDisabled: ThemedStyle<ViewStyle> = () => ({
  opacity: 0.7,
})

const $joinButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 16,
  fontWeight: "600",
})

const $ratingContainer: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
  gap: 4,
})

const $attendanceBanner: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  paddingVertical: 10,
  paddingHorizontal: 16,
  borderRadius: 10,
  marginBottom: 8,
}

const $attendanceBannerText: TextStyle = {
  fontSize: 15,
  fontWeight: "600",
  color: "#FFFFFF",
}
