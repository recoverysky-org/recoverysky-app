/**
 * What the Sky tab does each time it comes into focus, and whether the old chat
 * rows get wiped.
 *
 * PURE MODULE: no `@/` runtime imports, so vitest can import it (see CLAUDE.md
 * "Test Runner Split"). The reads and the id mint are injected, and
 * useAgentConversation applies the outcome to the store and the screen.
 *
 * ADDED 2026-11-06 (spec 2026-11-06-agent-chat-turn-only-design.md, D1, D4). The
 * chat thread now lives on the agent, so an open decides which thread to show.
 *
 * The reads never throw (`AgentRead`, agentConversationsLogic.ts), so neither does
 * `openConversation` unless a caller's deps do. Nothing here logs.
 */

import type { UIMessage } from "ai"

import { isValidAgentUrl } from "./agentTabLogic"
import type { AgentRead } from "../services/api/agentConversationsLogic"

export interface OpenInput {
  /** The persisted id; null when this device holds none. */
  conversationId: string | null
  /** The id was minted here and the agent has not taken a turn on it yet. */
  isFresh: boolean
  /** Ids of the turns this screen sent on `conversationId` since it last read. */
  sentIds: ReadonlySet<string>
  /** A thread is showing, so a failed read must leave it there rather than blank it. */
  threadOnScreen: boolean
}

export interface OpenDeps {
  listNewest(): Promise<AgentRead<string | null>>
  readMessages(id: string): Promise<AgentRead<UIMessage[]>>
  mintId(): string
}

export type OpenOutcome =
  /** Change nothing on screen. */
  | { kind: "keep" }
  /** Nothing to show and nothing known: the error row with a retry. The composer waits. */
  | { kind: "failed" }
  /**
   * A thread the agent has taken no turn on, with a live composer. Only a minted one (`minted`: the
   * id is new as of this open) is known to be empty. A persisted fresh id can have a failed turn's
   * words on screen, so the hook leaves the chat alone when that id is already showing.
   * CHANGED 2026-11-06 (final review): this used to call every fresh outcome empty.
   */
  | { kind: "fresh"; id: string; minted: boolean }
  /** This is the thread. `historyFailed` draws the error with the id still adopted. */
  | { kind: "thread"; id: string; history: UIMessage[]; historyFailed: boolean }

/** A refused read earns one more listing (D1), so at most two passes in all. */
const MAX_LISTINGS = 2

function holdsEveryId(messages: UIMessage[], ids: ReadonlySet<string>): boolean {
  const stored = new Set(messages.map((message) => message.id))
  return [...ids].every((id) => stored.has(id))
}

export async function openConversation(input: OpenInput, deps: OpenDeps): Promise<OpenOutcome> {
  const { conversationId, isFresh, sentIds, threadOnScreen } = input

  // Fresh returns before anything is read. The listing would answer an older thread
  // and undo New conversation, and a messages read could only answer 404 for an id
  // the agent has never seen (404s are what CrowdSec bans for). This holds with sent
  // ids too: a turn that failed before streaming leaves the id fresh, and its words
  // stay on screen. The flag means nothing without an id, so that case lists below.
  if (conversationId !== null && isFresh) {
    return { kind: "fresh", id: conversationId, minted: false }
  }

  // The agent stores every admitted turn under the id we sent, so a sent id missing
  // from the stored messages is a turn that exists only on this screen: a refused
  // turn's crisis resources (`crisisFallback`), or a failed turn's words. A tab switch
  // must not erase those, so listing waits until the agent holds them all. A read
  // that fails here proves nothing, so it keeps the screen too, whatever is on it.
  if (conversationId !== null && sentIds.size > 0) {
    const stored = await deps.readMessages(conversationId)
    if (stored.kind !== "ok" || !holdsEveryId(stored.value, sentIds)) return { kind: "keep" }
  }

  // A failure over a thread keeps it (a re-read never blanks the screen), and over
  // nothing it is the error row. Never a mint: a failed listing says nothing about
  // whether a thread exists, and a new id would fork it.
  const gaveUp: OpenOutcome = threadOnScreen ? { kind: "keep" } : { kind: "failed" }

  for (let pass = 0; pass < MAX_LISTINGS; pass++) {
    const listed = await deps.listNewest()
    if (listed.kind !== "ok") return gaveUp

    // A true answer and not a failed read, so it mints over a thread on screen too:
    // that is how an archive from another device arrives here.
    if (listed.value === null) return { kind: "fresh", id: deps.mintId(), minted: true }

    const id = listed.value
    const read = await deps.readMessages(id)
    if (read.kind === "ok") {
      return { kind: "thread", id, history: read.value, historyFailed: false }
    }
    // `unavailable` says nothing about the thread, so only over nothing does it show
    // the error, and the id is kept for the retry.
    if (read.kind === "unavailable") {
      return threadOnScreen
        ? { kind: "keep" }
        : { kind: "thread", id, history: [], historyFailed: true }
    }
    // `refused` (403, 404): this id is dead for this person. Drop it and list again.
  }

  // Refused twice. Over a thread this still keeps it, and a send from there earns the
  // agent's refusal and the stale path (D8), which puts the person's words back.
  return gaveUp
}

/**
 * The one-time delete of the chat rows in SQLite. Keyed on the build's
 * `EXPO_PUBLIC_AGENT_URL`, because an OTA also reaches production installs with the
 * tab hidden, where those rows are the person's only readable copy of chats from
 * before the tab was hidden (D4). Unread and encrypted, they cost nothing there.
 */
export function decideChatWipe(input: { done: boolean; agentUrlEnv: string | undefined }): boolean {
  return !input.done && isValidAgentUrl(input.agentUrlEnv)
}
