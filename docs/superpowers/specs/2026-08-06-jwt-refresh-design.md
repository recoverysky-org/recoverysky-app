# Proactive JWT Refresh — Design

**Date:** 2026-08-06
**Status:** Approved, ready for implementation planning
**Scope:** `app/services/api/`, `app/services/auth/`, `app/services/attestation/`, `app/app.tsx`, `app/models/AuthenticationStore.ts`

## Problem

The app carries two independent JWTs, sent together on every request to the
RecoverySky API. Neither is refreshed reliably.

| Header | Answers | Source | Renewal today |
|---|---|---|---|
| `X-Device-Token` | Is this the genuine app on a real device? | Apple App Attest / Play Integrity → `POST /attest` | Full re-attestation, triggered **only** on background→active |
| `Authorization: Bearer` | *Which user* is this? | Auth0 Universal Login | **Never** |

They are parallel, not chained. `POST /attest` takes `{ token, platform,
deviceId, keyId? }` (`app/services/api/index.ts:55`) where `token` is the
Apple/Play attestation object — no Auth0 credential is involved, and at cold
start attestation runs (`app/app.tsx:474`) before the Bearer header is even set
(`app/app.tsx:503`). The device token has **no refresh token**:
`AttestationVerifyResult` is exactly `{ deviceJwt, expiresAt }`
(`app/services/api/index.ts:47`).

### Verified current state

**Device lane** — has proactive expiry with a 5-minute skew
(`isJwtExpiredOrNearExpiry()`, `app/app.tsx:128`), but it is evaluated in
exactly one place: the foreground `AppState` listener at `app/app.tsx:854`.
API methods await `waitForAttestation()` (`app/services/api/index.ts:380`), so
in-flight calls queue behind a running re-attestation. Gap: the check never
runs *during* a long foreground session.

**User lane** — no refresh at all. `api.updateAuth()` is called once at
`app/app.tsx:503` plus a MobX reaction on `{isAnonymous, accessToken}` at
`app/app.tsx:510`, so the header only changes when `accessToken` changes.
`accessToken` changes in exactly two places: cold-start hydrate from SecureStore
(`app/models/helpers/setupRootStore.ts:57`, skipped entirely if already expired)
and the `useAuth0Wrapper` effect at `app/services/auth/useAuth0Wrapper.ts:93`,
whose dep array is `[user]`. Auth0's `user` object does not change on a timer,
so **after login the Bearer token is never renewed for the life of the
process**.

`expiresAt` is stored (`app/models/AuthenticationStore.ts:29`) and read by the
`isAuthenticated` / `isTokenExpired` computeds, but `Date.now()` is not
observable, so those computeds do not re-evaluate on their own. Nothing notices
expiry; the stale token just keeps being sent. `canRefresh`, `isTokenExpired`
and `refreshToken` have zero consumers outside the store itself.

**401 handling** — none. `getGeneralApiProblem()` produces
`{ kind: "unauthorized" }` (`app/services/api/apiProblem.ts:72`) and nothing in
the app ever matches on it.

### The enabler

`react-native-auth0` v5.4 exports a standalone `Auth0` class whose
`credentialsManager.getCredentials(scope, minTtl, parameters, forceRefresh)`
(`node_modules/react-native-auth0/lib/typescript/src/core/interfaces/ICredentialsManager.d.ts:29`)
is keychain-backed, **shares storage with the `useAuth0` hook**, auto-refreshes
when the token is expired or below `minTtl`, and throws typed
`CredentialsManagerError`. We already request `offline_access`
(`app/services/auth/auth0.ts:13`) and persist the refresh token, so the refresh
capability exists — it has simply never been invoked. This means the refresher
can live outside React; no lifting of hook internals is required.

## Decisions

Four decisions were settled during design. Recording them with rationale so a
future reader does not silently reverse one.

1. **A permanent refresh failure hard-logs-out to the Login screen.** Not a
   degraded "keep using the app without a Bearer" mode. Clean security posture,
   simple state machine.

2. **…except while an attendance timer is running.** The eject is deferred until
   the timer resolves. See "Timer carve-out" below for the specific failure it
   prevents.

3. **Proactive only — no reactive 401 path.** Both middlewares return the same
   401 body (`{ error: "Unauthorized", message: … }`, from
   `api/src/errors/results.ts:47` in the sibling `api` repo), so the client
   cannot tell which token failed without string-matching prose. Rather than add
   a server-side discriminator or fire expensive speculative re-attestations, we
   build only the proactive gate. **Accepted consequence:** server-side
   revocation and large clock skew are not self-healing within a session; they
   surface as request failures until the next proactive check window.

