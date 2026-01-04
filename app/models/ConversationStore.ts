import { Instance, SnapshotOut, types, flow } from "mobx-state-tree"
import type { UIMessage } from "ai"

import { chatMessageRepo } from "@/db/repositories"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "ConversationStore" })

/**
 * Stored message structure for volatile state
 */
interface StoredMessage {
  id: string
  role: "user" | "assistant" | "system"
  parts: unknown[]
  metadata?: unknown
  createdAt: number
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
 */
export const ConversationStoreModel = types
  .model("ConversationStore")
  .props({
    // === NON-SENSITIVE (stored in MMKV via snapshots) ===
    lastSyncedAt: types.optional(types.number, 0),
    messageCount: types.optional(types.number, 0),
  })
  .volatile(() => ({
    // === VOLATILE (stored in encrypted SQLite, NOT in snapshots) ===
    messages: [] as StoredMessage[],

    // Hydration flags
    _isHydrated: false,
    _isSyncing: false,
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

        self.messages = result.value.map((record: { id: string; role: string; parts: unknown[]; metadata?: unknown; createdAt: number }) => ({
          id: record.id,
          role: record.role as "user" | "assistant" | "system",
          parts: record.parts,
          metadata: record.metadata,
          createdAt: record.createdAt,
        }))

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
      const storedMessage: StoredMessage = {
        id: message.id,
        role: message.role,
        parts: message.parts as unknown[],
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
          parts: message.parts as unknown[],
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
              metadata: msg.metadata,
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
  }))

export interface ConversationStore extends Instance<typeof ConversationStoreModel> {}
export interface ConversationStoreSnapshot extends SnapshotOut<typeof ConversationStoreModel> {}
