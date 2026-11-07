/**
 * Which conversation the Sky tab shows, read from the agent on every open.
 *
 * ADDED 2026-11-06 (spec 2026-11-06-agent-chat-turn-only-design.md, D1, D3, D6, D8). The thread
 * lives on the agent, so this hook runs the pure open flow (`openConversation`) and applies what it
 * answers to the store and the screen. Every decision that can be pure is in
 * app/utils/agentConversationLogic.ts. What is here is timing: when an open runs, and whether its
 * answer is still true when it lands.
 *
 * The rule the timing serves: some turns exist only on the screen. The agent stores nothing for a
 * refused turn, including the crisis resources it streams for one, and a failed turn's words were
 * never answered. A read that replaces the list at the wrong moment erases those for good.
 */

import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { randomUUID } from "expo-crypto"
import { useIsFocused } from "@react-navigation/native"
import type { UIMessage } from "ai"

import { useConversationStore } from "@/models"
import { agentConversationsClient } from "@/services/api/agentConversations"
import type { AgentRead } from "@/services/api/agentConversationsLogic"
import { trackEvent } from "@/services/tracking"
import { openConversation, type OpenDeps, type OpenOutcome } from "@/utils/agentConversationLogic"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "useAgentConversation" })

export type AgentConversationView =
  /** Nothing known yet. Nothing to show, and no composer. */
  | { phase: "loading" }
  /** The listing failed over nothing: the error row with a retry. No composer (spec D1). */
  | { phase: "failed" }
  /**
   * A thread. `readAt` changes only when `history` is what the mounted chat should now show, so
   * the screen keys its `setMessages` on it. Don't bump it for anything else: a bump with an empty
   * history erases whatever the chat holds.
   */
  | { phase: "ready"; id: string; history: UIMessage[]; historyFailed: boolean; readAt: number }

/**
 * What the chat tells this hook about the turn in hand. A ref, not state: the transport writes
 * `sentIds` from inside the SDK's send, and neither field should cause a render.
 */