4. **The gate is a single apisauce async request transform**, not a per-method
   call. `addAsyncRequestTransform(request => Promise<void>)`
   (`node_modules/apisauce/apisauce.d.ts:63`) receives the axios config and can
   await before the request goes out. This covers all ~40 endpoints and every
   future one automatically, and lets us stamp headers **per-request** instead
   of mutating sticky instance headers — which structurally eliminates a latent
   race where a request that started before a refresh goes out with the old
   value. Cost: the gate is invisible at call sites, mitigated by concentrating
   it in one heavily-commented function in the file that already owns auth
   headers.

## Architecture

`depcruise` forbids circular dependencies, and the current direction is
`attestation → api` (`app/services/attestation/index.ts:20` imports `api`). If
the transform imported the refreshers directly it would invert that and create a
cycle. The gate therefore uses **injection**, matching the existing
`setAttestationInProgress` pattern — `app/services/api/` gains no new imports and
stays a leaf.

```
app/services/api/index.ts                      MODIFIED
  + registerTokenRefreshers({ device, user })  injection point, defaults to no-ops
  + one addAsyncRequestTransform in the constructor
  - setDeviceJwt / setApiKeyAuth / setAuthToken / clearAuthToken / updateAuth
  - waitForAttestation / setAttestationInProgress (superseded by dedup)

app/services/auth/auth0Client.ts               NEW
  module-level `new Auth0({ domain, clientId })` singleton
  getFreshCredentials(minTtlSec) → credentialsManager.getCredentials(undefined, minTtl)
  the non-React door to the same keychain the hook uses

app/services/auth/tokenFreshness.ts            NEW  (orchestrator, untested by design)
  createUserTokenRefresher({ authStore, auth0Client, onPermanentFailure })
  createDeviceTokenRefresher({ attest, now })
  composes the pure helpers below with real I/O

app/services/auth/tokenFreshnessLogic.ts       NEW  (PURE — zero @/ runtime imports)
  shouldRefresh(expiresAt, now, skewMs): boolean
  classifyRefreshError(err): "transient" | "permanent"
  createSingleFlight(fn): dedup wrapper
  withTimeout(promise, ms, fallback)

app/services/attestation/deviceToken.ts        NEW  (moved from app.tsx, not written)
  performAttestation, jwtExpiresAt, usingApiKeyFallback, setApiKeyFallback()

app/models/AuthenticationStore.ts              MODIFIED
  + volatile pendingLogout: boolean
  + setPendingLogout(value)

app/app.tsx                                    MODIFIED
  - ~90 lines of attestation state/functions (moved to deviceToken.ts)
  - the auth reaction at :510 (superseded by per-request stamping)
  + refresher construction + api.registerTokenRefreshers(...) during init
  + deferred-logout reaction
```

Two supporting choices:

**`performAttestation` moves out of `app.tsx`.** It is currently module state
plus a function in the root component file, reachable only from there. The
freshness gate needs it from a service, so it must move regardless — and
`app.tsx` is already being edited. Targeted, not speculative refactoring.

**The foreground re-attest listener stays.** It is tempting to delete as
redundant once the transform gates every call, but that is wrong: attestation is
a multi-second Apple/Play round trip, and without the warm-up the first fetch
after a long background sleep pays that latency inline and visibly. Keeping it
means the refresh starts before the user taps anything, and the single-flight
dedup makes a concurrent transform call await the same in-flight promise.

Its body changes: instead of `performAttestation(...)` followed by
`api.setAttestationInProgress(promise)` (`app/app.tsx:859-860`), it becomes a
bare fire-and-forget call to the **device refresher**. Queueing is no longer the
listener's job — single-flight inside the refresher provides it for every
caller, which is precisely why `setAttestationInProgress` can be deleted.

**`pendingLogout` is MobX state on `AuthenticationStore`**, read against the
already-observable `isTimerSessionActive()` box
(`app/services/attendance/timerSession.ts:125`). MobX rather than a new event
channel, for the reason CLAUDE.md gives for `maintenanceMode`: a parallel
pub/sub would be a second source of truth.

## Data flow

Refreshers return the token rather than mutating sticky headers, making the
transform the single authority for both headers:

```ts
type TokenRefreshers = {
  /** Fresh device JWT, or null when running the X-API-Key fallback */
  device: () => Promise<string | null>
  /** Fresh access token, or null when anonymous / signed out */
  user: () => Promise<string | null>
}
```

Request path:

```
apisauce method called
  ↓
async request transform
  ├─ sentinel bypass header present? → delete it, return early
  ↓
  await Promise.all([refreshers.device(), refreshers.user()])
  ↓
  stamp THIS request's config:
    device !== null → X-Device-Token: <jwt>
    device === null → X-API-Key: <authKey>          (simulator / web / android-dev)
    user   !== null → Authorization: Bearer <token>
    user   === null → no Authorization header
  ↓
request goes out
```

### Bypass is a sentinel header, not a URL list

