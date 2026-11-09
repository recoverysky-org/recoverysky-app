/**
 * What a Sky chat request carries, which of the agent's refusals mean the thread
 * on screen is stale, and what a log line may say about a failed request.
 *
 * PURE MODULE: a type-only `ai` import and no `@/` runtime imports, so vitest can
 * import it (see CLAUDE.md "Test Runner Split"). AgentScreen's transport calls
 * these from `prepareSendMessagesRequest`, and the screen from its error effect and
 * its `onError`.
 *
 * ADDED 2026-11-06 (spec 2026-11-06-agent-chat-turn-only-design.md, D2, D8). The
 * agent now holds the history and builds each turn's context from it, so the app
 * says which conversation a turn belongs to and sends only that turn.
 *
 * ADDED 2026-11-08 (agent spec 2026-11-07-sky-on-meetings-mcp-design.md, "The chat
 * request"): each turn also carries the person's favorite meeting ids, so meetings-mcp
 * can mark them and list them first. The agent hands them to meetings-mcp for that
 * turn alone and stores none of them; it logs only their count.
 */

import type { UIMessage } from "ai"

/**
 * The body of `POST /api/v1/chat`. Named by the wire, hence the snake case.
 *
 * `messages` is the turn alone, and an older agent parses that too, since it reads the
 * last message either way (spec D10). It is empty only when there is no turn, which the
 * SDK is not expected to send: it hands over the list with the message it is sending in
 * it. The agent's schema has `.min(1)` on `messages`, so an empty one would be refused
 * as an invalid body.
 * CHANGED 2026-11-06 (final review): this used to say an empty list parses as well.
 */
export interface ChatRequestBody {
  conversation_id: string
  messages: UIMessage[]
  timezone: string
  fellowship?: string
  /**
   * ADDED 2026-11-08: the hearted meetings, from `favoriteMeetingIds`. Left out when there
   * are none, which the agent reads exactly as an empty list. An agent older than v0.14.0
   * ignores the key (its body schema is `.passthrough()`), so it never refuses a turn.
   */
  favorite_meeting_ids?: string[]
}

/**
 * The most favorites a turn carries. The agent keeps the first 500 and drops the rest with a
 * warning (its `meetingsContext.ts`); meetings-mcp caps its set there too.
 */
export const FAVORITE_IDS_MAX = 500

/** The agent drops a longer id, and an empty one, as malformed (its `meetingsContext.ts`). */
export const FAVORITE_ID_MAX_CHARS = 64

/** The fields `favoriteMeetingIds` reads. A feedback cache record satisfies it. */
export interface FavoriteRecordLike {
  mid: string
  loves: boolean
  lastJoin: number
}

/**
 * The ids of the meetings the person has hearted, for `favorite_meeting_ids`.
 *
 * Every loved meeting id goes, not one per schedule: meetings-mcp expands each id to its whole
 * schedule anyway (api spec 2026-11-07-meetings-mcp-favorites-design.md, "favorite meeting id
 * → its schedule → every meeting id in that schedule"), and the cache cannot tell schedules
 * apart. Ids the agent would drop are left out here, so a turn logs no "Meeting context
 * dropped" warning.
 *
 * Sorted, so the list carries the set alone: nothing about when a heart was tapped or a
 * meeting joined. Past the cap (a clubhouse's schedules can hold many ids), the most recently
 * joined are kept, since those are the meetings the person goes to; a join time that is not
 * a finite number counts as never joined.
 */
export function favoriteMeetingIds(records: Iterable<FavoriteRecordLike>): string[] {
  const lastJoinByMid = new Map<string, number>()
  for (const { mid, loves, lastJoin } of records) {
    if (!loves || mid.length === 0 || mid.length > FAVORITE_ID_MAX_CHARS) continue
    const joined = Number.isFinite(lastJoin) ? lastJoin : 0
    lastJoinByMid.set(mid, Math.max(lastJoinByMid.get(mid) ?? 0, joined))
  }
  let mids = [...lastJoinByMid.keys()]
  if (mids.length > FAVORITE_IDS_MAX) {
    mids = mids
      .sort((a, b) => lastJoinByMid.get(b)! - lastJoinByMid.get(a)! || (a < b ? -1 : 1))
      .slice(0, FAVORITE_IDS_MAX)
  }
  return mids.sort()
}

/**
 * The state of a tool part the person has answered. The agent's `continuationOf`
 * (its chatHistory.ts) reads the same state with no check on the part's type, so
 * this doesn't check it either: the two have to agree on what a continuation is.
 *
 * The part comes from the agent unvalidated (`isStoredMessage` only checks that
 * `parts` is an array), so it can be `null` or a primitive here, whatever its type
 * says. A throw would surface from inside the SDK's send and lose the turn.
 */
function isAnswered(part: unknown): boolean {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { state?: unknown }).state === "approval-responded"
  )
}

