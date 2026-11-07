import { act, renderHook, waitFor } from "@testing-library/react-native"
import type { UIMessage } from "ai"

import { ConversationStoreModel, type ConversationStore } from "@/models/ConversationStore"
import type { AgentRead } from "@/services/api/agentConversationsLogic"

import { useAgentConversation } from "./useAgentConversation"

// Bottom tabs stay mounted, so focus is an input these tests move by hand.
let mockFocused = true
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }))

let mockUuid = 0
jest.mock("expo-crypto", () => ({ randomUUID: () => `minted-${++mockUuid}` }))

const mockClient = {
  listNewest: jest.fn<Promise<AgentRead<string | null>>, []>(),
  readMessages: jest.fn<Promise<AgentRead<UIMessage[]>>, [string]>(),
  archive: jest.fn<Promise<boolean>, [{ except?: string }]>(),
}
const mockClientFor = jest.fn((_baseUrl: string) => mockClient)
jest.mock("@/services/api/agentConversations", () => ({
  agentConversationsClient: (baseUrl: string) => mockClientFor(baseUrl),
}))

const mockTrackEvent = jest.fn()
jest.mock("@/services/tracking", () => ({ trackEvent: (event: string) => mockTrackEvent(event) }))

const mockWarn = jest.fn()
jest.mock("@/utils/logger", () => ({
  logger: {
    child: () => ({
      warn: (...args: unknown[]) => mockWarn(...args),
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    }),
  },
}))

// A real store, so these tests read what the hook leaves behind rather than a list of calls.
// Its old message members still import the encrypted database's repositories (Task 7 removes them).
jest.mock("@/db/repositories", () => ({ chatMessageRepo: {} }))
let mockStore: ConversationStore
jest.mock("@/models", () => ({ useConversationStore: () => mockStore }))

const AGENT_URL = "https://agent.test"

function message(id: string, text = "words"): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] }
}

/** A promise the test settles by hand, for a read that lands at a moment of its choosing. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

type Props = { enabled: boolean }

function mount(enabled = true) {
  return renderHook(
    ({ enabled: on }: Props) => useAgentConversation({ agentUrl: AGENT_URL, enabled: on }),
    { initialProps: { enabled } },
  )
}

/** Mount and wait for the first open to settle on a ready thread. */
async function mountOnThread(id = "listed", history: UIMessage[] = [message("m1")]) {
  mockClient.listNewest.mockResolvedValueOnce({ kind: "ok", value: id })
  mockClient.readMessages.mockResolvedValueOnce({ kind: "ok", value: history })
  const hook = mount()
  await waitFor(() => expect(hook.result.current.view.phase).toBe("ready"))
  jest.clearAllMocks()
  return hook
}

/** Tab away and back: the edge the open keys on. */
async function refocus(hook: ReturnType<typeof mount>) {
  mockFocused = false
  hook.rerender({ enabled: true })
  mockFocused = true
  hook.rerender({ enabled: true })
  await act(async () => {})
}

const ready = (view: ReturnType<typeof useAgentConversation>["view"]) => {
  if (view.phase !== "ready") throw new Error(`expected ready, got ${view.phase}`)
  return view
}

