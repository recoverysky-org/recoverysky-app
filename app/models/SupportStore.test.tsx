// Jest, not vitest: the store imports @/ modules. The storage layer is mocked; what matters
// here is the store's contract: hydrate never throws, mutations persist, and NOTHING reaches a
// snapshot (spec D4).
import { getSnapshot } from "mobx-state-tree"

import { SupportStoreModel } from "./SupportStore"

jest.mock("@/services/support/supportContactsStorage", () => ({
  SUPPORT_CONTACTS_KEY: "support_contacts_v1",
  loadSupportContacts: jest.fn(),
  saveSupportContacts: jest.fn(async () => true),
  clearSupportContacts: jest.fn(async () => undefined),
}))

const storage = jest.requireMock<{
  loadSupportContacts: jest.Mock
  saveSupportContacts: jest.Mock
}>("@/services/support/supportContactsStorage")

const julie = { role: "sponsor" as const, name: "Julie J.", number: "+15550100001" }

describe("SupportStore (spec D4)", () => {
  beforeEach(() => jest.clearAllMocks())

  it("hydrates from storage and exposes the primary contact", async () => {
    storage.loadSupportContacts.mockResolvedValue([julie])
    const store = SupportStoreModel.create({})
    await store.hydrate()
    expect(store.hydrated).toBe(true)
    expect(store.primary).toEqual(julie)
  })

  it("hydrates to an empty list when storage rejects", async () => {
    storage.loadSupportContacts.mockRejectedValue(new Error("keychain locked"))
    const store = SupportStoreModel.create({})
    await expect(store.hydrate()).resolves.toBeUndefined()
    expect(store.contacts).toEqual([])
    expect(store.hydrated).toBe(true)
  })

  it("adds, persists and reports duplicates without persisting", () => {
    const store = SupportStoreModel.create({})
    expect(store.add({ name: "Julie J.", number: "+1 555 010 0001" }, "sponsor")).toBe("ok")
    expect(storage.saveSupportContacts).toHaveBeenCalledTimes(1)
    expect(store.add({ name: "J", number: "15550100001" }, "friend")).toBe("duplicate")
    expect(storage.saveSupportContacts).toHaveBeenCalledTimes(1)
    expect(store.contacts).toHaveLength(1)
  })

  it("keeps every contact out of the snapshot", () => {
    const store = SupportStoreModel.create({})
    store.add(julie, "sponsor")
    expect(getSnapshot(store)).toEqual({})
    expect(JSON.stringify(getSnapshot(store))).not.toContain("555")
  })
})
