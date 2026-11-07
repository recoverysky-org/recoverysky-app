/**
 * The agent conversation client, bound to the app's credentials and fetch. The
 * logic and its tests are in agentConversationsLogic.ts.
 *
 * ADDED 2026-11-06 (spec 2026-11-06-agent-chat-turn-only-design.md). The base URL
 * is a parameter because the caller holds it (`configStore.agentUrl`), and this
 * folder must stay a dependency leaf, so it cannot import the stores.
 */

import {
  createAgentConversationsClient,
  type AgentConversationsClient,
} from "./agentConversationsLogic"

import { api } from "./index"

export function agentConversationsClient(baseUrl: string): AgentConversationsClient {
  return createAgentConversationsClient({
    baseUrl,
    // Resolved per request: the device JWT and the bearer rotate (see api.agentHeaders)
    headers: () => api.agentHeaders(),
    // A wrapper, not the bare reference: the client calls this as `deps.fetch(...)`,
    // and the browser's fetch throws "Illegal invocation" with `this` set to anything
    // but the window. The client would catch that and answer unavailable forever.
    fetch: (input, init) => globalThis.fetch(input, init),
  })
}
