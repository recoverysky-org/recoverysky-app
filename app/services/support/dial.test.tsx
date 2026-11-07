import { Linking } from "react-native"

import { openDial } from "./dial"

describe("openDial (spec D7)", () => {
  afterEach(() => jest.restoreAllMocks())

  it("opens a tel: link built from the normalized number and reports success", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true)
    await expect(openDial("call", "+1 (555) 010-0001")).resolves.toBe(true)
    expect(open).toHaveBeenCalledWith("tel:+15550100001")
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
