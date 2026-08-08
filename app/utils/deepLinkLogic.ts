/**
 * deepLinkLogic — narrowing for values that arrive from OUTSIDE the app.
 *
 * Push notification `data` is `Record<string, string>` on the wire. TypeScript
 * cannot check it, and `app.tsx`'s notification handler builds route params as
 * a plain `Record<string, string>` handed to `navigate(screen as never, …)` —
 * so every declared param type is erased on that path. Anything the server
 * sends lands in `route.params` verbatim unless something narrows it here.
 *
 * WHY THIS IS WORTH A PURE MODULE: an unrecognised `segment` is not a
 * cosmetic miss. `MeetingsScreen` feeds the value straight into
 * `activeSegment`, and its three content views each render behind
 * `display: none` unless their own key matches — so a value like `"in_person"`
 * (one underscore from the API's own `venueType` spelling) hides ALL THREE and
 * leaves a blank screen under a segmented control that still highlights index
 * 0. Narrowing at the boundary is the only place that can't be forgotten.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it (vitest
 * has no path-alias resolution in this repo — see CLAUDE.md "Test Runner
 * Split"). The `MeetingsSegment` import is type-only and therefore erased.
 */

import type { MeetingsSegment } from "@/navigators/navigationTypes"
import type { PendingMeetingTarget } from "@/navigators/navigationUtilities"

const MEETINGS_SEGMENTS: readonly string[] = ["live", "inperson", "listings"]

/**
 * Narrow a raw `segment` value from a push payload to a real segment key.
 *
 * Returns `undefined` — not `"live"` — for anything unrecognised, so the
 * caller omits the param entirely and the app behaves exactly like a build
 * that predates the server sending `segment` at all: `MeetingsScreen` applies
 * its own `?? "live"` fallback. Same end state, but the intent stays legible
 * at each layer rather than a bogus value being laundered into a good one.
 */
export function parseDeepLinkSegment(value: string | undefined): MeetingsSegment | undefined {
  return value && MEETINGS_SEGMENTS.includes(value) ? (value as MeetingsSegment) : undefined
}

/**
 * Which segment's popup should consume a deep-linked meetingId.
 *
 * Only two segments host a popup that reads the pending-meetingId store
 * (LiveContent → SchedulePopup, InPersonContent → InPersonPopup), so
 * `"listings"` maps to `"live"`: the Search segment's own cells open
 * SchedulePopup, which is LiveContent's popup, and the alternative would be
 * addressing a target no component consumes — an id parked forever.
 *
 * The reminder sender only ever emits `"live"` or `"inperson"` today (derived
 * from `meetings."venueType"`), so the listings case is defensive rather than
 * exercised. See ../api/docs/REMINDERS_ALGORITHM.md §"The Deep-Link Payload
 * Contract".
 */
export function pendingTargetForSegment(
  segment: MeetingsSegment | undefined,
): PendingMeetingTarget {
  return segment === "inperson" ? "inperson" : "live"
}
