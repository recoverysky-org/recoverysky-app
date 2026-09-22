import { describe, expect, it } from "vitest"

import { makeTraceContext, traceIdFromTraceparent, TRACEPARENT_HEADER } from "./traceparentLogic"

/** 24 bytes counting up from `start`, so the hex is easy to eyeball. */
function bytes(start = 1): Uint8Array {
  return Uint8Array.from({ length: 24 }, (_, i) => (start + i) & 0xff)
}

describe("makeTraceContext", () => {
  it("splits 24 random bytes into a 32-hex trace id and a 16-hex span id", () => {
    const ctx = makeTraceContext(bytes())
    expect(ctx.traceId).toBe("0102030405060708090a0b0c0d0e0f10")
    expect(ctx.spanId).toBe("1112131415161718")
  })

  it("formats a W3C version-00 traceparent with the sampled flag set", () => {
    const ctx = makeTraceContext(bytes())
    expect(ctx.traceparent).toBe("00-0102030405060708090a0b0c0d0e0f10-1112131415161718-01")
  })

  it("zero-pads bytes below 0x10 so the ids are always fixed-width", () => {
    const ctx = makeTraceContext(new Uint8Array(24).fill(0x0a))
    expect(ctx.traceId).toHaveLength(32)
    expect(ctx.spanId).toHaveLength(16)
  })

  it("never emits the all-zero ids the W3C spec says a receiver must discard", () => {
    const ctx = makeTraceContext(new Uint8Array(24))
    expect(ctx.traceId).not.toBe("0".repeat(32))
    expect(ctx.spanId).not.toBe("0".repeat(16))
  })

  it("rejects a buffer of the wrong length rather than emitting a short id", () => {
    expect(() => makeTraceContext(new Uint8Array(16))).toThrow()
  })
})

describe("traceIdFromTraceparent", () => {
  it("reads the trace id back out of a header this module produced", () => {
    const ctx = makeTraceContext(bytes(0x40))
    expect(traceIdFromTraceparent(ctx.traceparent)).toBe(ctx.traceId)
  })

  it("returns undefined for a missing or malformed header", () => {
    expect(traceIdFromTraceparent(undefined)).toBeUndefined()
    expect(traceIdFromTraceparent("")).toBeUndefined()
    expect(traceIdFromTraceparent("garbage")).toBeUndefined()
    expect(traceIdFromTraceparent("00-tooshort-1112131415161718-01")).toBeUndefined()
  })
})

describe("TRACEPARENT_HEADER", () => {
  it("is the lowercase W3C header name", () => {
    expect(TRACEPARENT_HEADER).toBe("traceparent")
  })
})
