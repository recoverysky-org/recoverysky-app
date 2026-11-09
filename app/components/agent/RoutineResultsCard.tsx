/**
 * RoutineResultsCard: the person's routine from a Sky `get_today` answer, summary first.
 *
 * ADDED 2026-11-08. On a turn whose body says this build draws the card (`cards: ["routine"]`,
 * `utils/agentBodyLogic.ts`), the agent tells Sky the person sees their routine as a card, so she
 * never lists it (agent `ROUTINE_CARD_RULE`): this card is how the items reach the person.
 *
 * What it shows:
 * - **Closed**, as it first draws: "My Daily Routine", the day, "3 of 6 done" with a bar, then each
 *   part of the day as one line of chips (done tinted with a check, set aside dashed and dimmed).
 * - **Opened** with "Show details": each chip becomes a row with its ring, time and "Done · 4 this
 *   week", My Day's routine card's words. "Hide details" closes it. The choice is this card's alone
 *   and is not kept: the card draws closed again when the chat remounts.
 * - The day heading matters: the ticks are the ones the answer carried when Sky looked, so a card
 *   further up the thread shows an earlier day's ticks, and says which day.
 *
 * Display only: nothing on an item is a control. Ticking from the card is the next piece of work.
 * It never collapses: unlike a meeting card, nothing here is picked.
 *
 * CHANGED 2026-11-08 (Jenova): the card was first built in My Day's own look (glass over the
 * launch photo, Playfair, `buildMyDayTheme`), mockup B, committed in 887acad. Jenova then chose
 * mockup C, summary first, in the chat's own look, the frame the meeting cards wear. The words stay
 * My Day's (`useMyDayCopy`), so the card and the tab still say the same thing.
 */
import { FC, useMemo, useState } from "react"
import { Pressable, useWindowDimensions, View, type TextStyle, type ViewStyle } from "react-native"
import type { MyDayCopy } from "@daily-dash/my-day/copy"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useMyDayCopy } from "@/hooks/useMyDayCopy"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import {
  routineBucketsOf,
  routineDayHeading,
  routineProgressOf,
  type RoutineBucketGroup,
  type RoutineMark,
  type SkyRoutineItem,
  type SkyToday,
} from "@/utils/agentRoutineLogic"

interface RoutineResultsCardProps {
  today: SkyToday
  /** Opens the My Day tab. Left out when there is no My Day tab to open: then there is no link. */
  onOpenMyDay?: () => void
}

/**
 * A set-aside item's row: dimmed as My Day dims it (its `disabledOpacity`). A chip is dimmed by
 * colour instead: at an opacity its dashed edge, already the faint border colour, could not be seen
 * (review 2026-11-08).
 */
const SET_ASIDE_OPACITY = 0.5

/** The part-of-the-day column at the default text size; it grows with the person's text size */
const BUCKET_COLUMN = 80
/** `Text`'s own cap on text scaling (`maxFontSizeMultiplier`), which the column follows */
const MAX_FONT_SCALE = 2

/** "Done", "Set aside today" or "Not yet": my-day `tickLabel` with no tap of the person's */
const tickLabel = (mark: RoutineMark, copy: MyDayCopy) => copy.today.tick[mark]

// `other` is one of My Day's bucket words too, so every group's key names its label.
const bucketLabel = (group: RoutineBucketGroup, copy: MyDayCopy) => copy.today.buckets[group.key]

