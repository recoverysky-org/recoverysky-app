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
 *
 * INVARIANT: the worst-case ladder (attempts × the 10 s api timeout + these
 * sleeps ≈ 87 s) must stay well under the server's 5-minute nonce TTL (api
 * `CHALLENGE_TTL_MS`); an expired nonce comes back as a 400 and the whole
 * cold start is wasted. CHANGED 2026-09-09 (final review): that 400 now
 * degrades rather than blocking (see classifyExchangeFailure), so blowing the
 * TTL costs a retry cycle instead of a full-screen alert — but keep the
 * invariant: widen this ladder or the api timeout only together with the TTL.
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
 * - A 401 or 403 on `attest` is the server refusing this app on this device:
 *   bundle/team mismatch, tampered binary, failed Play verdict. That blocks.
 *   CHANGED 2026-09-09 (final review): every OTHER non-temporary kind on
 *   `attest` degrades. The attest routes are rate-limited by IP, so a
 *   carrier-NAT or campus population retrying on the ladder can trip a
 *   per-IP bucket — and `apiProblem.ts` maps both 429 and 400 to `rejected`.
 *   A limiter hit and a `bad_nonce` (400, e.g. Apple's attestKeyAsync stalled
 *   past the 5-minute nonce TTL) are protocol outcomes, not verdicts about
 *   the device; telling those users the app was refused is wrong and, unlike
 *   a real refusal, retrying clears it. `bad-data` is our own parsing, not a
 *   refusal, and degrades for the same reason.
 * - A non-temporary `challenge` failure is a server-side problem, not a
 *   verdict about the device: degrade and let the refresher keep trying.
 */
export function classifyExchangeFailure(i: {
  exchange: Exchange
  kind: string
}): ExchangeFailureAction {
  if (TEMPORARY_API_KINDS.has(i.kind)) return "retry"
  if (i.exchange === "assert") return "fallback-to-attest"
  if (i.exchange === "attest" && (i.kind === "forbidden" || i.kind === "unauthorized")) {
    return "blocked"
  }
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

/**
 * Whether a server 401 for `rejected` should drop the module's current JWT.
 *
 * ADDED 2026-09-14 — the reactive half the 2026-09-09 spec deferred (§4
 * "Stored JWT from a rotated server secret"). Identity, not truthiness: a
 * response for an old token can land after a refresh already installed a
 * new one, and clearing the new one would churn attestation for nothing.
 * The API-key lane has no JWT to drop.
 */
export function shouldDropRejectedJwt(i: {
  current: string | null
  rejected: string
  usingApiKeyFallback: boolean
}): boolean {
  if (i.usingApiKeyFallback || i.current === null) return false
  return i.current === i.rejected
}