export interface AgentChatState {
  /** A turn is on its way or streaming. AgentChat mirrors `useChat`'s status into this. */
  busy: boolean
  /** Ids of the turns sent on this conversation since it was last read (spec D1). */
  sentIds: Set<string>
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

export function useAgentConversation({
  agentUrl,
  enabled,
}: {
  agentUrl: string
  enabled: boolean
}): {
  view: AgentConversationView
  chatState: MutableRefObject<AgentChatState>
  retry(): void
  reopenStale(): void
  startNew(): void
} {
  const store = useConversationStore()
  const isFocused = useIsFocused()

  const [view, setView] = useState<AgentConversationView>({ phase: "loading" })
  // The open reads this rather than `view`: a callback's closure would hold the view of the render
  // it was made in, and the decisions below are about what is showing now.
  const viewRef = useRef(view)
  const chatState = useRef<AgentChatState>({ busy: false, sentIds: new Set() })

  // Bumped by each open and by startNew, so a read that lands after either is dropped. Applying it
  // would undo New conversation, because the listing answers the older thread.
  const generation = useRef(0)
  // A counter and not the clock: two reads in one millisecond must still read as two.
  const readCount = useRef(0)

  const client = useMemo(() => agentConversationsClient(agentUrl), [agentUrl])

  const show = useCallback((next: AgentConversationView) => {
    viewRef.current = next
    setView(next)
  }, [])

  const showThread = useCallback(
    (id: string, history: UIMessage[], historyFailed: boolean) => {
      readCount.current += 1
      show({ phase: "ready", id, history, historyFailed, readAt: readCount.current })
    },
    [show],
  )

  // Spec D1 says a failed re-read logs, and neither the pure module nor the client can: `keep`
  // merges an unstored turn with a failed read, so by the time an outcome lands the cause is gone.
  // The read's name and its kind only. No ids of messages, and nothing of what was said.
  const deps: OpenDeps = useMemo(() => {
    const logged = <T>(read: string, answer: AgentRead<T>): AgentRead<T> => {
      if (answer.kind !== "ok")
        log.warn("Agent conversation read failed", { read, kind: answer.kind })
      return answer
    }
    return {
      listNewest: async () => logged("listNewest", await client.listNewest()),
      readMessages: async (id) => logged("readMessages", await client.readMessages(id)),
      mintId: () => randomUUID(),
    }
  }, [client])

  const applyOutcome = useCallback(
    (outcome: OpenOutcome) => {
      switch (outcome.kind) {
        case "keep":
          return

        case "failed":
          // Whatever the cause: a fresh id never reaches `failed`, and a listed id is listed again
          // on the next open.
          store.forgetConversation()
          show({ phase: "failed" })
          return

        case "fresh": {
          if (outcome.minted) {
            store.startNewConversation(outcome.id)
            // Old ids checked against the new conversation would answer `keep` for good.
            chatState.current.sentIds.clear()
            showThread(outcome.id, [], false)
            return
          }
          // The id already showing changes nothing, and readAt must not move. `sentIds` may hold a
          // turn that failed before streaming, whose words are on screen, and a setMessages([])
          // would erase them. This is the case on every refocus while the id stays fresh.
          const showing = viewRef.current
          if (showing.phase === "ready" && showing.id === outcome.id) return
          showThread(outcome.id, [], false)
          return
        }

        case "thread":
          store.adoptConversation(outcome.id)
          // The open only gets here once the agent holds every sent id, or there were none. Left in
          // the set, they would be checked against whatever thread comes next.
          chatState.current.sentIds.clear()
          showThread(outcome.id, outcome.history, outcome.historyFailed)
          return
      }
    },
    [store, show, showThread],
  )

  const open = useCallback(async () => {
    // Spec D1: no read runs while a reply streams. Its answer would predate the turn on screen.
    if (chatState.current.busy) return

    const startedAs = ++generation.current
    const sentAtStart = new Set(chatState.current.sentIds)
    const showing = viewRef.current
    // A failed turn with no history is still a thread on screen, so a failed read must leave it.
    const threadOnScreen =
      showing.phase === "ready" && (showing.history.length > 0 || sentAtStart.size > 0)

    // Only from the failed row. Over a ready view this must not pass through loading, which unmounts
    // the chat, and with it any turn that exists only on screen.
    if (showing.phase === "failed") show({ phase: "loading" })

    const outcome = await openConversation(
      {
        conversationId: store.conversationId,
        isFresh: store.conversationIsFresh,
        sentIds: sentAtStart,
        threadOnScreen,
      },
      deps,
    )

    if (startedAs !== generation.current) return
    // A read that lands while a turn runs, or after one was sent since it started, is dropped whole
    // (not merged). Its answer predates the turn on screen, and applying it would erase that turn.
    // The cost is one skipped refresh until the next focus.
    if (chatState.current.busy || !sameIds(sentAtStart, chatState.current.sentIds)) return

    applyOutcome(outcome)
  }, [store, deps, show, applyOutcome])

  // Bottom tabs stay mounted, so mount alone would run once per launch and New conversation on
  // another device would never arrive. So this keys on the edge, of focus and of `enabled` together:
  // a session and consent can arrive while the tab is showing, and a tab out of focus needs no read.
  const canOpen = isFocused && enabled
  const couldOpen = useRef(false)
  useEffect(() => {
    const rose = canOpen && !couldOpen.current
    couldOpen.current = canOpen
    if (rose) void open()
  }, [canOpen, open])

  // A sign-out unmounts the tab. A read still on its way must not write the old session's id into
  // the store, where the next sign-in reads it. `couldOpen` is reset so a remount sees an edge.
  useEffect(
    () => () => {
      generation.current += 1
      couldOpen.current = false
    },
    [],
  )

  const retry = useCallback(() => {
    void open()
  }, [open])

  const reopenStale = useCallback(() => {
    store.forgetConversation()
    chatState.current.sentIds.clear()
    // A stale refusal means no turn is running, and only this open can leave `loading`. A busy
    // flag left over here would hold the screen on loading for good.
    chatState.current.busy = false
    show({ phase: "loading" })
    void open()
  }, [store, show, open])

  const startNew = useCallback(() => {
    generation.current += 1
    const id = randomUUID()
    store.startNewConversation(id)
    chatState.current.sentIds.clear()
    showThread(id, [], false)
    trackEvent("agent_conversation_started")
    // Unawaited, and `except` is what makes that safe: it can land before or after the first turn
    // (agent A1). This device stays on the new thread whatever it answers, so a failure costs only
    // that a second device sees the old thread until the first turn lands here (spec D6).
    void client.archive({ except: id }).then((archived) => {
      if (!archived) log.warn("Agent conversation archive failed")
    })
  }, [store, client, showThread])

  return { view, chatState, retry, reopenStale, startNew }
}
