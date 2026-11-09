/**
 * RoutineResultsCard: the person's routine from a Sky `get_today` answer, in My Day's look.
 *
 * ADDED 2026-11-08. On a RecoverySky turn the agent tells Sky the person sees their routine as a
 * card, so she never lists it (agent `ROUTINE_CARD_RULE`): this card is how the items reach the
 * person. Jenova chose My Day's own look for it (glass over the launch's photo, Playfair for the
 * title, Inter for the rest, the amber part-of-day labels), so it reads as their Daily Dash and not
 * as one more chat bubble.
 *
 * Built here, not taken from `@daily-dash/my-day`: the package exports no routine card, and its
 * `RoutineCard` needs the Daily Dash client (`useRoutineMarks`, `useTickWriter`), which exists only
 * while the My Day tab is mounted (`MyDayNavigator` wraps it in `DailyDashClient`). So the card
 * uses the same pieces the tab's host does (`MyDayHost`): `buildMyDayTheme` over the scheme's base
 * look, `coldStartMyDayPhoto`, `MyDayBlur`, and My Day's words from `useMyDayCopy`. The rows read a
 * tick, a bucket and a week count exactly as My Day's routine card does (`agentRoutineLogic.ts`).
 *
 * Display only: the rings are not buttons, and the ticks are the ones the answer carried when Sky
 * looked, so a card further up the thread keeps its own day's ticks. The day heading says which day.
 * Ticking from the card is the next piece of work.
 *
 * It never collapses: unlike a meeting card, nothing here is picked.
 */
