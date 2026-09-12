import { describe, expect, it } from "vitest"

import { classifyAuthError } from "./authErrorLogic"

describe("classifyAuthError", () => {
  it("maps the SDK's BROWSER_TERMINATED type", () => {
    expect(
      classifyAuthError({
        type: "BROWSER_TERMINATED",
        message: "The browser window was closed by a new instance of the application",
      }),
    ).toBe("browserTerminated")
  })

  it("maps the SDK's NETWORK_ERROR type", () => {
    expect(classifyAuthError({ type: "NETWORK_ERROR", message: "Network error" })).toBe(
      "networkError",
    )
  })

  it("falls back to the message when the type is missing or unknown", () => {
    // Auth0.Android's NetworkErrorException surfaces as a plain message on some paths.
    expect(classifyAuthError({ message: "Failed to execute the network request." })).toBe(
      "networkError",
    )
    expect(classifyAuthError({ type: "UNKNOWN_ERROR", message: "Network error" })).toBe(
      "networkError",
    )
  })

  it("returns null for everything else so the raw SDK message still shows", () => {
    expect(classifyAuthError({ type: "ACCESS_DENIED", message: "access denied" })).toBeNull()
    expect(classifyAuthError({ message: "Something odd" })).toBeNull()
    expect(classifyAuthError(null)).toBeNull()
    expect(classifyAuthError("string error")).toBeNull()
  })

  it("never classifies a user cancel — callers filter that first, but be safe", () => {
    expect(classifyAuthError({ type: "USER_CANCELLED", message: "cancelled" })).toBeNull()
  })
})
