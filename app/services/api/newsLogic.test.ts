import { describe, expect, it } from "vitest"

import { classifyNewsPayload } from "./newsLogic"

describe("classifyNewsPayload", () => {
  it("returns the news when a 200 carries a title and body", () => {
    expect(classifyNewsPayload(200, { id: "n1", title: "Hi", body: "There" })).toEqual({
      kind: "ok",
      title: "Hi",
      body: "There",
    })
  })

  it("treats a 204 as no news, whatever axios put in data", () => {
    expect(classifyNewsPayload(204, "")).toEqual({ kind: "no-content" })
    expect(classifyNewsPayload(204, null)).toEqual({ kind: "no-content" })
    expect(classifyNewsPayload(204, undefined)).toEqual({ kind: "no-content" })
  })

  it("treats an empty 200 payload as no news, not bad data", () => {
    expect(classifyNewsPayload(200, "")).toEqual({ kind: "no-content" })
    expect(classifyNewsPayload(200, null)).toEqual({ kind: "no-content" })
    expect(classifyNewsPayload(200, {})).toEqual({ kind: "no-content" })
  })

  it("flags a non-empty payload missing title or body as bad data", () => {
    expect(classifyNewsPayload(200, { id: "n1", title: "Hi" })).toEqual({ kind: "bad-data" })
    expect(classifyNewsPayload(200, { id: "n1", title: 5, body: "x" })).toEqual({
      kind: "bad-data",
    })
    expect(classifyNewsPayload(200, "not json")).toEqual({ kind: "bad-data" })
  })

  it("flags a 200 whose title or body is blank as no news", () => {
    // The server never sends this shape, but an item with nothing to show is
    // still nothing to show — HomeScreen requires both strings to be non-empty.
    expect(classifyNewsPayload(200, { id: "n1", title: "", body: "" })).toEqual({
      kind: "no-content",
    })
  })
})
