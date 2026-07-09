import { beforeEach, describe, expect, it, vi } from "vitest"

// react-native-mmkv is a native module whose real source doesn't parse under
// Vitest's esbuild transform ("Unexpected token 'typeof'"), and @/utils/logger
// can't resolve under Vitest (no @/ alias config — see [[vitest-no-path-alias]]).
// Mocking both lets Vitest skip loading their real sources entirely, without
// touching the production storage module.
vi.mock("react-native-mmkv", () => {
  class MMKV {
    private store = new Map<string, string>()
    getString(key: string) {
      return this.store.get(key)
    }
    set(key: string, value: string) {
      this.store.set(key, value)
    }
    delete(key: string) {
      this.store.delete(key)
    }
    clearAll() {
      this.store.clear()
    }
    getAllKeys() {
      return Array.from(this.store.keys())
    }
  }
  return { MMKV }
})

vi.mock("@/utils/logger", () => ({
  logger: { child: vi.fn().mockReturnValue({ debug: vi.fn() }) },
}))

import { load, loadString, save, saveString, clear, remove, storage } from "."

const VALUE_OBJECT = { x: 1 }
const VALUE_STRING = JSON.stringify(VALUE_OBJECT)

describe("MMKV Storage", () => {
  beforeEach(() => {
    storage.clearAll()
    storage.set("string", "string")
    storage.set("object", JSON.stringify(VALUE_OBJECT))
  })

  it("should be defined", () => {
    expect(storage).toBeDefined()
  })

  it("should have default keys", () => {
    expect(storage.getAllKeys()).toEqual(["string", "object"])
  })

  it("should load data", () => {
    expect(load<object>("object")).toEqual(VALUE_OBJECT)
    expect(loadString("object")).toEqual(VALUE_STRING)

    expect(load<string>("string")).toEqual("string")
    expect(loadString("string")).toEqual("string")
  })

  it("should save strings", () => {
    saveString("string", "new string")
    expect(loadString("string")).toEqual("new string")
  })

  it("should save objects", () => {
    save("object", { y: 2 })
    expect(load<object>("object")).toEqual({ y: 2 })
    save("object", { z: 3, also: true })
    expect(load<object>("object")).toEqual({ z: 3, also: true })
  })

  it("should save strings and objects", () => {
    saveString("object", "new string")
    expect(loadString("object")).toEqual("new string")
  })

  it("should remove data", () => {
    remove("object")
    expect(load<object>("object")).toBeNull()
    expect(storage.getAllKeys()).toEqual(["string"])

    remove("string")
    expect(load<string>("string")).toBeNull()
    expect(storage.getAllKeys()).toEqual([])
  })

  it("should clear all data", () => {
    expect(storage.getAllKeys()).toEqual(["string", "object"])
    clear()
    expect(storage.getAllKeys()).toEqual([])
  })
})
