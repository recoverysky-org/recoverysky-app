/**
 * MeetingRow — the one meeting row, for every venue.
 *
 * Replaces `LiveMeetingRow` and `InPersonScheduleRow` (2026-08-04). The two
 * had drifted into different shapes for the same object — a square fellowship
 * badge and one line of text vs. an accent bar and two — which was fine while
 * each lived on its own screen and became untenable the moment the Search
 * segment showed both venues in a single list. Layout no longer pivots on
 * which screen you're on; the pieces that only some meetings have (venue line,
 * distance, hybrid glyph, external-Zoom glyph) render when the data is there
 * and are absent when it isn't.
 *
 *   ┃ NA  Grupo Novo Amanhecer          ♥ 5:00a PT
 *                                          ★★★★★
 *
 *   ┃ AA  Sunrise Serenity                7:00a EN
 *   ┃     St. Mark's Church • Boise         0.8 mi
 *
 * The fellowship kept its text and its colour and lost the box — it no longer
 * spends 32dp of leading width and a shadow on two characters. A second line
 * appears only when the meeting has somewhere to be, so online rows stay as
 * compact as they were.
 *
 * Still deliberately dumb about the badge slot: `distanceLabel` and `venueTag`
 * both arrive pre-formatted and pre-translated from the caller rather than
 * being derived here, keeping unit/locale decisions in one place. When neither
 * is supplied the badge must not render at all, not render empty — see the
 * omission test.
 */

import { FC, useMemo } from "react"
import { View, ViewStyle, TextStyle, Pressable } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { FELLOWSHIP_COLORS, Fellowship } from "@recoverysky-org/common/browser"

import { Text } from "@/components/Text"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { translate } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { formatMillisToLocalTime } from "@/utils/formatTime"

const REMINDER_COLOR = "#f59e0b"
const FAVORITE_COLOR = "#ef4444"
const STAR_COLOR = "#fbbf24"
const ZOOM_BLUE = "#2D8CFF"

interface MeetingRowProps {
  /** Meeting data with millis, feedback, and (for venues) venue fields */
  meeting: MeetingWithTrex
  /** User's rating (0-5 stars) — overrides meeting.feedback.rates for live updates */
  rating?: number
  /** Whether user has favorited — overrides meeting.feedback.loves for live updates */
  isFavorite?: boolean
  /** Whether any meeting in this schedule has a reminder set */
  hasReminder?: boolean
  /** Pre-formatted distance ("0.8 mi"). Only ever set for in-person results
   *  fetched with a location fix; omitted everywhere else. */
  distanceLabel?: string
  /**
   * Pre-translated venue word ("Online") shown in the distance badge's slot
   * when there is no distance.
   *
   * Only mixed lists should pass it. On Live every meeting is online and on
   * In-Person every meeting is a venue, so a tag there would label every row
   * with the same word — noise that says nothing. Caller-owned and already
   * translated, same contract as `distanceLabel`.
   */
  venueTag?: string
  /** Callback when row is pressed */
  onPress?: (meeting: MeetingWithTrex) => void
}

/**
 * @example
 * <MeetingRow
 *   meeting={meeting}
 *   rating={feedback?.rates ?? 0}
 *   isFavorite={feedback?.loves ?? false}
 *   distanceLabel={formatDistance(meeting.distance_m, useMiles) || undefined}
 *   onPress={(m) => openPopup(m)}
 * />
 */
