// Jest, not vitest: the storage module imports @/ modules.
// ADDED 2026-11-06 (final review I-3, M-6): "could not read" and "nothing there" are different
// answers, and a clear reports whether it worked. The store and the fresh-install clear act on both.
import { clearSupportContacts, loadSupportContacts } from "./supportContactsStorage"

const mockGetItem = jest.fn()
const mockDeleteItem = jest.fn()
jest.mock("@/services/auth/secureStorage", () => ({
  getItemAsync: (...args: unknown[]) => mockGetItem(...args),
  setItemAsync: jest.fn(),
  deleteItemAsync: (...args: unknown[]) => mockDeleteItem(...args),
}))

const julie = { role: "sponsor", name: "Julie J.", number: "+15550100001" }

describe("supportContactsStorage", () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    mockGetItem.mockReset()
    mockDeleteItem.mockReset()
    mockDeleteItem.mockResolvedValue(undefined)
    warn = jest.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  describe("loadSupportContacts", () => {
    it("returns the stored contacts", async () => {
      mockGetItem.mockResolvedValue(JSON.stringify([julie]))
      await expect(loadSupportContacts()).resolves.toEqual([julie])
    })
    it("is an empty list for a missing item: nothing is stored", async () => {
      mockGetItem.mockResolvedValue(null)
      await expect(loadSupportContacts()).resolves.toEqual([])
    })
    it("is an empty list for corrupt JSON: nothing recoverable is stored", async () => {
      mockGetItem.mockResolvedValue("{not json")
      await expect(loadSupportContacts()).resolves.toEqual([])
    })
    it("is null when the read throws, and logs no message", async () => {
      mockGetItem.mockRejectedValue(new Error("+15550100001 locked"))
      await expect(loadSupportContacts()).resolves.toBeNull()
      expect(JSON.stringify(warn.mock.calls)).not.toContain("5550100001")
    })
  })

  describe("clearSupportContacts", () => {
    it("is true once the item is gone", async () => {
      mockGetItem.mockResolvedValue(null)
      await expect(clearSupportContacts()).resolves.toBe(true)
      expect(mockDeleteItem).toHaveBeenCalledTimes(1)
    })
    it("is false, without throwing, when the delete throws", async () => {
      mockDeleteItem.mockRejectedValue(new Error("keychain locked"))
      await expect(clearSupportContacts()).resolves.toBe(false)
    })
    // expo-secure-store's iOS delete ignores SecItemDelete's status, so it resolves even when it
    // removed nothing. Only reading back can tell.
    it("is false when the item is still there after a delete that resolved", async () => {
      mockGetItem.mockResolvedValue(JSON.stringify([julie]))
      await expect(clearSupportContacts()).resolves.toBe(false)
    })
    it("is false when reading back throws", async () => {
      mockGetItem.mockRejectedValue(new Error("keychain locked"))
      await expect(clearSupportContacts()).resolves.toBe(false)
    })
  })
})
