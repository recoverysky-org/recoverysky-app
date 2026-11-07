/**
 * ChatWipeRunner Component
 *
 * ADDED 2026-11-06 (spec 2026-11-06-agent-chat-turn-only-design.md, D4): deletes the chat rows an
 * earlier build kept in the encrypted SQLite, once. The agent holds the thread now, and nothing reads
 * those rows or writes new ones. Headless (renders null). It took the slot of ChatHydrator, which
 * loaded the same rows into ConversationStore.
 *
 * Why this does not run in production yet: the pass runs only in a build with a valid
 * EXPO_PUBLIC_AGENT_URL (`decideChatWipe`). An OTA also reaches production installs with the tab
 * hidden, and there those rows are the person's only readable copy of chats from before the tab was
 * hidden, with no notice and no way to see they are gone. Unread and encrypted, they cost nothing
 * where they are, and Delete User Data still removes them with the database file. So the production
 * wipe happens only when the tab returns there, which is a decision to make knowingly (`TODO.md`).
 * Don't drop the URL gate to "finish the cleanup".
 *
 * Why an app-side pass and not a migration: the migration list is drizzle's, inside the vendored
 * @recoverysky-org/common, and a common release should not gate this.
 *
 * The pattern is BackupPassRunner's (a ref for once per launch, an MMKV flag for once ever), with one
 * difference: the flag is saved only after the delete reports success, so a failed wipe tries again
 * next launch rather than leaving the rows behind for good.
 *
 * Place inside DatabaseProvider:
 * <DatabaseProvider>
 *   <ProfileHydrator />
 *   <ChatWipeRunner />
 *   ...
 * </DatabaseProvider>
 */

import { useEffect, useRef } from "react"

import { decideChatWipe } from "@/utils/agentConversationLogic"
import { logger } from "@/utils/logger"
import { loadString, saveString } from "@/utils/storage"

import { useDatabase } from "./DatabaseProvider"
import { chatMessageRepo } from "./repositories"

const log = logger.child({ module: "ChatWipeRunner" })

/** MMKV key set once the chat rows are gone from this install. Its presence is the flag. */
const CHAT_WIPE_DONE_KEY = "agent.chatWipe.done"

/**
 * Logs the outcome only. The errors are safe to stringify: the statement is a bare `DELETE` with no
 * row values in it, so a failure has none of what was said to carry.
 */
async function wipeChatRows(): Promise<void> {
  try {
    const result = await chatMessageRepo.clear()
    if (!result.ok) {
      log.error("Chat wipe failed, will try again next launch", { error: String(result.error) })
      return
    }
    saveString(CHAT_WIPE_DONE_KEY, "1")
    log.info("Chat rows wiped")
  } catch (err) {
    // `clear` builds its repository before it can answer with a Result, and that step can throw.
    log.error("Chat wipe threw, will try again next launch", { error: String(err) })
  }
}

export function ChatWipeRunner(): null {
  const { status } = useDatabase()
  const hasRun = useRef(false)

  useEffect(() => {
    if (status !== "seeded") return
    // The status leaves "seeded" and comes back around a rekey, which re-runs this effect.
    if (hasRun.current) return
    hasRun.current = true

    const shouldWipe = decideChatWipe({
      done: loadString(CHAT_WIPE_DONE_KEY) !== null,
      // The direct expression, because Expo inlines EXPO_PUBLIC_* only in this exact form. Never
      // configStore.agentUrl, which falls back to a default and is never empty.
      agentUrlEnv: process.env.EXPO_PUBLIC_AGENT_URL,
    })
    if (!shouldWipe) return

    void wipeChatRows()
  }, [status])

  return null
}