export const RoutineResultsCard: FC<RoutineResultsCardProps> = ({ today, onOpenMyDay }) => {
  const { themed, theme } = useAppTheme()
  const copy = useMyDayCopy()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => routineBucketsOf(today.items), [today.items])
  const { done, total, percent } = useMemo(() => routineProgressOf(today.items), [today.items])
  // The label column widens with the person's text size, so "Afternoon" never breaks mid-word at a
  // large size (review 2026-11-08); Text stops scaling at MAX_FONT_SCALE, and so does the column.
  const { fontScale } = useWindowDimensions()
  const bucketColumn = { width: BUCKET_COLUMN * Math.min(Math.max(fontScale, 1), MAX_FONT_SCALE) }
  const toggleLabel = t(open ? "agentScreen:hideRoutineDetails" : "agentScreen:showRoutineDetails")

  return (
    <View style={themed($card)} testID="routine-card">
      <View style={themed($top)}>
        <Text style={themed($title)} weight="semiBold" accessibilityRole="header">
          {copy.today.routine.title}
        </Text>
        {total > 0 ? (
          // `count` lets a language with plural forms pick one by the number done
          <Text style={themed($count)} weight="semiBold">
            {t("agentScreen:routineProgress", { done, total, count: done })}
          </Text>
        ) : null}
      </View>
      <Text style={themed($date)}>{routineDayHeading(today.date, copy.today)}</Text>

      {total === 0 ? (
        <Text style={themed($note)}>{copy.today.routine.empty}</Text>
      ) : (
        <>
          {/* Decorative: the count above says the same in words. */}
          <View
            style={themed($track)}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View
              style={[themed($fill), { width: `${percent}%` }]}
              testID="routine-progress-fill"
            />
          </View>
          {groups.map((group) => (
            <View key={group.key} style={themed($line)}>
              <Text style={[themed($bucket), bucketColumn]}>{bucketLabel(group, copy)}</Text>
              {open ? (
                <View style={themed($rows)}>
                  {group.items.map((item) => (
                    <RoutineRow key={item.id} item={item} copy={copy} />
                  ))}
                </View>
              ) : (
                <View style={themed($chips)}>
                  {group.items.map((item) => (
                    <RoutineChip key={item.id} item={item} copy={copy} />
                  ))}
                </View>
              )}
            </View>
          ))}
        </>
      )}

      {today.longRoutine ? <Text style={themed($note)}>{copy.routine.longRoutine}</Text> : null}

      {total > 0 || onOpenMyDay ? (
        <View style={themed($foot)}>
          {total > 0 ? (
            <Pressable
              onPress={() => setOpen((was) => !was)}
              accessibilityRole="button"
              accessibilityLabel={toggleLabel}
              accessibilityState={{ expanded: open }}
              hitSlop={8}
              style={({ pressed }) => [themed($footButton), pressed && $pressed]}
            >
              <Text style={themed($footText)} weight="semiBold">
                {toggleLabel}
              </Text>
              <Ionicons
                name={open ? "chevron-up" : "chevron-down"}
                size={14}
                color={theme.colors.tint}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            </Pressable>
          ) : (
            <View />
          )}
          {onOpenMyDay ? (
            <Pressable
              onPress={onOpenMyDay}
              accessibilityRole="button"
              accessibilityLabel={t("agentScreen:openMyDay")}
              hitSlop={8}
              style={({ pressed }) => [themed($footButton), pressed && $pressed]}
            >
              <Text style={themed($footText)} weight="semiBold">
                {t("agentScreen:openMyDay")}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={14}
                color={theme.colors.tint}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** One item, closed: its title in a chip whose look is its state, read as "Title, Done". */
const RoutineChip: FC<{ item: SkyRoutineItem; copy: MyDayCopy }> = ({ item, copy }) => {
  const { themed } = useAppTheme()
  return (
    <View
      style={[
        themed($chip),
        item.mark === "done" && themed($chipDone),
        item.mark === "skipped" && themed($chipSetAside),
      ]}
      accessible
      accessibilityLabel={`${item.title}, ${tickLabel(item.mark, copy)}`}
      testID={`routine-chip-${item.id}`}
    >
      {item.mark === "done" ? (
        <Text style={themed($chipText)} testID={`routine-chip-check-${item.id}`}>
          ✓
        </Text>
      ) : null}
      <Text
        style={[
          themed($chipText),
          themed($chipTitle),
          item.mark === "skipped" && themed($chipTextSetAside),
        ]}
      >
        {item.title}
      </Text>
    </View>
  )
}

/**
 * One item, opened: its ring, its title, and under it its time and its state. One element for a
 * screen reader, read as "Morning prayer, 07:00, Done, 4 this week": the ring has no words.
 */
const RoutineRow: FC<{ item: SkyRoutineItem; copy: MyDayCopy }> = ({ item, copy }) => {
  const { themed } = useAppTheme()
  const label = [
    item.title,
    item.timeOfDay,
    tickLabel(item.mark, copy),
    item.weekDone === null ? null : copy.today.week(item.weekDone),
  ]
    .filter((part): part is string => part !== null)
    .join(", ")
  const caption =
    item.weekDone === null
      ? tickLabel(item.mark, copy)
      : `${tickLabel(item.mark, copy)} · ${copy.today.week(item.weekDone)}`
  return (
    <View
      style={[themed($row), item.mark === "skipped" && $rowSetAside]}
      accessible
      accessibilityLabel={label}
      testID={`routine-row-${item.id}`}
    >
      <View
        style={[
          themed($ring),
          item.mark === "done" && themed($ringDone),
          item.mark === "skipped" && themed($ringSetAside),
        ]}
        testID={`routine-ring-${item.mark}`}
      />
      <View style={$rowText}>
        <Text style={themed($rowTitle)}>{item.title}</Text>
        {item.timeOfDay ? <Text style={themed($rowCaption)}>{item.timeOfDay}</Text> : null}
        <Text style={themed($rowCaption)}>{caption}</Text>
      </View>
    </View>
  )
}

// The meeting card's frame (MeetingResultsCard `$container`), so Sky's cards look like one family.
const $card: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.card,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: colors.border,
  marginTop: spacing.xs,
  paddingHorizontal: spacing.sm,
  paddingTop: spacing.sm,
  paddingBottom: spacing.xs,
})

const $top: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: spacing.xs,
})

// Every text here sets its own lineHeight: Text's base style carries 24, which made a 12px chip
// about 30px tall and an opened item about 80px (review 2026-11-08).
const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  flexShrink: 1,
  fontSize: 15,
  lineHeight: 20,
  color: colors.text,
})

