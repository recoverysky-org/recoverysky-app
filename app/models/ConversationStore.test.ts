// CHANGED 2026-11-06 (spec D4): moved from jest to vitest once the store lost its message members,
// and with them every runtime `@/` import, which vitest cannot resolve (CLAUDE.md "Test Runner
// Split"). No mocks: the store is plain MST now, so a `@/` import creeping back fails this whole file.
import { autorun } from "mobx"
import { getSnapshot } from "mobx-state-tree"
import { describe, expect, it } from "vitest"

import { ConversationStoreModel } from "./ConversationStore"

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

  // An installed app's MMKV snapshot has only the old props, and the model no longer declares them.
  // MST ignores what a model does not declare, so this one must load, and the next snapshot written
  // back to MMKV must not carry them: the snapshot holds the id and the flag, nothing else.
  it("reads an old snapshot and drops its old props", () => {
    const store = ConversationStoreModel.create({ lastSyncedAt: 5, messageCount: 2 } as never)
    expect(store.conversationId).toBeNull()
    expect(store.conversationIsFresh).toBe(false)
    const snapshot = getSnapshot(store)
    expect(snapshot).not.toHaveProperty("lastSyncedAt")
    expect(snapshot).not.toHaveProperty("messageCount")
    expect(Object.keys(snapshot).sort()).toEqual(["conversationId", "conversationIsFresh"])
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
