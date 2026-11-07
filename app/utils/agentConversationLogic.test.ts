import type { UIMessage } from "ai"
import { describe, expect, it, vi } from "vitest"

import { decideChatWipe, openConversation, type OpenDeps } from "./agentConversationLogic"
import type { AgentRead } from "../services/api/agentConversationsLogic"

const message = (id: string, role: UIMessage["role"] = "user"): UIMessage => ({
  id,
  role,
  parts: [],
})

const ok = <T>(value: T): AgentRead<T> => ({ kind: "ok", value })
const refused = { kind: "refused" } as const
const unavailable = { kind: "unavailable" } as const

/**
 * Deps that answer from a script: `listings` in order, `reads` in order. A call
 * past the end of a script throws, so a flow that asks more than the test
 * expected fails loudly instead of reading `undefined`.
 */
function setup(
  script: { listings?: AgentRead<string | null>[]; reads?: AgentRead<UIMessage[]>[] } = {},
) {
  const listings = [...(script.listings ?? [])]
  const reads = [...(script.reads ?? [])]
  const take = <T>(queue: T[], name: string): T => {
    if (queue.length === 0) throw new Error(`unexpected call to ${name}`)
    return queue.shift() as T
  }
  const deps = {
    listNewest: vi.fn<OpenDeps["listNewest"]>(async () => take(listings, "listNewest")),
    readMessages: vi.fn<OpenDeps["readMessages"]>(async () => take(reads, "readMessages")),
    mintId: vi.fn<OpenDeps["mintId"]>(() => "minted"),
  }
  return deps
}

const nothingOnScreen = {
  conversationId: null,
  isFresh: false,
  sentIds: new Set<string>(),
  threadOnScreen: false,
}
const overAThread = {
  conversationId: "c-1",
  isFresh: false,
  sentIds: new Set<string>(),
  threadOnScreen: true,
}