const $count: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  lineHeight: 18,
  color: colors.tint,
})

const $date: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  lineHeight: 16,
  color: colors.textDim,
})

const $track: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  height: 6,
  borderRadius: 3,
  backgroundColor: colors.border,
  overflow: "hidden",
  marginTop: spacing.xs,
  marginBottom: spacing.xs,
})

const $fill: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: "100%",
  backgroundColor: colors.tint,
})

// One part of the day: its label in a column, its chips or rows beside it.
const $line: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "flex-start",
  gap: spacing.xs,
  paddingVertical: spacing.xs,
  borderTopWidth: 1,
  borderTopColor: colors.border,
})

// A column so the chips line up (its width is BUCKET_COLUMN, scaled with the text size); a longer
// label in another language wraps inside it.
const $bucket: ThemedStyle<TextStyle> = ({ colors }) => ({
  paddingTop: 2,
  fontSize: 12,
  lineHeight: 16,
  color: colors.textDim,
})

const $chips: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.xxs,
})

const $chip: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xxs,
  paddingHorizontal: spacing.xs,
  paddingVertical: 2,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: colors.border,
})

const $chipDone: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.tint + "2E",
  borderColor: colors.tint + "80",
})

const $chipSetAside: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderStyle: "dashed",
  borderColor: colors.textDim,
})

const $chipText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  lineHeight: 16,
  color: colors.text,
})

// The title shrinks beside the check, so a long done title wraps inside its chip, not past it.
const $chipTitle: ThemedStyle<TextStyle> = () => ({ flexShrink: 1 })

const $chipTextSetAside: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $rows: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  gap: spacing.xs,
})

const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "flex-start",
  gap: spacing.xs,
})

const $rowSetAside: ViewStyle = { opacity: SET_ASIDE_OPACITY }

// my-day marks.tsx `$ring`: open in the tint, filled when done. Set aside, it is dim and dashed here,
// to match the chip; My Day's ring is dim alone.
const $ring: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 14,
  height: 14,
  borderRadius: 7,
  borderWidth: 1.5,
  borderColor: colors.tint,
  marginTop: 2,
})

const $ringDone: ThemedStyle<ViewStyle> = ({ colors }) => ({ backgroundColor: colors.tint })

const $ringSetAside: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderColor: colors.textDim,
  borderStyle: "dashed",
})

const $rowText: ViewStyle = { flex: 1 }

const $rowTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  lineHeight: 18,
  color: colors.text,
})

const $rowCaption: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 11,
  lineHeight: 15,
  color: colors.textDim,
})

const $note: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 13,
  lineHeight: 18,
  color: colors.textDim,
  marginTop: spacing.xs,
})

const $foot: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: spacing.xxs,
  paddingVertical: spacing.xxs,
})

const $footButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xxs,
})

const $footText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  lineHeight: 16,
  color: colors.tint,
})

const $pressed: ViewStyle = { opacity: 0.7 }
