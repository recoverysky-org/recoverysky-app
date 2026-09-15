import { describe, expect, it } from "vitest"

import {
  classifyExchangeFailure,
  classifyNativeFailure,
  decideColdStartStep,
  EXCHANGE_RETRY_DELAYS_MS,
  pickAttestationAlert,
  shouldDropRejectedJwt,
  TEMPORARY_API_KINDS,
} from "./deviceTokenLogic"

const SKEW = 5 * 60 * 1000
const NOW = 1_700_000_000_000

describe("decideColdStartStep", () => {
  it("uses the stored JWT when it has more than the skew left", () => {
    expect(
      decideColdStartStep({
        platform: "ios",
        storedJwtExpiresAt: NOW + SKEW + 1,
        hasStoredKeyId: true,
        now: NOW,
        skewMs: SKEW,
      }),
    ).toBe("use-stored-jwt")
  })

  it("treats a JWT inside the skew window as expired", () => {
    expect(
      decideColdStartStep({
        platform: "ios",
        storedJwtExpiresAt: NOW + SKEW,
        hasStoredKeyId: true,
        now: NOW,
        skewMs: SKEW,
      }),
    ).toBe("assert")
  })

  it("asserts on iOS when a key id is stored", () => {
    expect(
      decideColdStartStep({
        platform: "ios",
        storedJwtExpiresAt: null,
        hasStoredKeyId: true,
        now: NOW,
        skewMs: SKEW,
      }),
    ).toBe("assert")
  })

  it("attests on iOS without a key id", () => {
    expect(
      decideColdStartStep({
        platform: "ios",
        storedJwtExpiresAt: null,
        hasStoredKeyId: false,
        now: NOW,
        skewMs: SKEW,
      }),
    ).toBe("attest")
  })

  it("android never asserts, even with a stray key id", () => {
    expect(
      decideColdStartStep({
        platform: "android",
        storedJwtExpiresAt: null,
        hasStoredKeyId: true,
        now: NOW,
        skewMs: SKEW,
      }),
    ).toBe("attest")
  })

  it("android uses a fresh stored JWT too", () => {
    expect(
      decideColdStartStep({
        platform: "android",
        storedJwtExpiresAt: NOW + 86_400_000,
        hasStoredKeyId: false,
        now: NOW,
        skewMs: SKEW,
      }),
    ).toBe("use-stored-jwt")
  })
})

describe("classifyExchangeFailure", () => {
  it("retries temporary kinds on every exchange", () => {
    for (const kind of TEMPORARY_API_KINDS) {
      expect(classifyExchangeFailure({ exchange: "challenge", kind })).toBe("retry")
      expect(classifyExchangeFailure({ exchange: "assert", kind })).toBe("retry")
      expect(classifyExchangeFailure({ exchange: "attest", kind })).toBe("retry")
    }
  })

  it("a rejected assert falls back to a full attestation", () => {
    expect(classifyExchangeFailure({ exchange: "assert", kind: "forbidden" })).toBe(
      "fallback-to-attest",
    )
    expect(classifyExchangeFailure({ exchange: "assert", kind: "rejected" })).toBe(
      "fallback-to-attest",
    )
    expect(classifyExchangeFailure({ exchange: "assert", kind: "bad-data" })).toBe(
      "fallback-to-attest",
    )
  })

  it("only a 401/403 on a full attestation blocks", () => {
    expect(classifyExchangeFailure({ exchange: "attest", kind: "forbidden" })).toBe("blocked")
    expect(classifyExchangeFailure({ exchange: "attest", kind: "unauthorized" })).toBe("blocked")
  })

  // CHANGED 2026-09-09 (final review): `rejected` covers 400 and 429 in
  // apiProblem.ts — a rate-limiter hit on the IP-limited attest routes, or a
  // `bad_nonce`. Neither is a verdict about the device, so neither may show
  // the "Verification Rejected" alert.
  it("every other non-temporary attest failure degrades", () => {
    expect(classifyExchangeFailure({ exchange: "attest", kind: "rejected" })).toBe("degrade")
    expect(classifyExchangeFailure({ exchange: "attest", kind: "not-found" })).toBe("degrade")
  })

  it("a non-temporary challenge failure degrades rather than blocks", () => {
    expect(classifyExchangeFailure({ exchange: "challenge", kind: "not-found" })).toBe("degrade")
    expect(classifyExchangeFailure({ exchange: "challenge", kind: "bad-data" })).toBe("degrade")
  })

  it("malformed attest responses degrade, not block", () => {
    expect(classifyExchangeFailure({ exchange: "attest", kind: "bad-data" })).toBe("degrade")
  })
})

describe("classifyNativeFailure", () => {
  it("any native failure while asserting means the key is gone", () => {
    expect(
      classifyNativeFailure({ phase: "assert", nativeCode: "ERR_APP_INTEGRITY_INVALID_KEY" }),
    ).toBe("fallback-to-attest")
    expect(classifyNativeFailure({ phase: "assert", nativeCode: undefined })).toBe(
      "fallback-to-attest",
    )
  })

  it("unsupported hardware blocks", () => {
    expect(
      classifyNativeFailure({
        phase: "attest",
        nativeCode: "ERR_APP_INTEGRITY_FEATURE_UNSUPPORTED",
      }),
    ).toBe("blocked")
  })

  it("Apple/Play service trouble while attesting degrades", () => {
    expect(
      classifyNativeFailure({
        phase: "attest",
        nativeCode: "ERR_APP_INTEGRITY_SERVER_UNAVAILABLE",
      }),
    ).toBe("degrade")
    expect(
      classifyNativeFailure({ phase: "attest", nativeCode: "ERR_APP_INTEGRITY_SYSTEM_FAILURE" }),
    ).toBe("degrade")
    expect(classifyNativeFailure({ phase: "attest", nativeCode: undefined })).toBe("degrade")
  })
})

describe("constants", () => {
  it("ladder is 2/5/10/20 seconds", () => {
    expect([...EXCHANGE_RETRY_DELAYS_MS]).toEqual([2000, 5000, 10000, 20000])
  })
})

describe("pickAttestationAlert", () => {
  it("maps the two blocked reasons to their copy", () => {
    expect(pickAttestationAlert("unsupported")).toEqual({
      titleKey: "errors:attestationUnsupportedTitle",
      messageKey: "errors:attestationUnsupportedMessage",
    })
    expect(pickAttestationAlert("rejected")).toEqual({
      titleKey: "errors:attestationServerFailedTitle",
      messageKey: "errors:attestationServerFailedMessage",
    })
  })
})

describe("shouldDropRejectedJwt", () => {
  // ADDED 2026-09-14: the server 401'd a request that carried `rejected`. Drop
  // the module's JWT only when it is still that token — a late response for
  // an old token must not clear the one a refresh just installed.
  it("drops the current token when it is the one the server rejected", () => {
    expect(
      shouldDropRejectedJwt({ current: "a.b.c", rejected: "a.b.c", usingApiKeyFallback: false }),
    ).toBe(true)
  })

  it("keeps a token that differs from the rejected one (already refreshed)", () => {
    expect(
      shouldDropRejectedJwt({ current: "new.jwt", rejected: "a.b.c", usingApiKeyFallback: false }),
    ).toBe(false)
  })

  it("does nothing when there is no token or the device is on the API-key lane", () => {
    expect(
      shouldDropRejectedJwt({ current: null, rejected: "a.b.c", usingApiKeyFallback: false }),
    ).toBe(false)
    expect(
      shouldDropRejectedJwt({ current: "a.b.c", rejected: "a.b.c", usingApiKeyFallback: true }),
    ).toBe(false)
  })
})
