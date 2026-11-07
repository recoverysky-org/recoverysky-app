import { Linking } from "react-native"

import { openDial } from "./dial"

describe("openDial (spec D7)", () => {
  afterEach(() => {
    // Restoring does not reset the call log of a spy that is re-spied, so clear as well.
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  it("opens a tel: link built from the normalized number and reports success", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true)
    await expect(openDial("call", "+1 (555) 010-0001")).resolves.toBe(true)
    expect(open).toHaveBeenCalledWith("tel:+15550100001")
  })

  // ADDED 2026-11-06 (final review I-2): a number that cannot be dialled never reaches the OS, and
  // false is what shows the "couldn't open" toast.
  it("returns false and opens nothing for a number that cannot be dialled", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true)
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    await expect(openDial("call", "1-800-FLOWERS")).resolves.toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(JSON.stringify(warn.mock.calls)).not.toContain("FLOWERS")
  })

  it("keeps a saved pause in the call", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true)
    await openDial("call", "555-010-0001,,23")
    expect(open).toHaveBeenCalledWith("tel:5550100001,,23")
  })

  it("returns false, without throwing, when the phone app cannot open", async () => {
    jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("Unable to open sms:5550100002"))
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    await expect(openDial("text", "5550100002")).resolves.toBe(false)
    // Spec D1: the log line names the kind only, never the number or the error text.
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain("text")
    expect(logged).not.toContain("5550100002")
  })
})
