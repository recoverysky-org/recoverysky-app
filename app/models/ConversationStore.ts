import type { UIMessage } from "ai"
import { Instance, SnapshotOut, types, flow } from "mobx-state-tree"

import { chatMessageRepo } from "@/db/repositories"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "ConversationStore" })

/** Max meetings to store in tool results (reduces context size) */
const MAX_TOOL_MEETINGS = 10

/**
 * Truncate meeting arrays in tool result parts to reduce stored data
 */
function truncateToolMeetings(parts: unknown[]): unknown[] {
  return parts.map((part) => {
    const p = part as Record<string, unknown>
    // Only process tool results with output
    if (p.type !== "dynamic-tool" && !String(p.type).startsWith("tool-")) return part
    if (!p.output || typeof p.output !== "object") return part

    const output = p.output as Record<string, unknown>
    const meetingsKey = output.meetings
      ? "meetings"
      : output.results
        ? "results"
        : output.data
          ? "data"
          : null

    if (!meetingsKey || !Array.isArray(output[meetingsKey])) return part
    if (output[meetingsKey].length <= MAX_TOOL_MEETINGS) return part

    // Truncate the meetings array
    return {
      ...p,
      output: {
        ...output,
        [meetingsKey]: output[meetingsKey].slice(0, MAX_TOOL_MEETINGS),
        _truncated: true,
        _originalCount: output[meetingsKey].length,
      },
    }
  })
}

/**
 * Collapsed tool result state
 */
interface CollapsedToolResult {
  summary: string
  collapsedAt: number
}

/**
 * Stored message structure for volatile state
 */
interface StoredMessage {
  id: string
  role: "user" | "assistant" | "system"
  parts: unknown[]
  metadata?: unknown
  createdAt: number
  /** Collapsed state for tool results in this message, keyed by toolCallId */
  collapsedToolResults?: Record<string, CollapsedToolResult>
}

/**
 * ConversationStore - Manages AI agent chat history
 *
 * STORAGE STRATEGY:
 * - Messages are stored in volatile state for fast in-memory access
 * - Persisted to encrypted SQLite (via chatMessageRepo)
 * - NOT stored in MMKV snapshots (messages can be large)
 *
 * SINGLE CONVERSATION:
 * - This store manages ONE continuous conversation
 * - Clear button wipes both memory and SQLite
 *
 * ADDED 2026-11-06 (spec 2026-11-06-agent-chat-turn-only-design.md): the thread moves to the agent
 * server. The new members below sit beside the old message members, which Task 7 removes. The two
 * props are all this device keeps of a conversation: which one it is on, and whether the agent has
 * seen it yet.
 */