`getPublicStatus()` and the authenticated `getStatus()` hit the **same**
`/status` path, so a URL match cannot distinguish them. Instead
`verifyAttestation()` and `getPublicStatus()` pass a sentinel header
(`X-Skip-Auth-Gate`) that the transform reads, deletes, and early-returns on.
Explicit at the call site and immune to route drift.

A bypassed request carries **no auth headers at all** — not even `X-API-Key`.
This is correct for both bypass sites: `/attest` is documented as being called
without device authorization since we are in the process of obtaining it
(`app/services/api/index.ts:430`), and `getPublicStatus()` is a public probe
that runs before any credential exists (`app/services/api/index.ts:491`).

### Dedup

Each refresher holds an in-flight promise via `createSingleFlight`; concurrent
callers await the same one. This generalizes the existing
`setAttestationInProgress` idea and moves it somewhere testable. It is what
makes the foreground warm-up and the transform cooperate rather than
double-attest.

### Thresholds — deliberately asymmetric

- **User lane: 60 s**, passed as `minTtl` to `getCredentials()` so the SDK
  itself decides and refreshes. One cheap network hop.
- **Device lane: 5 min**, preserving the existing `FIVE_MINUTES_MS` skew.
  Re-attestation is a multi-second Apple/Play round trip, so it must start well
  before the token actually dies.

### Write-back

When the user lane refreshes it calls `authStore.setTokens()` and
`saveAuthCredentials()` so the new expiry reaches persisted state and survives
to the next cold start. Without this the same refresh repeats every launch. A
failing `saveAuthCredentials()` is logged and otherwise ignored — it must not
fail the request.

### What this removes

Per-request stamping makes the sticky-header machinery redundant. `setDeviceJwt()`,
`setApiKeyAuth()`, `setAuthToken()`, `clearAuthToken()`, `updateAuth()` and the
auth reaction at `app/app.tsx:510` all go away, along with `waitForAttestation()`
and its ~40 call sites. The API layer stops holding mutable auth state entirely,
which is what removes the stale-header race for real rather than papering over
it.

## Failure handling

### Classification

`CredentialsManagerError` carries a `type` string
(`.../core/models/CredentialsManagerError.d.ts:233`) drawn from a fixed code
list:

| Verdict | Codes |
|---|---|
| **Permanent** → logout | `NO_REFRESH_TOKEN`, `NO_CREDENTIALS`, `INVALID_CREDENTIALS`, `DPOP_KEY_MISSING`, `DPOP_KEY_MISMATCH` |
| **Transient** → proceed, retry later | `NO_NETWORK`, `RENEW_FAILED`, `API_ERROR`, `STORE_FAILED`, `CRYPTO_EXCEPTION`, `UNKNOWN_ERROR`, and **anything unrecognized** |

Unknown codes default to **transient**, and this asymmetry is load-bearing. The
two misclassifications do not cost the same: treating a transient failure as
permanent logs a real user out for no reason, while treating a permanent failure
as transient merely keeps them signed in until the next attempt. `RENEW_FAILED`
sits on the transient side for the same reason — the SDK uses it for network-ish
renewal failures as well as genuine rejections, and it is not worth ejecting
someone over an ambiguous code.

### Transient → never block

The refresher returns the current (possibly stale) token; the request goes out
and fails on its own. Offline is the overwhelmingly common transient case, and a
gate that blocked on an impossible refresh would hang every API call in the app
the moment a user walked into a basement meeting.

### Timeout guard

Each refresh races a cap — **10 s user, 15 s device** — and a timeout is
classified transient. Without this, one hung refresh promise stalls every
request queued behind it, a worse failure than the one being fixed.

### Permanent → logout, in two beats

```
permanent classification
  ↓
① user refresher returns null, immediately and thereafter
     → transform stops stamping Authorization
     → no stale Bearer can go out, timer running or not
  ↓
② onPermanentFailure()
     ├─ isTimerSessionActive() → authStore.setPendingLogout(true), stay put
     └─ otherwise             → log out now

reaction(() => ({ pending: authStore.pendingLogout, live: isTimerSessionActive() }))
  → when pending && !live:
       authStore.logout()
       clearAuthCredentials()
       auth0Client.credentialsManager.clearCredentials()
```

All three clears are required. Clearing only our SecureStore copy leaves the
SDK's own keychain credentials intact, and the next `useAuth0Wrapper` sync would
re-hydrate the dead session.

### Timer carve-out — the specific failure it prevents

