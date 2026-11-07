// Jest for now, a .tsx with no JSX: the store still imports `@/` modules for its old message
// members, which vitest cannot resolve (CLAUDE.md "Test Runner Split"). Task 7 removes those
// members and moves this file to vitest, so nothing below the mock may lean on a jest-only API.
import { autorun } from "mobx"
import { getSnapshot } from "mobx-state-tree"

import { ConversationStoreModel } from "./ConversationStore"

// The one mock. The real module opens the encrypted database's repositories at import.
jest.mock("@/db/repositories", () => ({ chatMessageRepo: {} }))

describe("ConversationStore: the thread the agent holds (spec D1)", () => {
  it("starts with no id and not fresh", () => {
    const store = ConversationStoreModel.create({})
    expect(store.conversationId).toBeNull()
    expect(store.conversationIsFresh).toBe(false)
  })

  // A restart must not lose the flag: without it the next open reads the listing, which answers
  // an older thread and undoes New conversation.
  it("survives a restart holding a fresh id", () => {
    const a = ConversationStoreModel.create({})
    a.startNewConversation("new")
    const b = ConversationStoreModel.create(getSnapshot(a))
    expect(b.conversationId).toBe("new")
    expect(b.conversationIsFresh).toBe(true)
  })

  // An installed app's MMKV snapshot has only the old props, and Task 7 drops those from the
  // model. MST ignores what a model does not declare, so this one must simply load.
  it("reads an old snapshot without its dropped props", () => {
    const store = ConversationStoreModel.create({ lastSyncedAt: 5, messageCount: 2 } as never)
    expect(store.conversationId).toBeNull()
    expect(store.conversationIsFresh).toBe(false)
  })

  it("adopting and marking clear the flag", () => {
    const adopted = ConversationStoreModel.create({})
    adopted.startNewConversation("minted")
    adopted.adoptConversation("listed")
    expect(adopted.conversationId).toBe("listed")
    expect(adopted.conversationIsFresh).toBe(false)

    const marked = ConversationStoreModel.create({})
    marked.startNewConversation("minted")
    marked.markConversationOnAgent()
    // The id stays: the first turn landed on it.
    expect(marked.conversationId).toBe("minted")
    expect(marked.conversationIsFresh).toBe(false)
  })

  it("adopting keeps the collapse map, so a re-read does not reopen a card", () => {
    const store = ConversationStoreModel.create({})
    store.adoptConversation("listed")
    store.collapseToolResult("call-1", "Selected: Noon Group")
    store.adoptConversation("listed")
    expect(store.getCollapseState("call-1")).toEqual({ summary: "Selected: Noon Group" })
  })

  it("starting a new conversation empties the collapse map", () => {
    const store = ConversationStoreModel.create({})
    store.collapseToolResult("call-1", "Selected: Noon Group")
    store.startNewConversation("new")
    expect(store.getCollapseState("call-1")).toBeNull()
    expect(store.collapsedToolResults.size).toBe(0)
  })

  it("forgetting clears the id, the flag and the collapse map", () => {
    const store = ConversationStoreModel.create({})
    store.startNewConversation("new")
    store.collapseToolResult("call-1", "Selected: Noon Group")
    store.forgetConversation()
    expect(store.conversationId).toBeNull()
    expect(store.conversationIsFresh).toBe(false)
    expect(store.getCollapseState("call-1")).toBeNull()
    expect(store.collapsedToolResults.size).toBe(0)
  })
})

describe("ConversationStore: collapsed tool results (spec D5)", () => {
  it("collapses by tool call id, in a new map each time", () => {
    const store = ConversationStoreModel.create({})
    const before = store.collapsedToolResults
    expect(store.getCollapseState("call-1")).toBeNull()

    store.collapseToolResult("call-1", "Selected: Noon Group")
    const afterFirst = store.collapsedToolResults
    expect(afterFirst).not.toBe(before)
    expect(store.getCollapseState("call-1")).toEqual({ summary: "Selected: Noon Group" })

    store.collapseToolResult("call-2", "Selected: Evening Group")
    expect(store.collapsedToolResults).not.toBe(afterFirst)
    // The earlier entry rides over into the new map.
    expect(store.getCollapseState("call-1")).toEqual({ summary: "Selected: Noon Group" })
    expect(store.getCollapseState("call-2")).toEqual({ summary: "Selected: Evening Group" })
  })

  // What the new map is for: `.volatile` holds a reference, so a map written in place would pass
  // every test above and the card still would not redraw.
  it("tells an observer when a card collapses", () => {
    const store = ConversationStoreModel.create({})
    const seen: Array<string | undefined> = []
    const stop = autorun(() => {
      seen.push(store.getCollapseState("call-1")?.summary)
    })
    store.collapseToolResult("call-1", "Selected: Noon Group")
    stop()
    expect(seen).toEqual([undefined, "Selected: Noon Group"])
  })

  it("keeps the collapse map and its summaries out of the snapshot", () => {
    const store = ConversationStoreModel.create({})
    store.collapseToolResult("call-1", "Selected: Noon Group")
    expect(JSON.stringify(getSnapshot(store))).not.toContain("Noon Group")
    expect(getSnapshot(store)).not.toHaveProperty("collapsedToolResults")
  })
})
