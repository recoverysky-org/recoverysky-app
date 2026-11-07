import { describe, expect, it, vi } from "vitest"

import { createSupportLoader } from "./supportLoader"

// ADDED 2026-11-06 (final review I-3, M-6).
function setup(overrides: { clearPending?: boolean; hydrated?: boolean } = {}) {
  let hydrated = overrides.hydrated ?? false
  const clear = vi.fn(async () => true)
  const hydrate = vi.fn(async () => {
    hydrated = true
  })
  const loader = createSupportLoader({
    clearPending: overrides.clearPending ?? false,
    clear,
    hydrate,
    isHydrated: () => hydrated,
  })
  return { loader, clear, hydrate }
}

describe("createSupportLoader", () => {
  it("just hydrates when no fresh-install clear is pending", async () => {
    const { loader, clear, hydrate } = setup()
    await loader.load()
    expect(clear).not.toHaveBeenCalled()
    expect(hydrate).toHaveBeenCalledTimes(1)
  })

  it("does nothing when already hydrated and no clear is pending", async () => {
    const { loader, clear, hydrate } = setup({ hydrated: true })
    await loader.load()
    expect(clear).not.toHaveBeenCalled()
    expect(hydrate).not.toHaveBeenCalled()
  })

  it("clears before it hydrates on a fresh install", async () => {
    const { loader, clear, hydrate } = setup({ clearPending: true })
    await loader.load()
    expect(clear).toHaveBeenCalledTimes(1)
    expect(hydrate).toHaveBeenCalledTimes(1)
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(hydrate.mock.invocationCallOrder[0])
  })

  it("a failed clear stops without hydrating, so the previous installer's contacts stay unread", async () => {
    const { loader, clear, hydrate } = setup({ clearPending: true })
    clear.mockResolvedValueOnce(false)
    await loader.load()
    expect(hydrate).not.toHaveBeenCalled()
  })

  it("a failed clear stays pending and the next load retries it", async () => {
    const { loader, clear, hydrate } = setup({ clearPending: true })
    clear.mockResolvedValueOnce(false)
    await loader.load()
    await loader.load()
    expect(clear).toHaveBeenCalledTimes(2)
    expect(hydrate).toHaveBeenCalledTimes(1)
  })

  it("a done clear is not run again when a later load retries the read", async () => {
    let hydrated = false
    const clear = vi.fn(async () => true)
    const hydrate = vi.fn(async () => {
      if (hydrate.mock.calls.length > 1) hydrated = true
    })
    const loader = createSupportLoader({
      clearPending: true,
      clear,
      hydrate,
      isHydrated: () => hydrated,
    })
    await loader.load() // the clear works, the read does not
    await loader.load()
    expect(clear).toHaveBeenCalledTimes(1)
    expect(hydrate).toHaveBeenCalledTimes(2)
    expect(hydrated).toBe(true)
  })

  it("a rejecting clear counts as failed and load still resolves", async () => {
    const { loader, clear, hydrate } = setup({ clearPending: true })
    clear.mockRejectedValueOnce(new Error("keychain locked"))
    await expect(loader.load()).resolves.toBeUndefined()
    expect(hydrate).not.toHaveBeenCalled()
  })

  it("a rejecting hydrate still resolves, because init must not throw", async () => {
    const { loader, hydrate } = setup()
    hydrate.mockRejectedValueOnce(new Error("keychain locked"))
    await expect(loader.load()).resolves.toBeUndefined()
  })

  it("overlapping loads share one run", async () => {
    const { loader, clear, hydrate } = setup({ clearPending: true })
    await Promise.all([loader.load(), loader.load()])
    expect(clear).toHaveBeenCalledTimes(1)
    expect(hydrate).toHaveBeenCalledTimes(1)
  })

  it("can load again after an earlier run finished", async () => {
    const { loader, hydrate } = setup()
    hydrate.mockImplementationOnce(async () => {})
    await loader.load()
    await loader.load()
    expect(hydrate).toHaveBeenCalledTimes(2)
  })
})
