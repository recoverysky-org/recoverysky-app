/**
 * The meetings in a Sky tool result, for the Sky tab's meeting cards.
 *
 * PURE MODULE: type-only `@/` imports, so vitest can import it (see CLAUDE.md "Test Runner Split").
 * CHANGED 2026-11-08 (routine card): it now imports `./agentToolAnswerLogic` at runtime, a relative
 * import, which vitest resolves.
 * ToolResultRenderer asks `meetingsOfToolOutput` whether a finished tool call holds meetings, and
 * MeetingResultsCard draws each one through MeetingRow with `toRowMeeting`.
 *
 * ADDED 2026-11-08. Sky's meeting tools come from the api's meetings-mcp server through the agent's
 * MCP bridge (agent `packages/tools/src/mcp/bridge.ts`), so a result reaches the phone as a
 * `dynamic-tool` part named after the server's tool (`find_meetings_now`, `get_meeting`, ...) whose
 * output is the call's MCP result: `{ isError, content: [{ type: "text", text }] }`, the text
 * holding the JSON the api documents (api `docs/mcp-tools.md`; meetings-mcp sends no
 * `structuredContent`, checked against a live answer 2026-11-08). Every meeting in it is the
 * server's **Meeting** shape, not the app's `MeetingWithTrex`: it has an id, display fields and a
 * rendered start, and none of the schedule a popup needs, so a tap looks the schedule up by id
 * (useSkyMeetingPopup).
 *
 * The card before this read `meetings` / `results` / `data` off the output itself and drew only the
 * retired tools' names (`findMeetings`, `getLiveMeetings`), so after the switch no meeting drew.
 *
 * Decided by shape, not by tool name: the agent promises the person that every meeting a tool
 * returns reaches them as a card (its prompt's cards rule, agent `packages/agent/src/meetingTools.ts`),
 * so a meetings tool the server adds later draws without an app release.
 *
 * Parts read back from the agent are checked only for being an array (`isStoredMessage`), so the
 * output can be anything. Nothing here throws.
 */

import type { MeetingRowData } from "@/components/MeetingRow"

import { isRecord, toolAnswerOf } from "./agentToolAnswerLogic"

/** A meeting from a Sky tool result, checked and normalised for a card */
export interface SkyMeeting {
  /** The meeting id: what a tap looks the schedule up by, and the row's key */
  id: string
  name: string
  fellowship: string | null
  language: string | null
  /** The pool it is in; which popup a tap opens, and where the lookup asks */
  venue: "online" | "in_person"
  hybrid: boolean
  /** An always-on room */
  continuous: boolean
  /** The start to show, UTC millis, or null when the answer gives none */
  startsAt: number | null
  /** The server's heart: hearted, or in the same schedule as a hearted meeting */
  favorite: boolean
  venueName: string | null
  /** Metres from the search centre, `find_meetings_nearby` only */
  distanceM: number | null
  /**
   * False when the answer says the meeting is in no active schedule: `find_favorite_meetings`
   * lists such a favorite last, with empty `occurrences` (api `docs/mcp-tools.md`). Its lookup can
   * only 404, so a tap says so and sends nothing (useSkyMeetingPopup). ADDED 2026-11-08 (review).
   */
  scheduled: boolean
}

/**
 * meetings-mcp's id cap (the api's hints rule), so an over-long id never reaches a lookup. The
 * length is all this checks; the lookup encodes the id into its path (useSkyMeetingPopup).
 * CHANGED 2026-11-08 (review): this said "a junk id never reaches a lookup URL", which a length
 * check cannot promise.
 */
const MAX_ID_CHARS = 64

const VENUES: ReadonlySet<string> = new Set(["online", "in_person"])

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

/** A RenderedInstant's instant: `{ iso, local, timezone }`, of which only `iso` is an instant */
function instantOf(value: unknown): number | null {
  if (!isRecord(value) || typeof value.iso !== "string") return null
  const millis = Date.parse(value.iso)
  return Number.isFinite(millis) ? millis : null
}

/**
 * The start to show. `startsAt` is the occurrence the tool answered for. `find_favorite_meetings`
 * also lists `occurrences`, soonest first, which stands in when `startsAt` is null.
 */
function startOf(meeting: Record<string, unknown>): number | null {
  const startsAt = instantOf(meeting.startsAt)
  if (startsAt !== null) return startsAt
  return Array.isArray(meeting.occurrences) ? instantOf(meeting.occurrences[0]) : null
}

