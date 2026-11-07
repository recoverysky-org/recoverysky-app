/**
 * Reads and archive for the conversations the Sky agent holds.
 *
 * PURE MODULE — no `@/` runtime imports (see CLAUDE.md "Test Runner Split"),
 * and `UIMessage` is a type-only import. Credentials and fetch are injected;
 * agentConversations.ts binds the real ones.
 *
 * ADDED 2026-11-06 (spec 2026-11-06-agent-chat-turn-only-design.md, D1, D3, D6,
 * D7). The chat thread moves from the device to the agent, so the Sky tab reads
 * it from these routes on every open.
 *
 * No method throws: a read answers an `AgentRead`, archive answers a boolean.
 * Nothing here logs, so nothing of what was said can reach a log line. The
 * callers decide what a failure is worth.
 *
 * This is plain fetch, not the apisauce client in index.ts: that client is bound
 * to the RecoverySky API's URL, and its monitors would read an agent 401 as a
 * verdict on the RecoverySky device JWT.
 */

import type { UIMessage } from "ai"

/**
 * What a read can answer. `refused` and `unavailable` lead to different places,
 * so don't merge them: `refused` says this id is dead for this person (the
 * caller drops it and lists again), `unavailable` says nothing about the thread
 * (the caller keeps what it has, and must not mint an id over it).
 */
export type AgentRead<T> = { kind: "ok"; value: T } | { kind: "refused" } | { kind: "unavailable" }

/** The agent's default guide, the one the chat tab's turns run under. */
export const AGENT_GUIDE = "base-identity"

/** Bound on credentials, response and body together; see `exchange`. */
const DEFAULT_TIMEOUT_MS = 15_000

/** The most the agent serves in one read (its `messagesQuerySchema` caps at 200). */
const MESSAGES_LIMIT = 200

export interface AgentConversationsClient {
  /** The id of the person's newest conversation under AGENT_GUIDE; null when none is listed. */
  listNewest(): Promise<AgentRead<string | null>>
  readMessages(id: string): Promise<AgentRead<UIMessage[]>>
  /**
   * Archives the person's AGENT_GUIDE conversations, all but `except`. True only
   * when the agent answered with a 2xx. `timeoutMs` overrides the client's bound.
   */
  archive(opts: { except?: string; timeoutMs?: number }): Promise<boolean>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isStoredMessage(entry: unknown): entry is UIMessage {
  return (
    isRecord(entry) &&
    isNonEmptyString(entry.id) &&
    isNonEmptyString(entry.role) &&
    Array.isArray(entry.parts)
  )
}

function parseNewest(body: unknown): AgentRead<string | null> {
  const rows = isRecord(body) ? body.conversations : undefined
  if (!Array.isArray(rows)) return { kind: "unavailable" }
  if (rows.length === 0) return { kind: "ok", value: null }
  // A row we cannot read is a failed read and never "none listed": null sends
  // the caller off to mint an id, which would fork the person's thread (D1).
  const first: unknown = rows[0]
  const id = isRecord(first) ? first.conversationId : undefined
  return isNonEmptyString(id) ? { kind: "ok", value: id } : { kind: "unavailable" }
}

function parseMessages(body: unknown): AgentRead<UIMessage[]> {
  const entries = isRecord(body) ? body.messages : undefined
  if (!Array.isArray(entries)) return { kind: "unavailable" }
  // One malformed entry costs that entry, not the whole thread.
  return { kind: "ok", value: entries.filter(isStoredMessage) }
}

export function createAgentConversationsClient(deps: {
  baseUrl: string
  headers: () => Promise<Record<string, string>>
  fetch: typeof globalThis.fetch
  timeoutMs?: number
}): AgentConversationsClient {
  const defaultTimeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  /**
   * One request, start to finish, answering `failed` on any throw or at the
   * timeout. The race sits around the whole attempt because the abort signal
   * alone covers only the fetch: `api.agentHeaders()` can wait on an attestation
   * refresh, and Delete User Data holds its 5-second bound (D7) through that too.
   */
  async function exchange<T>(request: {
    path: string
    init?: RequestInit
    timeoutMs?: number
    failed: T
    read: (response: Response) => T | Promise<T>
  }): Promise<T> {
    const { path, init, failed, read } = request
    const controller = new AbortController()

    const attempt = async () => {
      const headers = await deps.headers()
      // We gave up while the credentials were on their way. Going out now would
      // act on a request the caller was already told had failed.
      if (controller.signal.aborted) return failed
      const response = await deps.fetch(`${deps.baseUrl}${path}`, {
        ...init,
        headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
        signal: controller.signal,
      })
      return await read(response)
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const gaveUp = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve(failed)
      }, request.timeoutMs ?? defaultTimeoutMs)
    })

    try {
      return await Promise.race([attempt().catch(() => failed), gaveUp])
    } finally {
      clearTimeout(timer)
    }
  }

  const unavailable = { kind: "unavailable" } as const

  return {
    listNewest: () =>
      exchange<AgentRead<string | null>>({
        path: `/api/v1/conversations?guide=${AGENT_GUIDE}&limit=1`,
        failed: unavailable,
        // Every failure here is unavailable, including a 403: there is no id
        // for the caller to drop, and "refused" would only ever mean a bad bearer.
        read: async (response) => (response.ok ? parseNewest(await response.json()) : unavailable),
      }),

    readMessages: (id) =>
      exchange<AgentRead<UIMessage[]>>({
        path: `/api/v1/conversations/${encodeURIComponent(id)}/messages?limit=${MESSAGES_LIMIT}`,
        failed: unavailable,
        read: async (response) => {
          // 403: the owner was relinked. 404: the thread is gone. Only these two
          // are about the id; a 401 or a 503 must not cost the person their thread.
          if (response.status === 403 || response.status === 404) return { kind: "refused" }
          return response.ok ? parseMessages(await response.json()) : unavailable
        },
      }),

    archive: ({ except, timeoutMs }) =>
      exchange<boolean>({
        path: "/api/v1/conversations/archive",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // JSON.stringify leaves `except` out when it is undefined: that is the
          // "archive them all" form Delete User Data sends (D7).
          body: JSON.stringify({ guide: AGENT_GUIDE, except }),
        },
        timeoutMs,
        failed: false,
        read: (response) => response.ok,
      }),
  }
}
