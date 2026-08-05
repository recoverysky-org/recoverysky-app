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
 * `joins` or `lastJoin`.
 */

/** The two fields the ordering actually reads. `FeedbackRecord` satisfies this. */
export interface FeedbackLike {
  loves: boolean
  rates: number
}

/** Anything carrying a feedback snapshot — in practice `MeetingWithTrex`. */
export interface FeedbackSortable {
  feedback: FeedbackLike | null
}

/**
 * Order a meeting list by the user's own feedback, in three tiers:
 *
 *   1. Favourites, highest-rated first
 *   2. Everything else the user has touched, highest-rated first
 *   3. Untouched meetings, in the order they arrived
 *
 * **Tier 2 is "has a record", not "has stars".** A meeting the user joined but
 * never rated has a feedback row of all-zeroes, and it outranks one they have
 * never interacted with at all. That is deliberate — the row is evidence of
 * interest — and it is why the tier test is `feedback !== null` rather than
 * `rates > 0`. Changing it to the latter is the easy "cleanup" that would
 * silently demote every joined-but-unrated meeting.
 *
 * **The incoming order is the tiebreaker, and that carries real meaning.**
 * `Array.prototype.sort` is stable (guaranteed by spec since ES2019, and Hermes
 * complies), so rows that tie on this ordering stay exactly as the caller left
 * them. Every caller sorts first by its own primary key — distance on
 * In-Person's nearby mode, local start time on Search and the day-browse
 * fallback — and then hands the result here. So the real behaviour is
 * "favourites first, then nearest/soonest within each tier". Do not replace
 * the `return 0` with a fallback comparator; that would discard the caller's
 * ordering rather than preserve it.
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
    // Null-safe on purpose: `feedback` is typed non-optional on
    // MeetingWithTrex, but a row built by a path that forgets to stamp it
    // would arrive `undefined` at runtime, and that must sort as "untouched"
    // rather than crash.
    const hasFeedbackA = fbA != null
    const hasFeedbackB = fbB != null

    // 1) Favourites first, by stars descending
    if (lovedA && !lovedB) return -1
    if (!lovedA && lovedB) return 1
    if (lovedA && lovedB) return ratingB - ratingA

    // 2) Non-favourites the user has touched, by stars descending
    if (hasFeedbackA && !hasFeedbackB) return -1
    if (!hasFeedbackA && hasFeedbackB) return 1
    if (hasFeedbackA && hasFeedbackB) return ratingB - ratingA

    // 3) Untouched — keep the caller's ordering. See the docblock.
    return 0
  })
}