/**
 * A Meeting a card can draw and a tap can open, or null. An id, a name and a venue are what it
 * needs: the id and venue open the schedule, the name is the row. Every other field can be missing
 * or odd and the row draws without it.
 */
function toSkyMeeting(value: unknown): SkyMeeting | null {
  if (!isRecord(value)) return null
  const { id, name, venue, distance_m: distance } = value
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_CHARS) return null
  if (typeof name !== "string" || name.length === 0) return null
  if (typeof venue !== "string" || !VENUES.has(venue)) return null
  return {
    id,
    name,
    fellowship: stringOrNull(value.fellowship),
    language: stringOrNull(value.language),
    venue: venue as SkyMeeting["venue"],
    hybrid: value.hybrid === true,
    continuous: value.continuous === true,
    startsAt: startOf(value),
    favorite: value.favorite === true,
    venueName: stringOrNull(value.venueName),
    distanceM:
      typeof distance === "number" && Number.isFinite(distance) && distance >= 0 ? distance : null,
    // Only an empty list says "no schedule". A missing one says nothing: most tools send none.
    scheduled: !(Array.isArray(value.occurrences) && value.occurrences.length === 0),
  }
}

/**
 * The meetings a finished tool call returned, in the server's order (favorites first, as it
 * listed them), or null when the result is not a meeting answer.
 *
 * - A list answer (`find_meetings_*`, `find_favorite_meetings`, `suggest_meetings`) holds
 *   `meetings`; `get_meeting` holds one `meeting`.
 * - `[]` is a real answer with no meetings, which the card says. A list that held entries but no
 *   drawable meeting answers null instead: that is the retired tools' shape (no venue, a time as
 *   words), still in threads from before the switch, and "No meetings found" would be false.
 * - Every meeting returned is kept: no cap. Sky asks for as many as she means to offer, and she may
 *   talk about any of them (agent cards rule).
 * - A meeting listed twice is kept once, the first time, as the row's key is the id.
 */
export function meetingsOfToolOutput(output: unknown): SkyMeeting[] | null {
  // CHANGED 2026-11-08 (routine card): the reader moved to agentToolAnswerLogic, shared.
  const answer = toolAnswerOf(output)
  if (answer === null) return null

  let listed: unknown[]
  if (Array.isArray(answer.meetings)) listed = answer.meetings
  else if (isRecord(answer.meeting)) listed = [answer.meeting]
  else return null

  const seen = new Set<string>()
  const meetings: SkyMeeting[] = []
  for (const entry of listed) {
    const meeting = toSkyMeeting(entry)
    if (meeting === null || seen.has(meeting.id)) continue
    seen.add(meeting.id)
    meetings.push(meeting)
  }
  return listed.length > 0 && meetings.length === 0 ? null : meetings
}

/**
 * What MeetingRow draws for a Sky meeting. `millis` is 0 for an always-on room, which the row draws
 * as "24h". A meeting with no start gets NaN: the row's two readers of `millis` both treat a
 * non-finite one as nothing to show (`formatMillisToLocalTime` returns "" for a falsy value, and
 * `localIsoDow` answers null for a non-finite one), so the time and the day are left blank rather
 * than wrong. 0 would draw a timed meeting as "24h", and any other number as a time it is not.
 */
export function toRowMeeting(meeting: SkyMeeting): MeetingRowData {
  return {
    name: meeting.name,
    fellowship: meeting.fellowship,
    language: meeting.language,
    millis: meeting.continuous ? 0 : (meeting.startsAt ?? Number.NaN),
    venueName: meeting.venueName,
    hybrid: meeting.hybrid,
  }
}

/** The device's local calendar day of an instant */
const localDay = (millis: number) => new Date(millis).toDateString()

/**
 * Whether the card's rows carry their weekday (MeetingRow's `showDay`): true when a timed meeting
 * starts on another local day than today. `find_meetings_nearby` for any day and
 * `find_favorite_meetings` answer instants days apart, and "7:30p" alone would read as tonight.
 * A list of tonight's meetings stays bare, as MeetingRow's own rule has it for single-day lists.
 * Always-on rooms and meetings with no start have no day to show and are left out.
 */
export function cardShowsDay(meetings: readonly SkyMeeting[], nowMillis: number): boolean {
  const today = localDay(nowMillis)
  return meetings.some(
    (meeting) =>
      !meeting.continuous && meeting.startsAt !== null && localDay(meeting.startsAt) !== today,
  )
}
