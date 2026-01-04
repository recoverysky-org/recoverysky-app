/**
 * ChatHydrator Component
 *
 * Hydrates chat messages from encrypted SQLite once the database is ready.
 * Similar pattern to ProfileHydrator - headless component that handles async hydration.
 *
 * Place this inside DatabaseProvider and RootStoreProvider:
 * <RootStoreProvider>
 *   <DatabaseProvider>
 *     <ProfileHydrator />
 *     <ChatHydrator />
 *     ...
 *   </DatabaseProvider>
 * </RootStoreProvider>
 */

import { useEffect, useRef } from "react"

import { useStores } from "@/models"
import { logger } from "@/utils/logger"

import { useDatabase } from "./DatabaseProvider"

const log = logger.child({ module: "ChatHydrator" })

/**
 * Hydrates conversation store with messages from SQLite.
 * Renders nothing - just handles the side effect.
 */
export function ChatHydrator(): null {
  const { status } = useDatabase()
  const { conversationStore } = useStores()
  const hasHydrated = useRef(false)

  useEffect(() => {
    // Only hydrate once, when database is ready
    if ((status === "open" || status === "seeded") && !hasHydrated.current) {
      hasHydrated.current = true

      log.info("Database ready, hydrating chat messages from SQLite")

      conversationStore
        .hydrateFromSQLite()
        .then(() => {
          log.info("Chat hydration complete", {
            count: conversationStore.messageCount,
          })
        })
        .catch((err) => {
          log.error("Failed to hydrate chat messages", { error: String(err) })
        })
    }
  }, [status, conversationStore])

  return null
}
