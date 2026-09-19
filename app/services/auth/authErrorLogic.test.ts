import { describe, expect, it } from "vitest"

import { classifyAuthError, isUserAbandonedAuth } from "./authErrorLogic"

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

// RS-022 (2026-09-19): a declined consent screen is the user's decision, not
// an error, and used to be logged at ERROR twice per tap.
describe("isUserAbandonedAuth", () => {
  it("is true for the SDK's USER_CANCELLED and ACCESS_DENIED types", () => {
    expect(isUserAbandonedAuth({ type: "USER_CANCELLED", message: "cancelled" })).toBe(true)
    expect(isUserAbandonedAuth({ type: "ACCESS_DENIED", message: "access denied" })).toBe(true)
  })

  it("is true for the production decline text even under a generic type", () => {
    expect(
      isUserAbandonedAuth({
        type: "UNKNOWN_ERROR",
        message: "An unexpected error occurred. CAUSE: User did not authorize the request.",
      }),
    ).toBe(true)
  })

  it("is false for real failures and non-objects", () => {
    expect(isUserAbandonedAuth({ type: "NETWORK_ERROR", message: "Network error" })).toBe(false)
    expect(isUserAbandonedAuth({ type: "BROWSER_TERMINATED", message: "closed" })).toBe(false)
    expect(isUserAbandonedAuth({ message: "Something odd" })).toBe(false)
    expect(isUserAbandonedAuth(null)).toBe(false)
    expect(isUserAbandonedAuth("string error")).toBe(false)
  })
})