import { FC, useMemo } from "react"
import {
  ImageBackground,
  Pressable,
  StyleSheet,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from "react-native"
import { dailyDashDark, dailyDashLight, type MyDayTheme } from "@daily-dash/my-day"
import type { MyDayCopy } from "@daily-dash/my-day/copy"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { MyDayBlur } from "@/components/myDay/MyDayBlur"
import { Text } from "@/components/Text"
import { useMyDayCopy } from "@/hooks/useMyDayCopy"
import { useAppTheme } from "@/theme/context"
import { coldStartMyDayPhoto } from "@/theme/myDayPhotos"
import {
  routineBucketsOf,
  routineDayHeading,
  type RoutineMark,
  type SkyRoutineItem,
  type SkyToday,
} from "@/utils/agentRoutineLogic"
import { buildMyDayTheme } from "@/utils/myDayTheme"

interface RoutineResultsCardProps {
  today: SkyToday
  /** Opens the My Day tab. Left out when there is no My Day tab to open: then there is no link. */
  onOpenMyDay?: () => void
}

/** "Done", "Set aside today" or "Not yet": my-day `tickLabel` with no tap of the person's */
const tickLabel = (mark: RoutineMark, copy: MyDayCopy) => copy.today.tick[mark]

/** The line under the title: the state, then the week's count when the answer gave one */
const captionOf = (item: SkyRoutineItem, copy: MyDayCopy) =>
  item.weekDone === null
    ? tickLabel(item.mark, copy)
    : `${tickLabel(item.mark, copy)} · ${copy.today.week(item.weekDone)}`

export const RoutineResultsCard: FC<RoutineResultsCardProps> = ({ today, onOpenMyDay }) => {
  const { theme } = useAppTheme()
  const { isDark } = theme
  const { tint, tintInactive } = theme.colors
  // The base look by the app's scheme, with the app's tint laid over it: MyDayHost's rule (spec D4).
  const look = useMemo(
    () => buildMyDayTheme(isDark ? dailyDashDark : dailyDashLight, { tint, tintInactive }),
    [isDark, tint, tintInactive],
  )
  const styles = useMemo(() => stylesFor(look), [look])
  const copy = useMyDayCopy()
  const { t } = useTranslation()
  const groups = useMemo(() => routineBucketsOf(today.items), [today.items])

  return (
    <ImageBackground
      source={coldStartMyDayPhoto()}
      style={styles.photo}
      imageStyle={styles.photoImage}
      accessibilityIgnoresInvertColors
      testID="routine-card"
    >
      <View style={styles.pane}>
        <View style={styles.blurClip} pointerEvents="none">
          <MyDayBlur surface="card" />
        </View>

        <Text style={styles.title} accessibilityRole="header">
          {copy.today.routine.title}
        </Text>
        <Text style={styles.date}>{routineDayHeading(today.date, copy.today)}</Text>

        {groups.length === 0 ? (
          <Text style={styles.note}>{copy.today.routine.empty}</Text>
        ) : (
          groups.map((group) => (
            <View key={group.key} style={styles.group}>
              <Text style={styles.bucket}>
                {group.key === "other" ? copy.today.buckets.other : copy.today.buckets[group.key]}
              </Text>
              {group.items.map((item) => (
                <RoutineRow key={item.id} item={item} copy={copy} styles={styles} />
              ))}
            </View>
          ))
        )}

        {today.longRoutine ? <Text style={styles.note}>{copy.routine.longRoutine}</Text> : null}

        {onOpenMyDay ? (
          <Pressable
            onPress={onOpenMyDay}
            accessibilityRole="button"
            accessibilityLabel={t("agentScreen:openMyDay")}
            hitSlop={8}
            style={({ pressed }) => [styles.open, pressed && styles.pressed]}
          >
            <Text style={styles.openText}>{t("agentScreen:openMyDay")}</Text>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={look.colors.tint}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          </Pressable>
        ) : null}
      </View>
    </ImageBackground>
  )
}

/**
 * One item: its ring, its title, and under them its time and its state. One element for a screen
 * reader, read as "Morning prayer, 07:00, Done, 4 this week": the ring has no words of its own.
 */
const RoutineRow: FC<{ item: SkyRoutineItem; copy: MyDayCopy; styles: CardStyles }> = ({
  item,
  copy,
  styles,
}) => {
  const label = [
    item.title,
    item.timeOfDay,
    tickLabel(item.mark, copy),
    item.weekDone === null ? null : copy.today.week(item.weekDone),
  ]
    .filter((part): part is string => part !== null)
    .join(", ")
  return (
    <View
      style={[styles.row, item.mark === "skipped" && styles.dimmed]}
      accessible
      accessibilityLabel={label}
      testID={`routine-row-${item.id}`}
    >
      <View
        style={[
          styles.ring,
          item.mark === "done" && styles.ringDone,
          item.mark === "skipped" && styles.ringSkipped,
        ]}
        testID={`routine-ring-${item.mark}`}
      />
      <View style={styles.rowText}>
        <Text style={styles.itemTitle}>{item.title}</Text>
        {item.timeOfDay ? <Text style={styles.time}>{item.timeOfDay}</Text> : null}
        <Text style={styles.caption}>{captionOf(item, copy)}</Text>
      </View>
    </View>
  )
}

type CardStyles = ReturnType<typeof stylesFor>

/**
 * My Day's sizes and colours (my-day `theme/type.ts` typeScale, `screens/components/card.tsx`,
 * `my-day-text.tsx`, `marks.tsx`), from the theme the card was given. Recomputed only when the look
 * changes, which is a scheme or tint change. A plain object, memoised by the card, as the app's
 * `$` styles are: StyleSheet.create's lint rules (no-unused-styles, sort-styles) cannot follow a
 * factory, and it adds nothing for styles built from a theme value.
 */
function stylesFor(look: MyDayTheme) {
  const { colors, spacing, surface, typography } = look
  const shadow: TextStyle = {
    textShadowColor: colors.textShadow,
    textShadowOffset: surface.textShadow.offset,
    textShadowRadius: surface.textShadow.radius,
  }
  // The pane sits inside the photo's frame, so the frame's corner is the pane's plus its margin.
  const frameRadius = surface.cardRadius + spacing.sm / 2
  return {
    photo: {
      marginTop: spacing.xs,
      borderRadius: frameRadius,
      overflow: "hidden",
      padding: spacing.sm,
    } satisfies ViewStyle,
    photoImage: { borderRadius: frameRadius } satisfies ImageStyle,
    pane: {
      backgroundColor: colors.cardGlass,
      borderColor: colors.border,
      borderWidth: surface.hairline,
      borderRadius: surface.cardRadius,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
      gap: spacing.xxs,
    } satisfies ViewStyle,
    // The blur fills the pane square; this layer alone rounds it (my-day card.tsx `$blurClip`).
    blurClip: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: surface.cardRadius,
      overflow: "hidden",
    } satisfies ViewStyle,
    title: {
      ...shadow,
      fontFamily: typography.secondary.semiBold,
      fontSize: 20,
      lineHeight: 28,
      letterSpacing: surface.tracking.tight * 20,
      color: colors.text,
    } satisfies TextStyle,
    date: {
      fontFamily: typography.primary.normal,
      fontSize: 12,
      lineHeight: 16,
      color: colors.textDim,
    } satisfies TextStyle,
    group: { marginTop: spacing.xs, gap: spacing.xxs } satisfies ViewStyle,
    // my-day MyDayText `label`, tone `accent`
    bucket: {
      ...shadow,
      fontFamily: typography.primary.semiBold,
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: surface.tracking.wide * 12,
      textTransform: "uppercase",
      color: colors.accent,
    } satisfies TextStyle,
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      paddingVertical: spacing.xxxs,
    } satisfies ViewStyle,
    dimmed: { opacity: surface.disabledOpacity } satisfies ViewStyle,
    // my-day marks.tsx `$ring`: open in the tint, filled when done, dim when set aside. Nudged down
    // to sit on the title's first line.
    ring: {
      width: surface.tickSize,
      height: surface.tickSize,
      borderRadius: surface.tickSize / 2,
      borderWidth: surface.hairline,
      borderColor: colors.tint,
      marginTop: 4,
    } satisfies ViewStyle,
    ringDone: { backgroundColor: colors.tint } satisfies ViewStyle,
    ringSkipped: { borderColor: colors.textDim } satisfies ViewStyle,
    rowText: { flex: 1 } satisfies ViewStyle,
    // my-day `body`
    itemTitle: {
      fontFamily: typography.primary.medium,
      fontSize: 16,
      lineHeight: 24,
      color: colors.text,
    } satisfies TextStyle,
    // my-day `small`, tone `dim`
    time: {
      fontFamily: typography.primary.normal,
      fontSize: 14,
      lineHeight: 20,
      color: colors.textDim,
    } satisfies TextStyle,
    // my-day `caption`, tone `dim`
    caption: {
      fontFamily: typography.primary.normal,
      fontSize: 12,
      lineHeight: 16,
      color: colors.textDim,
    } satisfies TextStyle,
    note: {
      fontFamily: typography.primary.normal,
      fontSize: 14,
      lineHeight: 20,
      color: colors.textDim,
      marginTop: spacing.xs,
    } satisfies TextStyle,
    open: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xxs,
      marginTop: spacing.xs,
      paddingVertical: spacing.xs,
      borderTopColor: colors.separator,
      borderTopWidth: surface.hairline,
    } satisfies ViewStyle,
    pressed: { opacity: surface.pressedOpacity } satisfies ViewStyle,
    openText: {
      fontFamily: typography.primary.semiBold,
      fontSize: 14,
      lineHeight: 20,
      color: colors.tint,
    } satisfies TextStyle,
  }
}
