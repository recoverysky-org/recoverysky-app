import { Instance, SnapshotOut, types } from "mobx-state-tree"

/**
 * ConversationStore - which conversation with Sky this device is on
 *
 * CHANGED 2026-11-06 (spec 2026-11-06-agent-chat-turn-only-design.md, D1, D4, D5): the agent holds
 * the history, and the Sky tab reads it from there (useAgentConversation). This store used to hold
 * the messages in memory and in the encrypted SQLite; none of that is left, and ChatWipeRunner
 * deletes the rows an earlier build kept.
 *
 * What is left is all this device keeps of a conversation:
 * - two props, persisted in the MMKV snapshot: which thread it is on, and whether the agent has seen
 *   that thread yet. An id and a flag, nothing of what was said.
 * - one volatile map of which tool cards the person collapsed.
 *
 * SINGLE CONVERSATION: the device is on one thread at a time. New conversation starts another, and
 * Delete User Data forgets this one.
 *
 * No runtime `@/` import here, the logger included: vitest covers this file and cannot resolve the
 * alias (CLAUDE.md "Test Runner Split"). A log line belongs to the caller.
 */
export const ConversationStoreModel = types
  .model("ConversationStore")
  .props({
    // === NON-SENSITIVE (stored in MMKV via snapshots) ===
    // ADDED 2026-11-06: the agent's id for the thread on screen. Null until the first open picks one.
    conversationId: types.maybeNull(types.string),
    // ADDED 2026-11-06 (spec D1): true while the id was minted here and the agent has taken no turn
    // on it, so the open reads nothing. A read could only undo New conversation (the listing answers
    // an older thread) or earn a 404 for an id the agent never saw, and CrowdSec bans for 404s. It
    // persists because a restart between New conversation and the first turn must stay on this id.
    conversationIsFresh: types.optional(types.boolean, false),
  })
  .volatile(() => ({
    // ADDED 2026-11-06 (spec D5): toolCallId -> the "Selected: …" summary of a collapsed card. Not
    // persisted, so a reload shows the tool result expanded again, as the agent stored it.
    // `.volatile` is a MobX observable reference and sees nothing inside the Map, so every write
    // has to install a new Map (collapseToolResult) or no card redraws.
    collapsedToolResults: new Map<string, string>(),
  }))
  .views((self) => ({
    /**
     * Get collapse state for a specific tool call
     * CHANGED 2026-11-06 (spec D5): reads the volatile map instead of searching the stored messages,
     * whose collapse state the old action never managed to write (see collapseToolResult).
     */
    getCollapseState(toolCallId: string): { summary: string } | null {
      const summary = self.collapsedToolResults.get(toolCallId)
      return summary === undefined ? null : { summary }
    },
  }))
  .actions((self) => ({
    /**
     * Collapse a tool result with a summary
     * CHANGED 2026-11-06 (spec D5): writes the volatile map, keyed by toolCallId alone. The old
     * action looked for a message part typed `tool-result`, but the SDK's parts are typed `tool-*`
     * or `dynamic-tool`, so it never found one and the card never collapsed. The summary names a
     * meeting the person chose, so it stays out of the logs.
     * CHANGED 2026-11-06 (spec D4): the debug line of the call id went with the store's logger.
     */
    collapseToolResult(toolCallId: string, summary: string) {
      // A new Map on every write: see the volatile's comment.
      const next = new Map(self.collapsedToolResults)
      next.set(toolCallId, summary)
      self.collapsedToolResults = next
    },

    /**
     * ADDED 2026-11-08: open a collapsed card again, from a tap on its badge. A card holds every
     * meeting a call returned, and the agent tells Sky each one reaches the person as a card they can
     * tap ("offer both cards"), so looking at one must not hide the others for good.
     */
    expandToolResult(toolCallId: string) {
      if (!self.collapsedToolResults.has(toolCallId)) return
      // A new Map on every write: see the volatile's comment.
      const next = new Map(self.collapsedToolResults)
      next.delete(toolCallId)
      self.collapsedToolResults = next
    },

    /**
     * ADDED 2026-11-06 (spec D1, D6): a thread minted on this device. Fresh until its first turn
     * streams. Tool call ids belong to the thread being left, so the map goes with it.
     */
    startNewConversation(id: string) {
      self.conversationId = id
      self.conversationIsFresh = true
      self.collapsedToolResults = new Map()
    },

    /**
     * ADDED 2026-11-06 (spec D1): the thread the agent listed as newest. Runs on every re-read of
     * the same thread, so it leaves the collapse map alone: a focus must not reopen a card.
     */
    adoptConversation(id: string) {
      self.conversationId = id
      self.conversationIsFresh = false
    },

    /**
     * ADDED 2026-11-06 (spec D1): a turn started streaming, so the agent has stored the person's
     * message and the id can be read from now on. A turn that fails before that leaves it fresh.
     */
    markConversationOnAgent() {
      self.conversationIsFresh = false
    },

    /**
     * ADDED 2026-11-06 (spec D1): back to no thread, so the next open asks the agent for its newest.
     */
    forgetConversation() {
      self.conversationId = null
      self.conversationIsFresh = false
      self.collapsedToolResults = new Map()
    },
  }))

export interface ConversationStore extends Instance<typeof ConversationStoreModel> {}
export interface ConversationStoreSnapshot extends SnapshotOut<typeof ConversationStoreModel> {}
