/**
 * feedbackSort — "favourites float to the top", the app's one meeting-list
 * ordering rule.
 *
 * Extracted from LiveScreen 2026-08-04, when the same ordering was applied to
 * the In-Person and Search segments. Live had carried the only copy since the
 * feature shipped; a second and third hand-written copy would have drifted the
 * first time anyone touched a tier.
 *
 * This is a *pure* module with no runtime `@/` imports so vitest can reach it
 * (see CLAUDE.md, "Test Runner Split"). That's why `FeedbackLike` is declared
 * structurally here instead of importing `FeedbackRecord` from `@/db` — a
 * `FeedbackRecord` satisfies it, and the sort has no business knowing about
 * `lastJoin`.
 *
 * CHANGED 2026-08-07: `joins` moved from "none of this module's business" into
 * `FeedbackLike` — it is now the tiebreaker within each tier. `lastJoin` is
 * still deliberately out: recency is a different question from frequency, and
 * ordering by it would reshuffle the list every time the user attended
 * anything.
 */

/** The three fields the ordering actually reads. `FeedbackRecord` satisfies this. */
export interface FeedbackLike {
  loves: boolean
  rates: number
  joins: number
}

/** Anything carrying a feedback snapshot — in practice `MeetingWithTrex`. */
export interface FeedbackSortable {
  feedback: FeedbackLike | null
}

/**
 * Order a meeting list by the user's own feedback, in three tiers:
 *
 *   1. Favourites, highest-rated first, then most-attended first
 *   2. Everything else the user has touched, same two keys in the same order
 *   3. Untouched meetings, in the order they arrived
 *
 * **Stars outrank attendance, deliberately.** A rating is an explicit judgement
 * the user typed in; a join count is a byproduct of showing up. Someone who
 * five-starred a meeting they've been to once and never rated the one they
 * attend weekly still means the five-star one is their favourite. Attendance
 * only breaks ties between meetings the user has judged equally — which, since
 * most meetings are never rated at all, is the common case in practice.
 *
 * **Tier 2 is "has a record", not "has stars".** A meeting the user joined but
 * never rated has a feedback row of all-zeroes, and it outranks one they have
 * never interacted with at all. That is deliberate — the row is evidence of
 * interest — and it is why the tier test is `feedback !== null` rather than
 * `rates > 0`. Changing it to the latter is the easy "cleanup" that would
 * silently demote every joined-but-unrated meeting.
 *
 * **The incoming order is the last tiebreaker, and that carries real meaning.**
 * `Array.prototype.sort` is stable (guaranteed by spec since ES2019, and Hermes
 * complies), so rows that tie on this ordering stay exactly as the caller left
 * them. Every caller sorts first by its own primary key — distance on
 * In-Person's nearby mode, local start time on Search and the day-browse
 * fallback — and then hands the result here. So the real behaviour is
 * "favourites first, then most-attended, then nearest/soonest within each
 * tier". Do not replace the `return 0` with a fallback comparator; that would
 * discard the caller's ordering rather than preserve it.
 *
 * CHANGED 2026-08-07: attendance now sits between the stars and the caller's
 * order, where before the caller's order took over as soon as stars tied. The
 * visible symptom was a nearby list ordering a meeting attended once above one
 * attended twice, purely because it was 1 km closer — the app knew which room
 * the user actually goes to and sorted it second.
 *
 * Returns a new array; the input is not mutated.
 *
 * PERFORMANCE / UX: callers must sort a *snapshot* of feedback taken when the
 * list loaded, never live cache state. Sorting on live feedback makes a row
 * jump out from under the finger that just tapped its heart. Every caller
 * stamps `feedback` at fetch time and renders hearts/stars from a separate
 * live map for exactly this reason.
 */
export function sortByFeedback<T extends FeedbackSortable>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const fbA = a.feedback
    const fbB = b.feedback

    const lovedA = fbA?.loves ?? false
    const lovedB = fbB?.loves ?? false
    const ratingA = fbA?.rates ?? 0
    const ratingB = fbB?.rates ?? 0
    // Same `?? 0` defensiveness as the fields above: `joins` is non-optional on
    // FeedbackRecord, but a hand-built row (or an older persisted record) that
    // lacks it must sort as "never attended" rather than produce NaN — and a
    // NaN comparator return is not merely wrong, it makes the whole sort's
    // output implementation-defined.
    const joinsA = fbA?.joins ?? 0
    const joinsB = fbB?.joins ?? 0
    // Null-safe on purpose: `feedback` is typed non-optional on
    // MeetingWithTrex, but a row built by a path that forgets to stamp it
    // would arrive `undefined` at runtime, and that must sort as "untouched"
    // rather than crash.
    const hasFeedbackA = fbA != null
    const hasFeedbackB = fbB != null

    // 1) Favourites first, by stars descending, then attendance descending
    if (lovedA && !lovedB) return -1
    if (!lovedA && lovedB) return 1
    if (lovedA && lovedB) return ratingB - ratingA || joinsB - joinsA

    // 2) Non-favourites the user has touched, same two keys
    if (hasFeedbackA && !hasFeedbackB) return -1
    if (!hasFeedbackA && hasFeedbackB) return 1
    if (hasFeedbackA && hasFeedbackB) return ratingB - ratingA || joinsB - joinsA

    // 3) Untouched — keep the caller's ordering. See the docblock.
    return 0
  })
}