describe("openConversation", () => {
  describe("a fresh id", () => {
    it("makes no call while the id is fresh", async () => {
      const deps = setup()
      const out = await openConversation(
        { conversationId: "new", isFresh: true, sentIds: new Set(), threadOnScreen: false },
        deps,
      )
      expect(out).toEqual({ kind: "fresh", id: "new", minted: false })
      expect(deps.listNewest).not.toHaveBeenCalled()
      expect(deps.readMessages).not.toHaveBeenCalled()
    })

    it("makes no call for a fresh id whose turn failed before streaming", async () => {
      // The id is unknown to the agent, so the stored check could only earn a 404.
      const deps = setup()
      const out = await openConversation(
        { conversationId: "new", isFresh: true, sentIds: new Set(["u-1"]), threadOnScreen: true },
        deps,
      )
      expect(out).toEqual({ kind: "fresh", id: "new", minted: false })
      expect(deps.listNewest).not.toHaveBeenCalled()
      expect(deps.readMessages).not.toHaveBeenCalled()
    })

    it("lists when the flag is set with no id to go with it", async () => {
      const deps = setup({ listings: [ok(null)] })
      const out = await openConversation({ ...nothingOnScreen, isFresh: true }, deps)
      expect(out).toEqual({ kind: "fresh", id: "minted", minted: true })
      expect(deps.listNewest).toHaveBeenCalledTimes(1)
    })
  })

  describe("the listing and the read", () => {
    it("adopts the listed conversation and reads it", async () => {
      const history = [message("u-1"), message("a-1", "assistant")]
      const deps = setup({ listings: [ok("c-1")], reads: [ok(history)] })
      const out = await openConversation(nothingOnScreen, deps)
      expect(out).toEqual({ kind: "thread", id: "c-1", history, historyFailed: false })
      expect(deps.readMessages).toHaveBeenCalledWith("c-1")
      expect(deps.mintId).not.toHaveBeenCalled()
    })

    it("moves to the listed conversation over the one on screen", async () => {
      // How New conversation on another device arrives here.
      const history = [message("u-2")]
      const deps = setup({ listings: [ok("c-2")], reads: [ok(history)] })
      const out = await openConversation(overAThread, deps)
      expect(out).toEqual({ kind: "thread", id: "c-2", history, historyFailed: false })
      expect(deps.readMessages).toHaveBeenCalledTimes(1)
      expect(deps.readMessages).toHaveBeenCalledWith("c-2")
    })

    it("mints a fresh id when none is listed", async () => {
      const deps = setup({ listings: [ok(null)] })
      const out = await openConversation(nothingOnScreen, deps)
      expect(out).toEqual({ kind: "fresh", id: "minted", minted: true })
      expect(deps.readMessages).not.toHaveBeenCalled()
    })

    it("mints over a thread when the agent answers that none is listed", async () => {
      // A true answer, not a failed read: the thread was archived on another device.
      const deps = setup({ listings: [ok(null)] })
      const out = await openConversation(overAThread, deps)
      expect(out).toEqual({ kind: "fresh", id: "minted", minted: true })
    })
  })

  describe("a failed listing", () => {
    it.each([
      ["unavailable", unavailable],
      ["refused", refused],
    ])("waits rather than mints when the listing is %s", async (_name, answer) => {
      const deps = setup({ listings: [answer] })
      const out = await openConversation(nothingOnScreen, deps)
      expect(out).toEqual({ kind: "failed" })
      expect(deps.mintId).not.toHaveBeenCalled()
      expect(deps.listNewest).toHaveBeenCalledTimes(1)
    })

    it("keeps the thread when the listing fails over one", async () => {
      const deps = setup({ listings: [unavailable] })
      const out = await openConversation(overAThread, deps)
      expect(out).toEqual({ kind: "keep" })
      expect(deps.mintId).not.toHaveBeenCalled()
    })
  })

  describe("a read that cannot answer", () => {
    it("keeps the thread when the read fails over one", async () => {
      const deps = setup({ listings: [ok("c-1")], reads: [unavailable] })
      const out = await openConversation(overAThread, deps)
      expect(out).toEqual({ kind: "keep" })
      expect(deps.listNewest).toHaveBeenCalledTimes(1)
    })

    it("shows the error with the id when the read fails over nothing", async () => {
      const deps = setup({ listings: [ok("c-1")], reads: [unavailable] })
      const out = await openConversation(nothingOnScreen, deps)
      expect(out).toEqual({ kind: "thread", id: "c-1", history: [], historyFailed: true })
      expect(deps.listNewest).toHaveBeenCalledTimes(1)
    })
  })

  describe("a refused read", () => {
    it("lists once more when the read is refused", async () => {
      const history = [message("u-2")]
      const deps = setup({ listings: [ok("gone"), ok("c-2")], reads: [refused, ok(history)] })
      const out = await openConversation(nothingOnScreen, deps)
      expect(out).toEqual({ kind: "thread", id: "c-2", history, historyFailed: false })
      expect(deps.listNewest).toHaveBeenCalledTimes(2)
      expect(deps.readMessages.mock.calls.map(([id]) => id)).toEqual(["gone", "c-2"])
    })

    it("mints when the second listing has nothing left", async () => {
      const deps = setup({ listings: [ok("gone"), ok(null)], reads: [refused] })
      const out = await openConversation(nothingOnScreen, deps)
      expect(out).toEqual({ kind: "fresh", id: "minted", minted: true })
    })

    it("fails on a second refusal", async () => {
      const deps = setup({ listings: [ok("a"), ok("b")], reads: [refused, refused] })
      const out = await openConversation(nothingOnScreen, deps)
      expect(out).toEqual({ kind: "failed" })
      expect(deps.listNewest).toHaveBeenCalledTimes(2)
      expect(deps.readMessages).toHaveBeenCalledTimes(2)
      expect(deps.mintId).not.toHaveBeenCalled()
    })

    it("keeps the thread on a second refusal over one", async () => {
      // A re-read never blanks the screen. A send from here earns the stale path.
      const deps = setup({ listings: [ok("a"), ok("b")], reads: [refused, refused] })
      const out = await openConversation(overAThread, deps)
      expect(out).toEqual({ kind: "keep" })
      expect(deps.listNewest).toHaveBeenCalledTimes(2)
    })

    it("treats the second listing failing like any failed listing", async () => {
      const blank = setup({ listings: [ok("gone"), unavailable], reads: [refused] })
      expect(await openConversation(nothingOnScreen, blank)).toEqual({ kind: "failed" })

      const shown = setup({ listings: [ok("gone"), unavailable], reads: [refused] })
      expect(await openConversation(overAThread, shown)).toEqual({ kind: "keep" })
    })

    it("treats the second read failing like any failed read", async () => {
      const blank = setup({ listings: [ok("a"), ok("b")], reads: [refused, unavailable] })
      expect(await openConversation(nothingOnScreen, blank)).toEqual({
        kind: "thread",
        id: "b",
        history: [],
        historyFailed: true,
      })

      const shown = setup({ listings: [ok("a"), ok("b")], reads: [refused, unavailable] })
      expect(await openConversation(overAThread, shown)).toEqual({ kind: "keep" })
    })
  })

  describe("turns that exist only on this screen", () => {
    const sent = (...ids: string[]) => ({ ...overAThread, sentIds: new Set(ids) })

    it("keeps the screen when a sent id is not stored", async () => {
      // A refused turn at crisis level: the agent stored nothing, and the crisis
      // resources it streamed are on this screen alone. A listing here would answer
      // the older thread and erase them.
      const deps = setup({ reads: [ok([message("u-1"), message("a-1", "assistant")])] })
      const out = await openConversation(sent("u-9"), deps)
      expect(out).toEqual({ kind: "keep" })
      expect(deps.readMessages).toHaveBeenCalledWith("c-1")
      expect(deps.listNewest).not.toHaveBeenCalled()
    })

    it("keeps the screen when only some of the sent ids are stored", async () => {
      const deps = setup({ reads: [ok([message("u-1")])] })
      const out = await openConversation(sent("u-1", "u-9"), deps)
      expect(out).toEqual({ kind: "keep" })
      expect(deps.listNewest).not.toHaveBeenCalled()
    })

    it.each([
      ["unavailable", unavailable],
      ["refused", refused],
    ])("keeps the screen when that check is %s", async (_name, answer) => {
      const deps = setup({ reads: [answer] })
      const out = await openConversation(sent("u-1"), deps)
      expect(out).toEqual({ kind: "keep" })
      expect(deps.readMessages).toHaveBeenCalledTimes(1)
      expect(deps.listNewest).not.toHaveBeenCalled()
    })

    it("continues when every sent id is stored", async () => {
      const history = [message("u-5")]
      const deps = setup({
        listings: [ok("c-2")],
        reads: [ok([message("u-1"), message("u-2")]), ok(history)],
      })
      const out = await openConversation(sent("u-1", "u-2"), deps)
      expect(out).toEqual({ kind: "thread", id: "c-2", history, historyFailed: false })
      // The check reads the mounted conversation, and the listing then decides.
      expect(deps.readMessages.mock.calls.map(([id]) => id)).toEqual(["c-1", "c-2"])
      expect(deps.listNewest).toHaveBeenCalledTimes(1)
    })

    it("keeps the screen when the check passes and the listing then fails", async () => {
      const deps = setup({ listings: [unavailable], reads: [ok([message("u-1")])] })
      const out = await openConversation(sent("u-1"), deps)
      expect(out).toEqual({ kind: "keep" })
      expect(deps.mintId).not.toHaveBeenCalled()
    })

    it("mints when the check passes and the agent then lists nothing", async () => {
      // How an archive on another device arrives once every turn here is stored.
      const deps = setup({ listings: [ok(null)], reads: [ok([message("u-1")])] })
      const out = await openConversation(sent("u-1"), deps)
      expect(out).toEqual({ kind: "fresh", id: "minted", minted: true })
    })

    it("has nothing to check when there is no id", async () => {
      const deps = setup({ listings: [ok(null)] })
      const out = await openConversation({ ...nothingOnScreen, sentIds: new Set(["u-1"]) }, deps)
      expect(out).toEqual({ kind: "fresh", id: "minted", minted: true })
      expect(deps.readMessages).not.toHaveBeenCalled()
    })
  })
})

describe("decideChatWipe", () => {
  it("wipes once where the build has an agent URL", () => {
    expect(decideChatWipe({ done: false, agentUrlEnv: "http://localhost:3333" })).toBe(true)
  })

  it.each([[undefined], [""], ["not a url"]])(
    "never wipes in a build with no agent URL (%s)",
    (agentUrlEnv) => {
      // The production install with the tab hidden: those rows are the person's
      // only readable copy of chats from before the tab was hidden (spec D4).
      expect(decideChatWipe({ done: false, agentUrlEnv })).toBe(false)
    },
  )

  it("does not wipe twice", () => {
    expect(decideChatWipe({ done: true, agentUrlEnv: "http://localhost:3333" })).toBe(false)
  })
})
