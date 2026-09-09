/**
 * Pure decisions for the device credential lifecycle. No runtime `@/` imports
 * (vitest cannot resolve the alias) and no React Native — see
 * [[vitest-no-path-alias]] and the same split in auth/tokenFreshnessLogic.ts.
 * The I/O orchestrator is ./deviceToken.ts.
 *
 * ADDED 2026-09-09. Spec:
 * docs/superpowers/specs/2026-09-09-app-attest-assertions-and-jwt-persistence-design.md
 */

export type ColdStartStep = "use-stored-jwt" | "assert" | "attest"

/**
 * Which credential path a cold start (or a refresh) takes.
 *
 * A stored JWT with more than `skewMs` left needs no network at all. iOS with
 * a stored key id does a cheap assertion. Everything else — first launch,
 * Android always, iOS after the key was dropped — does a full attestation.
 */
export function decideColdStartStep(i: {
  platform: string
  storedJwtExpiresAt: number | null
  hasStoredKeyId: boolean
  now: number
  skewMs: number
}): ColdStartStep {
  if (i.storedJwtExpiresAt !== null && i.now < i.storedJwtExpiresAt - i.skewMs) {
    return "use-stored-jwt"
  }
  if (i.platform === "ios" && i.hasStoredKeyId) return "assert"
  return "attest"
}

/**
 * Retry ladder for the NETWORK exchanges only. Apple/Play are never retried:
 * key generation is Apple-rate-limited and every attempt used to burn one.
 * ~37 s worst case, which covers a container swap or a Postgres restart
 * (the 2026-09-08 outage would have cleared for most users on this ladder).
 */
export const EXCHANGE_RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 10000, 20000]

/** GeneralApiProblem kinds that another attempt could plausibly clear. */
export const TEMPORARY_API_KINDS: ReadonlySet<string> = new Set([
  "timeout",
  "cannot-connect",
  "server",
  "unknown",
])

export type Exchange = "challenge" | "assert" | "attest"

export type ExchangeFailureAction = "retry" | "fallback-to-attest" | "degrade" | "blocked"

/**
 * What to do when one of the three server exchanges fails.
 *
 * - Temporary kinds retry on the ladder, whatever the exchange.
 * - A non-temporary `assert` failure means "the server does not know this
 *   key" (wiped Keychain, restored backup, pre-2.9.0 row): fall back to a
 *   full attestation. Never user-visible.
 * - A 4xx on `attest` is the server refusing this app on this device:
 *   bundle/team mismatch, tampered binary, failed Play verdict. That blocks.
 *   `bad-data` is our own parsing, not a refusal, so it degrades.
 * - A non-temporary `challenge` failure is a server-side problem, not a
 *   verdict about the device: degrade and let the refresher keep trying.
 */
export function classifyExchangeFailure(i: {
  exchange: Exchange
  kind: string
}): ExchangeFailureAction {
  if (TEMPORARY_API_KINDS.has(i.kind)) return "retry"
  if (i.exchange === "assert") return "fallback-to-attest"
  if (i.exchange === "attest" && i.kind !== "bad-data") return "blocked"
  return "degrade"
}

export type NativeFailureAction = "fallback-to-attest" | "degrade" | "blocked"

/**
 * What to do when the OS attestation framework throws.
 *
 * `nativeCode` is the expo-modules `code` on the thrown error; the values
 * are `IntegrityErrorCodes` in @expo/app-integrity's Swift module
 * (ERR_APP_INTEGRITY_*). Only FEATURE_UNSUPPORTED is a verdict about the
 * device; everything else during a full attestation is Apple/Play having a
 * bad moment, and the framework is NOT retried (see the ladder comment).
 * Any failure while asserting means the stored key is unusable — drop it
 * and attest fresh.
 */
export function classifyNativeFailure(i: {
  phase: "assert" | "attest"
  nativeCode: string | undefined
}): NativeFailureAction {
  if (i.phase === "assert") return "fallback-to-attest"
  if (i.nativeCode === "ERR_APP_INTEGRITY_FEATURE_UNSUPPORTED") return "blocked"
  return "degrade"
}

export type BlockedReason = "unsupported" | "rejected"

export type EstablishOutcome =
  | { status: "ok" }
  /** Temporary trouble; the app runs without a device token and the refresher keeps trying. */
  | { status: "degraded"; detail: string }
  /** The device cannot attest at all, or the server refused it. Full-screen alert. */
  | { status: "blocked"; reason: BlockedReason }

/**
 * Alert copy for the two blocking outcomes. MOVED 2026-09-09 from app.tsx's
 * pickAttestationAlertStrings, which also had "generic" and "Apple failed"
 * variants — those cases no longer block, so they have no copy.
 */
export function pickAttestationAlert(reason: BlockedReason): {
  titleKey: "errors:attestationUnsupportedTitle" | "errors:attestationServerFailedTitle"
  messageKey: "errors:attestationUnsupportedMessage" | "errors:attestationServerFailedMessage"
} {
  if (reason === "unsupported") {
    return {
      titleKey: "errors:attestationUnsupportedTitle",
      messageKey: "errors:attestationUnsupportedMessage",
    }
  }
  return {
    titleKey: "errors:attestationServerFailedTitle",
    messageKey: "errors:attestationServerFailedMessage",
  }
}