A forced logout flips `isAuthenticated`, which swaps the tree at the
*AppNavigator* level (`app/navigators/AppNavigator.tsx:107`) — above
`MainNavigator`'s `isTimerSessionActive()` tab lock, so that lock does not catch
it. The MMKV session row survives (and `uid` is captured at start specifically
to preserve identity across a sign-out, `app/services/attendance/timerSession.ts:9`),
but the recovery path does not: `TimerSessionResumer` fires once per mount,
gated on `hasRun` plus DB status (`app/db/TimerSessionResumer.tsx:62-65`). After
re-login it never re-fires, so the timer silently vanishes until the next cold
start — and is lost entirely if none happens within the 6-hour
`MAX_RECOVERY_AGE_MS`. (UPDATE 2026-09-12: that cap was removed; the resumer
now restores a persisted session of any age.)

This is the same class of harm as the 2026-05-11 resumer rewrite and the
2026-08-06 navigation lock. Deferring the eject is the smallest fix consistent
with both.

### Device lane, permanent failure at runtime

Deliberately **not** symmetric with the user lane. Startup already blocks with a
fatal alert (`app/app.tsx:255`). Mid-session, a permanently-failing
re-attestation logs fatal, returns the stale token, and lets calls 401. No
alert, no eject, no `outageMode` — interrupting someone mid-meeting because
Apple's attestation service is having a bad day is a worse outcome than a few
failed background fetches. `performAttestation`'s existing 4-attempt backoff
(`ATTESTATION_RETRY_DELAYS`, `app/app.tsx:135`) still applies underneath.

### Recursion

The device refresher calls `verifyAttestation()`, which goes out through the
same apisauce instance. The sentinel bypass header is what stops it re-entering
the gate. This is the invariant that makes the transform safe and gets a comment
saying so.

### Short-circuits

Anonymous users: the user refresher returns `null` without touching Auth0. Web:
the device refresher returns `null` and the transform stamps `X-API-Key`.

## Testing

Per the repo's runner split, pure logic goes to vitest and the I/O orchestrator
is verified by hand.

**`tokenFreshnessLogic.test.ts` (vitest, `.ts`, zero `@/` imports):**
- `shouldRefresh` boundaries: no `expiresAt`, exactly at skew, one ms either
  side, already expired, far future.
- `classifyRefreshError` table across every code in both columns above, plus a
  non-`CredentialsManagerError` throw, plus an unrecognized code string —
  asserting the unknown→transient default explicitly, since that is the
  decision most likely to be "cleaned up" later.
- `createSingleFlight`: N concurrent callers invoke the underlying fn once and
  all receive the same result; a rejection clears the slot so the next call
  retries; a second call after settle re-invokes.
- `withTimeout`: resolves through, and returns the fallback on timeout without
  leaking the pending promise.

**`tokenFreshness.ts` and the transform are not unit-tested** — they import
`@/utils/logger` and touch the SDK, matching the `syncLogic.ts` vs
`services/sync/index.ts` precedent. Manual checklist:

1. Signed in, backgrounded past token expiry (shorten the Auth0 API token TTL in
   dev to make this fast), foreground, trigger a fetch → Loki shows one refresh,
   request succeeds, no logout.
   ⚠️ **Keep the test TTL above ~120 s.** `getFreshCredentials` passes
   `minTtl = 60` seconds, and the SDK throws `LARGE_MIN_TTL` when the token's
   whole lifetime is below the requested `minTtl`. That code is not in
   `PERMANENT_REFRESH_ERROR_CODES`, so it classifies **transient**: the refresh
   silently never happens, the request goes out with the old token, and a
   perfectly working gate reads as broken. A TTL comfortably above the 60 s
   margin leaves a real expiry window to test against.
2. Airplane mode with an expired token → calls fail, **no logout**, recovery on
   reconnect.
3. Revoke the refresh token in the Auth0 dashboard → next call → lands on Login.
4. As (3) but with an in-person timer running → stays on Main, timer intact and
   still counting, Save writes the record, **then** Login appears.
5. Simulator (`X-API-Key` path) → unaffected, no attestation attempted.
6. Anonymous user → no `Authorization` header on any request.
7. Device JWT near expiry, foreground the app and immediately pull-to-refresh →
   logs show exactly **one** attestation, not two (dedup working).
8. Concurrent burst (Meetings tab load, ~4 parallel calls) with a stale user
   token → exactly one refresh.

## Release mechanics

**No `runtimeVersion` bump.** This is JS-only: no new native dependency, no
`app.json` native config change, no Podfile/Gradle change.
`react-native-auth0` is already installed and linked; using its exported `Auth0`
class adds no native code. Ships as an OTA via `npm run update`.

`CHANGELOG.md` gets a `Fixed` entry under `[Unreleased]` describing the
user-visible failure mode (signed-in users silently losing API access after
their access token expired, until an app restart), not the implementation.

## Out of scope

- Reactive 401 refresh-and-replay (decision 3).
- The server-side auth-failure discriminator in the sibling `api` repo.
- Auth0 MRRT / `getApiCredentials` per-audience tokens.
- DPoP-bound tokens.
- The unrelated `ReauthBanner` / degraded-mode UI that the rejected option 1
  would have needed.