describe("useAgentConversation", () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockClientFor.mockImplementation(() => mockClient)
    mockClient.archive.mockResolvedValue(true)
    mockFocused = true
    mockUuid = 0
    mockStore = ConversationStoreModel.create({})
  })

  describe("when it opens", () => {
    it("opens on the focus edge, not on every render", async () => {
      const hook = await mountOnThread()
      mockClient.listNewest.mockResolvedValue({ kind: "ok", value: "listed" })
      mockClient.readMessages.mockResolvedValue({ kind: "ok", value: [message("m1")] })

      // Plain renders: nothing moved, so nothing is read.
      hook.rerender({ enabled: true })
      hook.rerender({ enabled: true })
      await act(async () => {})
      expect(mockClient.listNewest).not.toHaveBeenCalled()

      // Bottom tabs stay mounted: a return to the tab is the only way New conversation on
      // another device ever arrives.
      await refocus(hook)
      expect(mockClient.listNewest).toHaveBeenCalledTimes(1)
    })

    it("runs no read before it is enabled, and opens when it turns true", async () => {
      mockClient.listNewest.mockResolvedValue({ kind: "ok", value: null })
      const hook = mount(false)
      await act(async () => {})
      expect(mockClient.listNewest).not.toHaveBeenCalled()
      expect(hook.result.current.view).toEqual({ phase: "loading" })

      hook.rerender({ enabled: true })
      await waitFor(() => expect(hook.result.current.view.phase).toBe("ready"))
      expect(mockClient.listNewest).toHaveBeenCalledTimes(1)
    })

    it("reads from the agent URL it was given", async () => {
      mockClient.listNewest.mockResolvedValue({ kind: "ok", value: null })
      mount()
      await act(async () => {})
      expect(mockClientFor).toHaveBeenCalledWith(AGENT_URL)
    })

    // The URL rebuilds the client and with it the open callback, and /config can move the URL while
    // the tab shows. Only the edge opens: a read here could land on a thread on screen for nothing.
    it("does not open again when the agent URL changes", async () => {
      // A listed thread and not a minted one: a fresh id reads nothing, so a second open would not
      // show up in the count, and this test could not fail.
      mockClient.listNewest.mockResolvedValue({ kind: "ok", value: "listed" })
      mockClient.readMessages.mockResolvedValue({ kind: "ok", value: [message("m1")] })
      // A new object per call, as the real factory gives. The shared mock would leave `open`
      // unchanged, the effect would never re-run, and again this test could not fail.
      mockClientFor.mockImplementation(() => ({ ...mockClient }))
      const hook = renderHook(
        ({ agentUrl }: { agentUrl: string }) => useAgentConversation({ agentUrl, enabled: true }),
        { initialProps: { agentUrl: AGENT_URL } },
      )
      await waitFor(() => expect(hook.result.current.view.phase).toBe("ready"))
      expect(mockClient.listNewest).toHaveBeenCalledTimes(1)

      hook.rerender({ agentUrl: "https://moved.test" })
      await act(async () => {})

      expect(mockClient.listNewest).toHaveBeenCalledTimes(1)
    })

    it("runs no read while the tab is out of focus, even once enabled", async () => {
      mockFocused = false
      const hook = mount(false)
      hook.rerender({ enabled: true })
      await act(async () => {})
      expect(mockClient.listNewest).not.toHaveBeenCalled()
    })

    it("skips an open while a turn is busy", async () => {
      const hook = await mountOnThread()
      hook.result.current.chatState.current.busy = true

      await refocus(hook)

      expect(mockClient.listNewest).not.toHaveBeenCalled()
      expect(mockClient.readMessages).not.toHaveBeenCalled()
    })
  })

  describe("reads that land late", () => {
    it("drops a read that lands after startNew", async () => {
      const listing = deferred<AgentRead<string | null>>()
      mockClient.listNewest.mockReturnValueOnce(listing.promise)
      mockClient.readMessages.mockResolvedValue({ kind: "ok", value: [message("older-words")] })
      const hook = mount()

      act(() => hook.result.current.startNew())
      const startedId = ready(hook.result.current.view).id

      await act(async () => {
        listing.resolve({ kind: "ok", value: "older-thread" })
      })

      // Applying the older thread would undo New conversation.
      expect(ready(hook.result.current.view).id).toBe(startedId)
      expect(mockStore.conversationId).toBe(startedId)
      expect(mockStore.conversationIsFresh).toBe(true)
      expect(ready(hook.result.current.view).history).toEqual([])
    })

    it("drops the older of two overlapping opens", async () => {
      const first = deferred<AgentRead<string | null>>()
      mockClient.listNewest.mockReturnValueOnce(first.promise)
      mockClient.listNewest.mockResolvedValueOnce({ kind: "ok", value: "newer" })
      mockClient.readMessages.mockResolvedValue({ kind: "ok", value: [message("m2")] })
      const hook = mount()

      await refocus(hook)
      expect(ready(hook.result.current.view).id).toBe("newer")

      await act(async () => {
        first.resolve({ kind: "ok", value: "older" })
      })
      expect(ready(hook.result.current.view).id).toBe("newer")
      expect(mockStore.conversationId).toBe("newer")
    })

    it("drops a read that lands after a send", async () => {
      const hook = await mountOnThread()
      const before = ready(hook.result.current.view)
      const listing = deferred<AgentRead<string | null>>()
      mockClient.listNewest.mockReturnValueOnce(listing.promise)
      mockClient.readMessages.mockResolvedValue({ kind: "ok", value: [message("older-read")] })

      await refocus(hook)
      // The person sent while the read was on its way. Its answer predates that turn, and
      // applying it would erase the turn from the screen.
      hook.result.current.chatState.current.sentIds.add("turn-1")
      await act(async () => {
        listing.resolve({ kind: "ok", value: "listed" })
      })

      expect(hook.result.current.view).toEqual(before)
      expect([...hook.result.current.chatState.current.sentIds]).toEqual(["turn-1"])
    })

    it("drops a read that lands while a turn is busy", async () => {
      const hook = await mountOnThread()
      const before = ready(hook.result.current.view)
      const listing = deferred<AgentRead<string | null>>()
      mockClient.listNewest.mockReturnValueOnce(listing.promise)
      mockClient.readMessages.mockResolvedValue({ kind: "ok", value: [] })

      await refocus(hook)
      hook.result.current.chatState.current.busy = true
      await act(async () => {
        listing.resolve({ kind: "ok", value: "listed" })
      })

      expect(hook.result.current.view).toEqual(before)
    })

    // A sign-out unmounts the tab. A late read must not write the old session's id into the
    // store, which the next sign-in reads.
    it("drops a read that lands after the hook unmounts", async () => {
      const listing = deferred<AgentRead<string | null>>()
      mockClient.listNewest.mockReturnValueOnce(listing.promise)
      mockClient.readMessages.mockResolvedValue({ kind: "ok", value: [] })
      const hook = mount()

      hook.unmount()
      await act(async () => {
        listing.resolve({ kind: "ok", value: "listed" })
      })

      expect(mockStore.conversationId).toBeNull()
    })
  })

  describe("applying an outcome", () => {
    it("leaves the view alone on a fresh id with a failed turn", async () => {
      // A turn failed before streaming: the id stays fresh and its words are on screen.
      mockStore.startNewConversation("fresh-id")
      const hook = mount()
      await waitFor(() => expect(hook.result.current.view.phase).toBe("ready"))
      const before = ready(hook.result.current.view)
      hook.result.current.chatState.current.sentIds.add("failed-turn")

      await refocus(hook)

      // Same readAt, so the screen runs no setMessages([]) over those words.
      expect(ready(hook.result.current.view).readAt).toBe(before.readAt)
      expect(hook.result.current.view).toBe(before)
      expect(hook.result.current.chatState.current.sentIds.has("failed-turn")).toBe(true)
      expect(mockClient.listNewest).not.toHaveBeenCalled()
      expect(mockClient.readMessages).not.toHaveBeenCalled()
    })

    it("shows a fresh id from an earlier launch as ready and empty, reading nothing", async () => {
      mockStore.startNewConversation("fresh-id")
      const hook = mount()
      await waitFor(() => expect(hook.result.current.view.phase).toBe("ready"))

      expect(ready(hook.result.current.view)).toMatchObject({
        id: "fresh-id",
        history: [],
        historyFailed: false,
      })
      expect(mockStore.conversationIsFresh).toBe(true)
      expect(mockClient.listNewest).not.toHaveBeenCalled()
    })

    it("mints when nothing is listed, as fresh, and empties sentIds", async () => {
      const hook = await mountOnThread()
      // Stored, so the open gets past the sent-ids check and lists.
      hook.result.current.chatState.current.sentIds.add("m1")
      mockClient.readMessages.mockResolvedValueOnce({ kind: "ok", value: [message("m1")] })
      mockClient.listNewest.mockResolvedValueOnce({ kind: "ok", value: null })

      await refocus(hook)

      const view = ready(hook.result.current.view)
      expect(view.id).toBe("minted-1")
      expect(view.history).toEqual([])
      expect(mockStore.conversationId).toBe("minted-1")
      expect(mockStore.conversationIsFresh).toBe(true)
      // An old id checked against the new conversation would answer keep for good.
      expect(hook.result.current.chatState.current.sentIds.size).toBe(0)
    })

    it("empties sentIds when a thread is adopted, and bumps readAt", async () => {
      const hook = await mountOnThread()
      const before = ready(hook.result.current.view)
      hook.result.current.chatState.current.sentIds.add("m2")
      const stored = [message("m1"), message("m2")]
      mockClient.readMessages.mockResolvedValue({ kind: "ok", value: stored })
      mockClient.listNewest.mockResolvedValueOnce({ kind: "ok", value: "listed" })

      await refocus(hook)

      const view = ready(hook.result.current.view)
      expect(view.history).toEqual(stored)
      expect(view.readAt).not.toBe(before.readAt)
      expect(mockStore.conversationId).toBe("listed")
      expect(mockStore.conversationIsFresh).toBe(false)
      expect(hook.result.current.chatState.current.sentIds.size).toBe(0)
    })

    it("keeps everything when a sent turn is not among the stored messages", async () => {
      // A refused turn's crisis resources exist only on this screen.
      const hook = await mountOnThread()
      const before = ready(hook.result.current.view)
      hook.result.current.chatState.current.sentIds.add("crisis-turn")
      mockClient.readMessages.mockResolvedValueOnce({ kind: "ok", value: [message("m1")] })

      await refocus(hook)

      expect(hook.result.current.view).toBe(before)
      expect(hook.result.current.chatState.current.sentIds.has("crisis-turn")).toBe(true)
      expect(mockClient.listNewest).not.toHaveBeenCalled()
    })

    // threadOnScreen: a thread with an empty history still has the turn just sent on screen, so
    // a failed listing must leave it alone and not show the failed phase, which unmounts the chat.
    it("treats sent turns as a thread on screen when the history is empty", async () => {
      const hook = await mountOnThread("listed", [])
      const before = ready(hook.result.current.view)
      hook.result.current.chatState.current.sentIds.add("m1")
      mockClient.readMessages.mockResolvedValueOnce({ kind: "ok", value: [message("m1")] })
      mockClient.listNewest.mockResolvedValueOnce({ kind: "unavailable" })

      await refocus(hook)

      expect(hook.result.current.view).toBe(before)
      expect(mockStore.conversationId).toBe("listed")
    })

    // The other side of that rule: an empty thread with nothing sent has nothing to protect, so a
    // failed listing is the error row and not an empty screen that looks like a real answer.
    it("shows the failed phase over an empty thread with nothing sent", async () => {
      const hook = await mountOnThread("listed", [])
      mockClient.listNewest.mockResolvedValueOnce({ kind: "unavailable" })

      await refocus(hook)

      expect(hook.result.current.view).toEqual({ phase: "failed" })
      expect(mockStore.conversationId).toBeNull()
    })

    it("keeps a thread with history on a failed listing", async () => {
      const hook = await mountOnThread()
      const before = ready(hook.result.current.view)
      mockClient.listNewest.mockResolvedValueOnce({ kind: "unavailable" })

      await refocus(hook)

      expect(hook.result.current.view).toBe(before)
      expect(mockStore.conversationId).toBe("listed")
    })

    it("forgets the id on failed and shows the failed phase", async () => {
      mockStore.adoptConversation("known")
      mockClient.listNewest.mockResolvedValue({ kind: "unavailable" })
      const hook = mount()

      await waitFor(() => expect(hook.result.current.view.phase).toBe("failed"))

      expect(mockStore.conversationId).toBeNull()
    })

    it("adopts the id with historyFailed when the messages read fails over nothing", async () => {
      mockClient.listNewest.mockResolvedValue({ kind: "ok", value: "listed" })
      mockClient.readMessages.mockResolvedValue({ kind: "unavailable" })
      const hook = mount()

      await waitFor(() => expect(hook.result.current.view.phase).toBe("ready"))

      expect(ready(hook.result.current.view)).toMatchObject({
        id: "listed",
        history: [],
        historyFailed: true,
      })
      expect(mockStore.conversationId).toBe("listed")
    })
  })

  describe("retry", () => {
    it("goes back through loading from the failed phase, then opens", async () => {
      mockClient.listNewest.mockResolvedValueOnce({ kind: "unavailable" })
      const hook = mount()
      await waitFor(() => expect(hook.result.current.view.phase).toBe("failed"))

      const listing = deferred<AgentRead<string | null>>()
      mockClient.listNewest.mockReturnValueOnce(listing.promise)
      act(() => hook.result.current.retry())
      expect(hook.result.current.view).toEqual({ phase: "loading" })

      mockClient.readMessages.mockResolvedValueOnce({ kind: "ok", value: [message("m1")] })
      await act(async () => {
        listing.resolve({ kind: "ok", value: "listed" })
      })
      expect(ready(hook.result.current.view).id).toBe("listed")
    })

    // Over a ready view it must not pass through loading: that unmounts the chat and a turn
    // sent since the history failed would go with it.
    it("stays on the ready view while a failed history is retried", async () => {
      mockClient.listNewest.mockResolvedValueOnce({ kind: "ok", value: "listed" })
      mockClient.readMessages.mockResolvedValueOnce({ kind: "unavailable" })
      const hook = mount()
      await waitFor(() => expect(hook.result.current.view.phase).toBe("ready"))

      const listing = deferred<AgentRead<string | null>>()
      mockClient.listNewest.mockReturnValueOnce(listing.promise)
      act(() => hook.result.current.retry())
      expect(hook.result.current.view.phase).toBe("ready")

      mockClient.readMessages.mockResolvedValueOnce({ kind: "ok", value: [message("m1")] })
      await act(async () => {
        listing.resolve({ kind: "ok", value: "listed" })
      })
      expect(ready(hook.result.current.view)).toMatchObject({
        historyFailed: false,
        history: [message("m1")],
      })
    })
  })

  describe("logging", () => {
    it("logs a read that does not answer ok, with its name and kind", async () => {
      mockClient.listNewest.mockResolvedValueOnce({ kind: "ok", value: "secret-id" })
      mockClient.readMessages.mockResolvedValueOnce({ kind: "refused" })
      mockClient.listNewest.mockResolvedValueOnce({ kind: "unavailable" })
      const hook = mount()
      await waitFor(() => expect(hook.result.current.view.phase).toBe("failed"))

      expect(mockWarn).toHaveBeenCalledTimes(2)
      const attributes = mockWarn.mock.calls.map((call) => call[1])
      expect(attributes).toEqual([
        { read: "readMessages", kind: "refused" },
        { read: "listNewest", kind: "unavailable" },
      ])
      // No message ids and nothing of what was said.
      expect(JSON.stringify(mockWarn.mock.calls)).not.toContain("secret-id")
    })

    it("logs nothing for reads that answer ok", async () => {
      mockClient.listNewest.mockResolvedValueOnce({ kind: "ok", value: "listed" })
      mockClient.readMessages.mockResolvedValueOnce({ kind: "ok", value: [] })
      const hook = mount()
      await waitFor(() => expect(hook.result.current.view.phase).toBe("ready"))
      expect(mockWarn).not.toHaveBeenCalled()
    })
  })

  describe("startNew", () => {
    it("startNew archives with except and shows ready and empty", async () => {
      const hook = await mountOnThread()
      hook.result.current.chatState.current.sentIds.add("old-turn")
      const before = ready(hook.result.current.view)

      act(() => hook.result.current.startNew())

      const view = ready(hook.result.current.view)
      expect(view.id).toBe("minted-1")
      expect(view.history).toEqual([])
      expect(view.historyFailed).toBe(false)
      expect(view.readAt).not.toBe(before.readAt)
      expect(mockStore.conversationId).toBe("minted-1")
      expect(mockStore.conversationIsFresh).toBe(true)
      expect(hook.result.current.chatState.current.sentIds.size).toBe(0)
      expect(mockTrackEvent).toHaveBeenCalledWith("agent_conversation_started")
      expect(mockClient.archive).toHaveBeenCalledWith({ except: "minted-1" })
    })

    it("shows the new thread without waiting for the archive", async () => {
      const hook = await mountOnThread()
      const archive = deferred<boolean>()
      mockClient.archive.mockReturnValueOnce(archive.promise)

      act(() => hook.result.current.startNew())
      expect(ready(hook.result.current.view).id).toBe("minted-1")

      await act(async () => {
        archive.resolve(true)
      })
      expect(mockWarn).not.toHaveBeenCalled()
    })

    it("logs a warn when the archive fails and stays on the new thread", async () => {
      const hook = await mountOnThread()
      mockClient.archive.mockResolvedValueOnce(false)

      await act(async () => {
        hook.result.current.startNew()
      })

      expect(mockWarn).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(mockWarn.mock.calls)).not.toContain("minted-1")
      expect(ready(hook.result.current.view).id).toBe("minted-1")
    })
  })

  describe("reopenStale", () => {
    it("reopenStale forgets, then opens with nothing on screen", async () => {
      const hook = await mountOnThread()
      hook.result.current.chatState.current.sentIds.add("refused-turn")

      const listing = deferred<AgentRead<string | null>>()
      mockClient.listNewest.mockReturnValueOnce(listing.promise)
      act(() => hook.result.current.reopenStale())

      expect(mockStore.conversationId).toBeNull()
      expect(hook.result.current.view).toEqual({ phase: "loading" })
      expect(hook.result.current.chatState.current.sentIds.size).toBe(0)
      // With sent ids emptied and the id gone, it goes straight to the listing.
      expect(mockClient.readMessages).not.toHaveBeenCalled()

      // "Nothing on screen" is observable: a failed listing is the error row, never a keep that
      // would leave the screen on loading for good.
      await act(async () => {
        listing.resolve({ kind: "unavailable" })
      })
      expect(hook.result.current.view).toEqual({ phase: "failed" })
    })

    it("lands on the listed thread, on the mount of a new chat", async () => {
      const hook = await mountOnThread("stale-thread")
      mockClient.listNewest.mockResolvedValueOnce({ kind: "ok", value: "current-thread" })
      mockClient.readMessages.mockResolvedValueOnce({ kind: "ok", value: [message("m9")] })

      await act(async () => {
        hook.result.current.reopenStale()
      })

      expect(ready(hook.result.current.view)).toMatchObject({
        id: "current-thread",
        history: [message("m9")],
      })
      expect(mockStore.conversationId).toBe("current-thread")
    })

    // The error effect runs in the same commit as the status mirror, and reopenStale is what
    // leaves this loading. If a leftover busy flag skipped the open, it would stay loading for good.
    it("opens even if busy was left set", async () => {
      const hook = await mountOnThread()
      hook.result.current.chatState.current.busy = true
      mockClient.listNewest.mockResolvedValueOnce({ kind: "ok", value: null })

      await act(async () => {
        hook.result.current.reopenStale()
      })

      expect(hook.result.current.view.phase).toBe("ready")
      expect(hook.result.current.chatState.current.busy).toBe(false)
    })
  })
})