export const ConversationStoreModel = types
  .model("ConversationStore")
  .props({
    // === NON-SENSITIVE (stored in MMKV via snapshots) ===
    lastSyncedAt: types.optional(types.number, 0),
    messageCount: types.optional(types.number, 0),

    // ADDED 2026-11-06: the agent's id for the thread on screen. Null until the first open picks one.
    conversationId: types.maybeNull(types.string),
    // ADDED 2026-11-06 (spec D1): true while the id was minted here and the agent has taken no turn
    // on it, so the open reads nothing. A read could only undo New conversation (the listing answers
    // an older thread) or earn a 404 for an id the agent never saw, and CrowdSec bans for 404s. It
    // persists because a restart between New conversation and the first turn must stay on this id.
    conversationIsFresh: types.optional(types.boolean, false),
  })
  .volatile(() => ({
    // === VOLATILE (stored in encrypted SQLite, NOT in snapshots) ===
    messages: [] as StoredMessage[],

    // Hydration flags
    _isHydrated: false,
    _isSyncing: false,

    // ADDED 2026-11-06 (spec D5): toolCallId -> the "Selected: …" summary of a collapsed card. Not
    // persisted, so a reload shows the tool result expanded again, as the agent stored it.
    // `.volatile` is a MobX observable reference and sees nothing inside the Map, so every write
    // has to install a new Map (collapseToolResult) or no card redraws.
    collapsedToolResults: new Map<string, string>(),
  }))
  .views((self) => ({
    /**
     * Check if messages have been loaded from SQLite
     */
    get isHydrated(): boolean {
      return self._isHydrated
    },

    /**
     * Get the last message (for display purposes)
     */
    get lastMessage(): StoredMessage | null {
      return self.messages.length > 0 ? self.messages[self.messages.length - 1] : null
    },

    /**
     * Check if there are any messages
     */
    get hasMessages(): boolean {
      return self.messages.length > 0
    },

    /**
     * Convert stored messages to UIMessage format for useChat
     */
    get uiMessages(): UIMessage[] {
      return self.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        parts: msg.parts as UIMessage["parts"],
        metadata: msg.metadata as UIMessage["metadata"],
      }))
    },

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
     * Hydrate messages from SQLite on app startup
     * Called from ChatHydrator after database is ready
     * Uses MST flow() for proper async action handling
     */
    hydrateFromSQLite: flow(function* hydrateFromSQLite() {
      if (self._isHydrated) {
        log.debug("Already hydrated, skipping")
        return
      }

      try {
        log.info("Hydrating chat messages from SQLite")
        const result = yield chatMessageRepo.findAll()

        if (!result.ok) {
          log.error("Failed to load messages", { error: String(result.error) })
          self._isHydrated = true
          return
        }

        self.messages = result.value.map(
          (record: {
            id: string
            role: string
            parts: unknown[]
            metadata?: unknown
            createdAt: number
          }) => {
            // Extract collapsedToolResults from metadata if present
            const metadata = record.metadata as Record<string, unknown> | undefined
            const collapsedToolResults = metadata?.collapsedToolResults as
              | Record<string, CollapsedToolResult>
              | undefined

            // Remove collapsedToolResults from metadata to avoid duplication
            const cleanMetadata =
              metadata && collapsedToolResults
                ? Object.fromEntries(
                    Object.entries(metadata).filter(([k]) => k !== "collapsedToolResults"),
                  )
                : metadata

            return {
              id: record.id,
              role: record.role as "user" | "assistant" | "system",
              parts: record.parts,
              metadata: cleanMetadata,
              createdAt: record.createdAt,
              collapsedToolResults,
            }
          },
        )

        self.messageCount = self.messages.length
        self._isHydrated = true

        log.info("Chat messages hydrated", { count: self.messages.length })
      } catch (error) {
        log.error("Hydration failed", { error: String(error) })
        self._isHydrated = true // Mark as hydrated to prevent infinite retries
      }
    }),

    /**
     * Add a new message to the conversation
     * Called when a message completes streaming
     */
    addMessage(message: UIMessage) {
      const now = Date.now()
      // Truncate meeting arrays in tool results to reduce context size
      const truncatedParts = truncateToolMeetings(message.parts as unknown[])

      const storedMessage: StoredMessage = {
        id: message.id,
        role: message.role,
        parts: truncatedParts,
        metadata: message.metadata as unknown,
        createdAt: now,
      }

      // Add to in-memory store
      self.messages.push(storedMessage)
      self.messageCount = self.messages.length

      // Persist to SQLite (fire-and-forget)
      chatMessageRepo
        .create({
          id: message.id,
          role: message.role,
          parts: truncatedParts,
          metadata: message.metadata,
        })
        .then((result) => {
          if (!result.ok) {
            log.error("Failed to persist message", {
              messageId: message.id,
              error: String(result.error),
            })
          } else {
            log.debug("Message persisted", { messageId: message.id })
          }
        })
        .catch((err) => {
          log.error("Message persistence error", { error: String(err) })
        })
    },

    /**
     * Add multiple messages at once (for initial sync)
     */
    addMessages(messages: UIMessage[]) {
      const now = Date.now()
      const storedMessages: StoredMessage[] = messages.map((msg, idx) => ({
        id: msg.id,
        role: msg.role,
        parts: msg.parts as unknown[],
        metadata: msg.metadata as unknown,
        createdAt: now + idx,
      }))

      // Add to in-memory store
      self.messages.push(...storedMessages)
      self.messageCount = self.messages.length

      // Persist to SQLite
      chatMessageRepo
        .createMany(
          storedMessages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            parts: msg.parts,
            metadata: msg.metadata,
          })),
        )
        .catch((err) => {
          log.error("Bulk message persistence error", { error: String(err) })
        })
    },

    /**
     * Clear all conversation history
     */
    clearHistory() {
      log.info("Clearing conversation history")

      // Clear in-memory store
      self.messages = []
      self.messageCount = 0

      // Clear SQLite (fire-and-forget - don't modify state in callback)
      chatMessageRepo
        .clear()
        .then((result) => {
          if (!result.ok) {
            log.error("Failed to clear SQLite messages", { error: String(result.error) })
          } else {
            log.info("SQLite messages cleared")
          }
        })
        .catch((err) => {
          log.error("Clear history error", { error: String(err) })
        })
    },

    /**
     * Update lastSyncedAt timestamp (separate action for use after async operations)
     */
    setLastSyncedAt(timestamp: number) {
      self.lastSyncedAt = timestamp
    },

    /**
     * Sync in-memory state to SQLite (for recovery scenarios)
     * Uses MST flow() for proper async action handling
     */
    syncToSQLite: flow(function* syncToSQLite() {
      if (self._isSyncing) {
        log.debug("Sync already in progress")
        return
      }

      self._isSyncing = true

      try {
        // Clear and re-insert all messages
        yield chatMessageRepo.clear()

        if (self.messages.length > 0) {
          yield chatMessageRepo.createMany(
            self.messages.map((msg) => ({
              id: msg.id,
              role: msg.role,
              parts: msg.parts,
              // Merge collapsedToolResults into metadata for persistence
              metadata: msg.collapsedToolResults
                ? {
                    ...((msg.metadata as object) || {}),
                    collapsedToolResults: msg.collapsedToolResults,
                  }
                : msg.metadata,
            })),
          )
        }

        self.lastSyncedAt = Date.now()
        log.info("Synced to SQLite", { count: self.messages.length })
      } catch (error) {
        log.error("Sync to SQLite failed", { error: String(error) })
      } finally {
        self._isSyncing = false
      }
    }),

    /**
     * Collapse a tool result with a summary
     * CHANGED 2026-11-06 (spec D5): writes the volatile map, keyed by toolCallId alone. The old
     * action looked for a message part typed `tool-result`, but the SDK's parts are typed `tool-*`
     * or `dynamic-tool`, so it never found one and the card never collapsed. The summary names a
     * meeting the person chose, so it stays out of the logs.
     */
    collapseToolResult(toolCallId: string, summary: string) {
      // A new Map on every write: see the volatile's comment.
      const next = new Map(self.collapsedToolResults)
      next.set(toolCallId, summary)
      self.collapsedToolResults = next
      log.debug("Tool result collapsed", { toolCallId })
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
