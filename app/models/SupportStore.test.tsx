// Jest, not vitest: the store imports @/ modules. The storage layer is mocked; what matters
// here is the store's contract: hydrate never throws, mutations persist, and NOTHING reaches a
// snapshot (spec D4).
// CHANGED 2026-11-06 (final review I-3): stores under test hydrate first, because an un-hydrated
// store now refuses every edit: "could not read" is not "empty".
import { getSnapshot } from "mobx-state-tree"

import { SupportStoreModel } from "./SupportStore"

jest.mock("@/services/support/supportContactsStorage", () => ({
  SUPPORT_CONTACTS_KEY: "support_contacts_v1",
  loadSupportContacts: jest.fn(),
  saveSupportContacts: jest.fn(async () => true),
  clearSupportContacts: jest.fn(async () => true),
}))

const storage = jest.requireMock<{
  loadSupportContacts: jest.Mock
  saveSupportContacts: jest.Mock
  clearSupportContacts: jest.Mock
}>("@/services/support/supportContactsStorage")

const julie = { role: "sponsor" as const, name: "Julie J.", number: "+15550100001" }

/** A store whose load succeeded, as every store past a healthy cold start is. */
async function hydratedStore(contacts: (typeof julie)[] = []) {
  storage.loadSupportContacts.mockResolvedValueOnce(contacts)
  const store = SupportStoreModel.create({})
  await store.hydrate()
  return store
}