/**
 * The newest message that is the person's turn: their own words, or Sky's card
 * once they have answered it. Walks back from the end, so an answered card only
 * wins when no message of theirs came after it.
 *
 * An assistant message with no answer is passed over: it is the partial reply the
 * SDK kept after a failed stream, sitting behind the words a retry has to resend.
 * The agent skips it too (spec D2). So is any other role, which never is a turn.
 *
 * Answers the message itself, not a copy, so a retry resends the same id. The agent
 * stores a repeated id once and replaces the reply it had stored (agent R2).
 */
export function turnOf(messages: readonly UIMessage[]): UIMessage | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === "user") return message
    if (message.role === "assistant" && message.parts.some(isAnswered)) return message
  }
  return null
}

/**
 * The request body for this conversation's turn. An empty `fellowship` is left out
 * rather than sent as `""`: the agent's schema takes the key as optional but its value
 * as one of a closed list, so `""` would refuse the whole turn as an invalid body.
 *
 * CHANGED 2026-11-08: `favoriteIds` (from `favoriteMeetingIds`) rides on every turn, an
 * answered card's included, as the agent spec asks. None is left out rather than sent as
 * `[]`, so a person with no hearts sends the body they sent before.
 */
export function chatRequestBody(
  conversationId: string,
  messages: readonly UIMessage[],
  timezone: string,
  fellowship: string | undefined,
  favoriteIds: readonly string[] = [],
): ChatRequestBody {
  const turn = turnOf(messages)
  return {
    conversation_id: conversationId,
    messages: turn ? [turn] : [],
    timezone,
    ...(fellowship ? { fellowship } : {}),
    ...(favoriteIds.length > 0 ? { favorite_meeting_ids: [...favoriteIds] } : {}),
  }
}

/**
 * The `message` of each agent refusal that a retry would only repeat, because the
 * thread in memory is the thing that is wrong (spec D8):
 * - `message_id_taken`, `continuation_mismatch` (400): a card answered on another
 *   device, or the thread moved on. This screen has no cards yet, so these should
 *   not arise here; they cost one line each.
 * - `conversation_archived` (409): New conversation on another device (agent A2).
 * - `Access denied` (403): the owner was relinked.
 *
 * Exact strings, deliberately. The agent has neighbours such as
 * `conversation_guide_mismatch` that are not this, and answering a stale refusal
 * replaces the list on screen.
 */
const STALE_REFUSALS: ReadonlySet<string> = new Set([
  "message_id_taken",
  "continuation_mismatch",
  "conversation_archived",
  "Access denied",
])

/**
 * The `error` field the agent's chat route answers with: its status, in words. A closed list, so a
 * body from anything else in the way logs no reason at all.
 */
const AGENT_REASONS: ReadonlySet<string> = new Set([
  "Bad Request",
  "Unauthorized",
  "Forbidden",
  "Not Found",
  "Conflict",
  "Too Many Requests",
  "Processing Error",
  "Internal Server Error",
  "Service Unavailable",
])

/** The agent's machine codes are snake case. A person's words all but never are. */
const AGENT_CODE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/

export interface ChatErrorLogFields {
  errorName: string
  bodyLength: number
  reason?: string
  code?: string
}

/**
 * What a log line may say about a failed chat request: the status, in words, and never the body.
 *
 * ADDED 2026-11-06 (final review). The SDK gives no status, only an Error whose `message` is the raw
 * response body, and that body can carry what the person said. A 400 from the agent's chat route
 * has `details`, its zod `issues`. Zod 4 leaves the input out of those by default, but that is the
 * validator's default and not a promise, and a proxy in the way can answer with anything. So fields
 * come out by name, each from a closed shape, and anything else logs as a length.
 */
export function chatErrorLogFields(error: { name: string; message: string }): ChatErrorLogFields {
  const fields: ChatErrorLogFields = { errorName: error.name, bodyLength: error.message.length }
  let body: unknown
  try {
    body = JSON.parse(error.message)
  } catch {
    return fields
  }
  if (typeof body !== "object" || body === null) return fields
  const { error: reason, message: code } = body as { error?: unknown; message?: unknown }
  if (typeof reason === "string" && AGENT_REASONS.has(reason)) fields.reason = reason
  if (typeof code === "string" && (STALE_REFUSALS.has(code) || AGENT_CODE.test(code))) {
    fields.code = code
  }
  return fields
}

/**
 * Whether a chat error is one of the refusals above. The SDK surfaces a non-2xx
 * answer as an Error whose `message` is the raw response body, so this parses it.
 *
 * Only the parsed body's `message` field counts. A body that is not JSON (a proxy's
 * 502 page) or is JSON of another shape is not stale: it draws the error row, and
 * the words stay where they are in the list.
 */
export function isStaleRefusal(errorMessage: string): boolean {
  let body: unknown
  try {
    body = JSON.parse(errorMessage)
  } catch {
    return false
  }
  if (typeof body !== "object" || body === null) return false
  const message = (body as { message?: unknown }).message
  return typeof message === "string" && STALE_REFUSALS.has(message)
}
