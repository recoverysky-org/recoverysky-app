/**
 * The routine in a Sky tool result, for the Sky tab's routine card.
 *
 * PURE MODULE: no runtime `@/` imports (only the relative `./agentToolAnswerLogic`), so vitest can
 * import it (see CLAUDE.md "Test Runner Split").
 * ToolResultRenderer asks `todayOfToolOutput` whether a finished tool call is a today answer, and
 * RoutineResultsCard draws it, grouped by `routineBucketsOf`, under `routineDayHeading`.
 *
 * ADDED 2026-11-08. Sky reads the person's day through the Daily Dash MCP server's `get_today`
 * (the-daily-dash-app `packages/mcp/src/tools/today.ts`), which answers the Daily Dash API's
 * `GET /v1/today` (sdk `zToday`) as the call's `structuredContent` and as its text. Its routine is
 * `routine.items[]`, each `{ id, title, bucket, timeOfDay, sortOrder, tick: { status, at } | null,
 * weekDone }`, already in the server's order. On a RecoverySky turn the agent tells Sky the person
 * sees that routine as a card, so she never lists it (agent `packages/agent/src/dailyDashTools.ts`,
 * `ROUTINE_CARD_RULE`): this card is the only way the items reach the person.
 *
 * Display only, for now: the card draws the ticks as they were when Sky looked, and a tap ticks
 * nothing. The rest of the answer (the focal areas, tonight, the quote) stays Sky's to mention.
 *
 * Decided by shape, not by tool name, like the meeting cards: a Today is an `asOf.date` and a
 * `routine.items` list. The rules mirror My Day's own reading of the same answer (my-day
 * `buckets.ts`, `ticks.ts`, `screens/todayLogic.ts`), so the card and the tab never disagree on
 * what a tick or a bucket means. Nothing here throws.
 */

import { isRecord, toolAnswerOf } from "./agentToolAnswerLogic"

/** An item's state as the ring shows it: My Day's `TickMark` */
export type RoutineMark = "done" | "skipped" | "open"

/** A routine item from a today answer, checked for the card */
export interface SkyRoutineItem {
  /** The item id: the row's key, and what a tick will name later */
  id: string
  title: string
  /** The server's bucket as it came; one this app does not know lists under Other */
  bucket: string
  /** `HH:MM` as the server wrote it, or null */
  timeOfDay: string | null
  mark: RoutineMark
  /** Times done this week, or null when the answer gives no count to trust */
  weekDone: number | null
}

/** A today answer, as much of it as the card draws */
export interface SkyToday {
  /** The person's own date, `YYYY-MM-DD`: the day the ticks are for */
  date: string
  items: SkyRoutineItem[]
  /** The server flagged the routine as long (`warnings: ["long_routine"]`) */
  longRoutine: boolean
}

/** The four parts of the day, in display order: my-day `BUCKET_ORDER` */
export const ROUTINE_BUCKET_ORDER = ["morning", "afternoon", "evening", "anytime"] as const

export type RoutineBucketKey = (typeof ROUTINE_BUCKET_ORDER)[number] | "other"

export interface RoutineBucketGroup {
  key: RoutineBucketKey
  items: SkyRoutineItem[]
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** my-day `markOf` with no tap of the person's: a status it does not know reads as not yet */
function markOf(tick: unknown): RoutineMark {
  if (!isRecord(tick)) return "open"
  if (tick.status === "done") return "done"
  if (tick.status === "skipped") return "skipped"
  return "open"
}

function toRoutineItem(value: unknown): SkyRoutineItem | null {
  if (!isRecord(value)) return null
  const { id, title, bucket, timeOfDay, weekDone } = value
  if (typeof id !== "string" || id.length === 0) return null
  if (typeof title !== "string" || title.trim().length === 0) return null
  return {
    id,
    title,
    bucket: typeof bucket === "string" ? bucket : "",
    timeOfDay: typeof timeOfDay === "string" && timeOfDay.length > 0 ? timeOfDay : null,
    mark: markOf(value.tick),
    weekDone:
      typeof weekDone === "number" && Number.isInteger(weekDone) && weekDone >= 0 ? weekDone : null,
  }
}

/**
 * The routine a finished tool call returned, or null when the result is not a today answer.
 *
 * - `[]` is a real answer: the person has no routine, which the card says in My Day's words.
 * - A list that held entries but no item that can draw answers null instead, as the meeting card
 *   does: "Start with a routine" would be false.
 * - An id listed twice is kept once, the first time, as the row's key is the id.
 */
export function todayOfToolOutput(output: unknown): SkyToday | null {
  const answer = toolAnswerOf(output)
  if (answer === null) return null
  const { asOf, routine } = answer
  if (!isRecord(asOf) || typeof asOf.date !== "string" || !CALENDAR_DATE.test(asOf.date)) {
    return null
  }
  if (!isRecord(routine) || !Array.isArray(routine.items)) return null

  const seen = new Set<string>()
  const items: SkyRoutineItem[] = []
  for (const entry of routine.items) {
    const parsed = toRoutineItem(entry)
    if (parsed === null || seen.has(parsed.id)) continue
    seen.add(parsed.id)
    items.push(parsed)
  }
  if (routine.items.length > 0 && items.length === 0) return null

  return {
    date: asOf.date,
    items,
    longRoutine: Array.isArray(routine.warnings) && routine.warnings.includes("long_routine"),
  }
}

const isKnownBucket = (bucket: string): bucket is (typeof ROUTINE_BUCKET_ORDER)[number] =>
  (ROUTINE_BUCKET_ORDER as readonly string[]).includes(bucket)

/**
 * The items by part of the day, in day order, each keeping the server's order, empty parts
 * dropped. A bucket this app does not know (the API grew one) is listed last as `other`, never
 * dropped: my-day `groupByBucket`.
 */
export function routineBucketsOf(items: readonly SkyRoutineItem[]): RoutineBucketGroup[] {
  const known: RoutineBucketGroup[] = ROUTINE_BUCKET_ORDER.map((key) => ({
    key,
    items: items.filter((entry) => entry.bucket === key),
  }))
  const other: RoutineBucketGroup = {
    key: "other",
    items: items.filter((entry) => !isKnownBucket(entry.bucket)),
  }
  return [...known, other].filter((group) => group.items.length > 0)
}

/**
 * `2026-11-08` as "Sunday, November 8", in `words`' day and month names (My Day's, from the app's
 * `myDay.today` strings): the person's own date read as a calendar date with no zone, so the device's
 * zone cannot move it a day. Anything that is not a `YYYY-MM-DD` date is shown as it came
 * (my-day `dayHeading`).
 */
export function routineDayHeading(
  date: string,
  words: { days: readonly string[]; months: readonly string[] },
): string {
  const match = CALENDAR_DATE.exec(date)
  if (!match) return date
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const month = words.months[m - 1]
  const day = words.days[weekday]
  return month === undefined || day === undefined ? date : `${day}, ${month} ${d}`
}