/** A promise the test settles by hand, to hold a keychain call mid-flight. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

/** Lets the save chain's queued continuations run. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe("SupportStore (spec D4)", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    storage.loadSupportContacts.mockReset()
    // A store that never ran a successful load has nothing to read here.
    storage.loadSupportContacts.mockResolvedValue([])
  })

  it("hydrates from storage and exposes the primary contact", async () => {
    storage.loadSupportContacts.mockResolvedValue([julie])
    const store = SupportStoreModel.create({})
    await store.hydrate()
    expect(store.hydrated).toBe(true)
    expect(store.primary).toEqual(julie)
  })

  // ADDED 2026-11-06 (final review I-3): a locked keychain used to hydrate as "no contacts", and
  // the next edit overwrote the real list for good.
  describe("a failed read", () => {
    it("leaves hydrated false and the contacts untouched when the load reports null", async () => {
      storage.loadSupportContacts.mockResolvedValueOnce(null)
      const store = SupportStoreModel.create({})
      await expect(store.hydrate()).resolves.toBeUndefined()
      expect(store.hydrated).toBe(false)
      expect(store.contacts).toEqual([])
    })

    it("treats a rejecting load the same way and does not reject", async () => {
      storage.loadSupportContacts.mockRejectedValueOnce(new Error("keychain locked"))
      const store = SupportStoreModel.create({})
      await expect(store.hydrate()).resolves.toBeUndefined()
      expect(store.hydrated).toBe(false)
    })

    it("a later good load fills the store", async () => {
      storage.loadSupportContacts.mockResolvedValueOnce(null)
      const store = SupportStoreModel.create({})
      await store.hydrate()
      storage.loadSupportContacts.mockResolvedValueOnce([julie])
      await store.hydrate()
      expect(store.hydrated).toBe(true)
      expect(store.primary).toEqual(julie)
    })

    it("a good empty load hydrates: an empty keychain is a real answer", async () => {
      const store = await hydratedStore([])
      expect(store.hydrated).toBe(true)
      expect(store.contacts).toEqual([])
    })

    it("add, remove, moveUp and setRole change nothing and save nothing", async () => {
      storage.loadSupportContacts.mockResolvedValueOnce(null)
      const store = SupportStoreModel.create({})
      await store.hydrate()
      expect(store.add({ name: "Julie J.", number: "+15550100001" }, "sponsor")).toBe("invalid")
      store.remove(0)
      store.moveUp(1)
      store.setRole(0, "friend")
      await flush()
      expect(store.contacts).toEqual([])
      expect(storage.saveSupportContacts).not.toHaveBeenCalled()
    })
  })

  describe("hydrate overlap", () => {
    it("a second call while one runs starts no second read", async () => {
      const read = deferred<(typeof julie)[]>()
      storage.loadSupportContacts.mockReturnValueOnce(read.promise)
      const store = SupportStoreModel.create({})
      const first = store.hydrate()
      await flush()
      await store.hydrate()
      expect(storage.loadSupportContacts).toHaveBeenCalledTimes(1)
      read.resolve([julie])
      await first
      expect(store.primary).toEqual(julie)
    })

    it("does not read again once hydrated", async () => {
      const store = await hydratedStore([julie])
      await store.hydrate()
      expect(storage.loadSupportContacts).toHaveBeenCalledTimes(1)
    })
  })

  // ADDED 2026-11-06 (final review M-7): one chain, so the keychain ends on the newest list.
  describe("the save chain", () => {
    it("saves apply in order, one at a time", async () => {
      const store = await hydratedStore()
      const firstSave = deferred<boolean>()
      storage.saveSupportContacts.mockReturnValueOnce(firstSave.promise)
      store.add({ name: "Julie J.", number: "+15550100001" }, "sponsor")
      store.add({ name: "Marco", number: "5550100002" }, "support")
      await flush()
      // The second save has not started while the first is unsettled.
      expect(storage.saveSupportContacts).toHaveBeenCalledTimes(1)
      expect(storage.saveSupportContacts.mock.calls[0][0]).toHaveLength(1)
      firstSave.resolve(true)
      await flush()
      expect(storage.saveSupportContacts).toHaveBeenCalledTimes(2)
      expect(storage.saveSupportContacts.mock.calls[1][0]).toHaveLength(2)
    })

    it("a rejected save does not stop the next one", async () => {
      const store = await hydratedStore()
      storage.saveSupportContacts.mockRejectedValueOnce(new Error("keychain locked"))
      store.add({ name: "Julie J.", number: "+15550100001" }, "sponsor")
      store.add({ name: "Marco", number: "5550100002" }, "support")
      await flush()
      expect(storage.saveSupportContacts).toHaveBeenCalledTimes(2)
    })

    it("a save in flight when clear() runs cannot land after the delete", async () => {
      const store = await hydratedStore()
      const save = deferred<boolean>()
      const order: string[] = []
      storage.saveSupportContacts.mockImplementationOnce(async () => {
        await save.promise
        order.push("save")
        return true
      })
      storage.clearSupportContacts.mockImplementationOnce(async () => {
        order.push("delete")
        return true
      })
      store.add({ name: "Julie J.", number: "+15550100001" }, "sponsor")
      const cleared = store.clear()
      expect(store.contacts).toEqual([]) // the list empties first, synchronously
      await flush()
      expect(storage.clearSupportContacts).not.toHaveBeenCalled()
      save.resolve(true)
      await cleared
      expect(order).toEqual(["save", "delete"])
      expect(store.contacts).toEqual([])
    })
  })

  it("adds, persists and reports duplicates without persisting", async () => {
    const store = await hydratedStore()
    expect(store.add({ name: "Julie J.", number: "+1 555 010 0001" }, "sponsor")).toBe("ok")
    await flush()
    expect(storage.saveSupportContacts).toHaveBeenCalledTimes(1)
    expect(store.add({ name: "J", number: "15550100001" }, "friend")).toBe("duplicate")
    await flush()
    expect(storage.saveSupportContacts).toHaveBeenCalledTimes(1)
    expect(store.contacts).toHaveLength(1)
  })

  it("keeps every contact out of the snapshot", async () => {
    const store = await hydratedStore()
    store.add(julie, "sponsor")
    expect(getSnapshot(store)).toEqual({})
    expect(JSON.stringify(getSnapshot(store))).not.toContain("555")
  })

  // ADDED 2026-11-06 (Task 8 ruling): the overlay Reset reopens the database in place, with no
  // reload, so the in-memory list must empty too or a keychain-only clear would let the next
  // edit write the previous owner's sponsor straight back.
  describe("clear()", () => {
    it("empties the contacts and clears the keychain", async () => {
      const store = await hydratedStore()
      store.add({ name: "Julie J.", number: "+15550100001" }, "sponsor")
      await store.clear()
      expect(store.contacts).toEqual([])
      expect(storage.clearSupportContacts).toHaveBeenCalledTimes(1)
    })

    it("still resolves, and the list is already empty, when storage rejects", async () => {
      storage.clearSupportContacts.mockRejectedValueOnce(new Error("keychain locked"))
      const store = await hydratedStore()
      store.add({ name: "Julie J.", number: "+15550100001" }, "sponsor")
      await expect(store.clear()).resolves.toBeUndefined()
      expect(store.contacts).toEqual([])
    })

    // ADDED 2026-11-06 (final review I-3): a confirmed delete is a known answer (empty), and
    // anything less stays unknown.
    it("marks an un-hydrated store hydrated only when the delete reports success", async () => {
      storage.loadSupportContacts.mockResolvedValueOnce(null)
      const failed = SupportStoreModel.create({})
      await failed.hydrate()
      storage.clearSupportContacts.mockResolvedValueOnce(false)
      await failed.clear()
      expect(failed.hydrated).toBe(false)

      const cleared = SupportStoreModel.create({})
      await cleared.clear()
      expect(cleared.hydrated).toBe(true)
      expect(cleared.contacts).toEqual([])
    })

    it("a read in flight when clear() runs cannot bring the old list back", async () => {
      const read = deferred<(typeof julie)[]>()
      storage.loadSupportContacts.mockReturnValueOnce(read.promise)
      const store = SupportStoreModel.create({})
      const hydrating = store.hydrate()
      await flush()
      const cleared = store.clear()
      read.resolve([julie])
      await Promise.all([hydrating, cleared])
      expect(store.contacts).toEqual([])
      expect(store.hydrated).toBe(true)
    })

    it("a later add persists only the new contact", async () => {
      const store = await hydratedStore()
      store.add({ name: "Julie J.", number: "+15550100001" }, "sponsor")
      await store.clear()
      storage.saveSupportContacts.mockClear()
      store.add({ name: "Sam", number: "+15550100002" }, "friend")
      await flush()
      expect(storage.saveSupportContacts).toHaveBeenCalledTimes(1)
      const saved = storage.saveSupportContacts.mock.calls[0][0]
      expect(saved).toHaveLength(1)
      expect(saved[0].number).toBe("+15550100002")
    })
  })
})
