/**
 * What a Sky chat request carries, and which of the agent's refusals mean the
 * thread on screen is stale.
 *
 * PURE MODULE: a type-only `ai` import and no `@/` runtime imports, so vitest can
 * import it (see CLAUDE.md "Test Runner Split"). AgentScreen's transport calls
 * these from `prepareSendMessagesRequest` and from its error effect.
 *
 * ADDED 2026-11-06 (spec 2026-11-06-agent-chat-turn-only-design.md, D2, D8). The
 * agent now holds the history and builds each turn's context from it, so the app
 * says which conversation a turn belongs to and sends only that turn.
 */

import type { UIMessage } from "ai"

/**
 * The body of `POST /api/v1/chat`. Named by the wire, hence the snake case.
 *
 * `messages` is the turn alone, or empty when there is none. The agent reads the
 * last message either way, so this also parses on an older agent (spec D10).
 */
export interface ChatRequestBody {
  conversation_id: string
  messages: UIMessage[]
  timezone: string
  fellowship?: string
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
 */
export function chatRequestBody(
  conversationId: string,
  messages: readonly UIMessage[],
  timezone: string,
  fellowship: string | undefined,
): ChatRequestBody {
  const turn = turnOf(messages)
  return {
    conversation_id: conversationId,
    messages: turn ? [turn] : [],
    timezone,
    ...(fellowship ? { fellowship } : {}),
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
