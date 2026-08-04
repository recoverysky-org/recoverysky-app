/**
 * returnToLogic — parsing for the `returnTo` grammar.
 *
 * When a premium gate interrupts the user, the screen that raised the gate
 * hands SettingsScreen a `returnTo` string describing where to put them back
 * after they buy. `SettingsScreen.navigateReturn()` turns the parse result
 * into a navigation call.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it (vitest
 * has no path-alias resolution in this repo — see CLAUDE.md "Test Runner
 * Split"). The navigation I/O stays in SettingsScreen.
 *
 * WHY THIS IS WORTH A PURE MODULE: the grammar carries a legacy form that
 * cannot be dropped. `returnTo` is persisted to MMKV under
 * `SUBSCRIPTION_RETURN` so it survives the login flow, which means a string
 * written by a PREVIOUS app version can be read by this one. Getting the
 * legacy branch wrong strands a user who just paid.
 */

/** Segments of the Meetings tab that can restore a meeting popup. */
export type ReturnToSegment = "live" | "inperson"

export type ReturnToTarget =
  /** Reopen a meeting popup on a specific Meetings segment. */
  | { kind: "meetingPopup"; segment: ReturnToSegment; meetingId: string }
  /** A Meetings form we couldn't fully parse — land on the tab anyway. */
  | { kind: "meetingsTab" }
  /** Any other tab, with an optional section (e.g. "Attendance:new"). */
  | { kind: "screen"; screen: string; section?: string }
  /** Nothing to return to. */
  | { kind: "none" }

const SEGMENTS: readonly string[] = ["live", "inperson"]

/**
 * Parse a colon-delimited `returnTo` string. Three shapes are accepted:
 *
 *   "Attendance:new"                    → { kind: "screen", screen, section }
 *   "Meetings:meetingId:<id>"           → live popup (LEGACY, see below)
 *   "Meetings:<segment>:meetingId:<id>" → that segment's popup
 *
 * The three-part `Meetings` form is legacy: it predates the In-Person segment
 * and has no way to name one, so it means "live" and always did. It is still
 * parsed because a persisted `SUBSCRIPTION_RETURN` can outlive an app update.
 * New callers should emit the four-part form.
 *
 * Anything under `Meetings` that doesn't match resolves to `meetingsTab`
 * rather than `none` — a user who paid should land somewhere sensible even if
 * we can't reconstruct exactly where they were.
 *
 * Note "listings" is NOT a valid popup segment: the Search segment's cells
 * open SchedulePopup, whose gate emits the legacy live form. Adding it here
 * would claim a restoration path that has no consumer.
 */
export function parseReturnTo(returnTo: string | null | undefined): ReturnToTarget {
  if (!returnTo) return { kind: "none" }

  const parts = returnTo.split(":")
  const screen = parts[0]
  if (!screen) return { kind: "none" }

  if (screen !== "Meetings") {
    const section = parts[1]
    return section ? { kind: "screen", screen, section } : { kind: "screen", screen }
  }

  // "Meetings:meetingId:<id>" — legacy, no segment, means live.
  if (parts[1] === "meetingId" && parts[2]) {
    return { kind: "meetingPopup", segment: "live", meetingId: parts[2] }
  }

  // "Meetings:<segment>:meetingId:<id>"
  if (SEGMENTS.includes(parts[1] ?? "") && parts[2] === "meetingId" && parts[3]) {
    return {
      kind: "meetingPopup",
      segment: parts[1] as ReturnToSegment,
      meetingId: parts[3],
    }
  }

  return { kind: "meetingsTab" }
}

/**
 * Build the `returnTo` string for a meeting popup. Always emits the
 * four-part segment-carrying form — callers should not hand-assemble the
 * string, which is how the in-person popup ended up emitting the live-only
 * legacy form and bouncing paying users to the wrong segment.
 */
export function buildMeetingReturnTo(segment: ReturnToSegment, meetingId: string): string {
  return `Meetings:${segment}:meetingId:${meetingId}`
}