export const MeetingRow: FC<MeetingRowProps> = ({
  meeting,
  rating = 0,
  isFavorite = false,
  hasReminder = false,
  distanceLabel,
  venueTag,
  onPress,
}) => {
  const { themed, theme } = useAppTheme()

  const startTime = useMemo(
    () => (meeting.millis === 0 ? "24h" : formatMillisToLocalTime(meeting.millis)),
    [meeting.millis],
  )

  const fellowshipColor = useMemo(() => {
    return FELLOWSHIP_COLORS[meeting.fellowship as Fellowship] || FELLOWSHIP_COLORS[Fellowship.NONE]
  }, [meeting.fellowship])

  // Venue half of the subtitle. Composed from fields the meeting already
  // carries rather than introducing new copy (per the i18n guidance: prefer
  // composition over new strings when the source fields are enough). Empty for
  // online meetings, which is what collapses the subtitle to a bare
  // fellowship — no branch on venueType needed.
  const venueLine = [meeting.venueName, meeting.city].filter(Boolean).join(" • ")

  return (
    <Pressable
      style={themed($container)}
      onPress={() => onPress?.(meeting)}
      accessibilityRole="button"
      // Distance is appended, not omitted: `$rightSection` is
      // accessible={false}, so the badge is invisible to VoiceOver. When a
      // list is sorted nearest-first, that ordering is unexplained without it.
      // Undefined wherever there is no distance to announce — hence the filter
      // rather than a bare template.
      accessibilityLabel={[
        `${meeting.fellowship || ""} ${meeting.name}`.trim(),
        startTime,
        // Mirrors the badge slot's precedence so the spoken row matches the
        // seen one — never both, never the wrong one.
        distanceLabel || venueTag,
      ]
        .filter(Boolean)
        .join(", ")}
      accessibilityHint={translate("accessibility:doubleTapToView")}
    >
      {/* Accent bar. Uses the app's theme tint (the user's chosen colour),
          NOT the fellowship colour, even though it replaced a badge that was
          fellowship-coloured: at badge-text size a fellowship colour reads as
          a small accent, but at full-row-height bar size it dominated — a
          screen of NA meetings became a column of green stripes fighting the
          pink theme. The fellowship colour survives on the subtitle token
          below, which is back at text size. Don't move it back up here
          without shrinking the bar. */}
      <View style={[$accentBar, { backgroundColor: theme.colors.tint }]} accessible={false} />

      <View style={$textColumn} accessible={false}>
        <View style={$nameRow}>
          {/* Where the old square badge's content went — same text, same
              fellowship colour, minus the box. Kept on the NAME row rather
              than moved down to the subtitle: online meetings have no venue
              line, so a subtitle would exist solely to hold two characters and
              would add a second line to every row in a ~50-row Live list. Here
              an online meeting stays one line and only meetings with somewhere
              to be get two. */}
          {!!meeting.fellowship && (
            <Text style={[$fellowshipText, { color: fellowshipColor }]}>{meeting.fellowship}</Text>
          )}
          <Text style={themed($meetingName)} numberOfLines={1}>
            {meeting.name}
          </Text>
          {/* External-Zoom marker: this meeting opens in the installed Zoom
              app rather than in-app. Online meetings only — `external` is
              never set on a venue. */}
          {meeting.external && <Text style={$externalZoomIcon}>Z</Text>}
          {hasReminder && (
            <Ionicons
              testID="reminder-bell"
              name="notifications"
              size={14}
              color={REMINDER_COLOR}
              style={$bellIcon}
            />
          )}
        </View>

        {/* Venue line — the whole of the second line, and the only reason a
            row is ever two lines. Absent for online meetings, which is what
            keeps this component free of a venueType branch. */}
        {venueLine.length > 0 && (
          <Text style={themed($subtitle)} numberOfLines={1}>
            {venueLine}
          </Text>
        )}
      </View>

      <View style={$rightSection} accessible={false}>
        <View style={$timeRow}>
          {isFavorite && (
            <Ionicons
              testID="favorite-heart"
              name="heart"
              size={16}
              color={FAVORITE_COLOR}
              style={$heartIcon}
            />
          )}
          <Text style={themed($timeText)}>{startTime}</Text>
          {!!meeting.language && (
            <Text style={themed($languageText)}>{meeting.language.toUpperCase()}</Text>
          )}
          {/* Hybrid: an in-person meeting that also meets online. */}
          {meeting.hybrid && (
            <Ionicons
              testID="hybrid-indicator"
              name="globe-outline"
              size={14}
              color={theme.colors.textDim}
              style={$hybridIcon}
            />
          )}
        </View>

        {rating > 0 && (
          <View style={$starsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Ionicons
                key={star}
                name={star <= rating ? "star" : "star-outline"}
                size={10}
                color={star <= rating ? STAR_COLOR : theme.colors.textDim}
              />
            ))}
          </View>
        )}

        {/* One badge slot, two possible occupants. Distance wins when we have
            it; `venueTag` fills the same spot otherwise, which is how a mixed
            list (Search) marks its online meetings in the place the eye is
            already checking for distance. Absent — not empty — when neither is
            supplied. Stacks under the stars rather than replacing them: a
            venue you've rated has both, and dropping either loses information. */}
        {!!distanceLabel && (
          <View testID="distance-badge" style={themed($slotBadge)}>
            <Text style={themed($slotBadgeText)}>{distanceLabel}</Text>
          </View>
        )}
        {!distanceLabel && !!venueTag && (
          <View testID="venue-tag" style={themed($slotBadge)}>
            <Text style={themed($slotBadgeText)}>{venueTag}</Text>
          </View>
        )}
      </View>
    </Pressable>
  )
}

// ============================================================================
// Styles
// ============================================================================

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  paddingVertical: spacing.sm,
  gap: spacing.xs,
  minHeight: 44,
})

const $accentBar: ViewStyle = {
  width: 4,
  alignSelf: "stretch",
  borderRadius: 2,
}

const $textColumn: ViewStyle = {
  flex: 1,
  minWidth: 0,
}

const $nameRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
}

// Fellowship codes are 2-3 characters ("AA", "CMA"). minWidth keeps the
// meeting names left-aligned with each other down the list instead of jogging
// by a few px whenever a three-letter fellowship appears.
const $fellowshipText: TextStyle = {
  fontSize: 11,
  fontWeight: "700",
  minWidth: 26,
  marginRight: 6,
}

const $meetingName: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  fontSize: 14,
  fontWeight: "600",
  color: colors.text,
})

const $externalZoomIcon: TextStyle = {
  fontSize: 13,
  fontWeight: "800",
  color: ZOOM_BLUE,
  marginLeft: 4,
}

const $bellIcon: ViewStyle = {
  marginLeft: 4,
}

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
  marginTop: 2,
})

const $rightSection: ViewStyle = {
  alignItems: "flex-end",
  marginLeft: "auto",
}

const $timeRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
}

const $heartIcon: ViewStyle = {
  marginRight: 4,
}

const $timeText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $languageText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 11,
  color: colors.textDim,
  marginLeft: 4,
})

const $hybridIcon: ViewStyle = {
  marginLeft: 4,
}

const $starsRow: ViewStyle = {
  flexDirection: "row",
  marginTop: 2,
}

// Shared by the distance badge and the venue tag — they occupy the same slot
// and must be visually identical, or the eye reads them as different kinds of
// thing rather than two answers to "where is this?".
const $slotBadge: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
  borderRadius: 8,
  paddingHorizontal: 6,
  paddingVertical: 2,
  marginTop: 2,
})

const $slotBadgeText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 11,
  color: colors.textDim,
})
