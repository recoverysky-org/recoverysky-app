# Opaque access token after idle renewal: validate token shape, eject on rejected bearer

**Date:** 2026-09-10 (revised the same day after review — see "Review findings" at the end; API
deltas folded in after `api` v1.7.0 deployed)
**Status:** API half **shipped** (`api` v1.7.0, deployed 2026-09-10, verified: an opaque bearer on
`GET /reminders` answers `401 {"code":"token_malformed"}`). App half implemented 2026-09-10
(plan: docs/superpowers/plans/2026-09-10-opaque-access-token-app-half.md); awaiting the manual
checklist and OTA.
**Repos touched:** `app` (credential validation, refresher, API client, toast copy) and `api`
(machine-readable rejection codes, JWKS retry + stale fallback, Auth0 call timeouts — Section 2).
The API change is recorded in detail in
`2026-09-10-api-bearer-rejection-codes-change-request.md`; this spec carries the contract the app
codes against.

## Why

On 2026-09-10 a TestFlight tester who had not used the app in a while opened 4.8.0. The Keychain still
held their old sign-in. Between 15:10:08 and 15:11:32 UTC they tried to send an attendance report four times
(report ids `68B2-A911`, `9E58-F925`, `2560-970D`, `1067-BD05`). Every attempt showed the generic
"Failed to send report" toast. The API answered `POST /reports` with 401 each time, and the reason it
logged was:

```
Auth: JWT verification failed {"errorName":"JWTInvalid","errorMessage":"Only JWTs using Compact JWS serialization can be decoded"}
```

The bearer value the app sent was not a JWT. The device-authenticated routes the user hit in the same
minute (`GET /schedules/live`, config, status) all succeeded, because they never look at the bearer.
Joining meetings worked, sending the report did not, and nothing told the user why. The tester signed
out and back in at 15:49–15:51; the next send (`F959-2F81`) returned 200.

The sequence on the device, from the app's own logs:

| Time (UTC) | Event |
| --- | --- |
| 14:55:31 | First launch after an idle period. SecureStore held credentials whose access token had expired 19.7 days earlier, plus a refresh token. Hydrated "for gate-driven refresh". |
| 14:55:34 | Auth0Provider restored its own session. The sync effect called `getCredentials()`, which renewed with the stored refresh token and returned a new access token with a 24 h expiry. The app stored it in MST and SecureStore. |
| 14:55:34 | `POST /push-tokens/` 401. Logged as a WARN, nothing else happened. |
| 14:58:29, 15:48:50 | Every later cold start restored the same token from SecureStore ("expiresIn 1437 min") and failed push-token registration the same way. |
| 15:10–15:11 | Four report sends, four 401s, four rollbacks, four generic toasts. |
| 15:49:03 | `logout()`, then a fresh `authorize()` with the API audience. |
| 15:51:11 | Report sent successfully. |

## Root cause

Three gaps, each necessary for the outcome:

1. **The app never checks the shape of an access token before trusting it.** `getCredentials()`
   returns whatever Auth0 mints for the stored refresh token. A refresh token is bound to the audience
   of the login that produced it. If that login had no API audience, renewal yields an opaque token that
   is valid for `/userinfo` only. The app stores it with a healthy expiry, `isAuthenticated` turns
   true, and the request gate's `shouldRefresh` says no for the next 23 hours.
2. **A rejected bearer does not invalidate the session.** `getGeneralApiProblem` maps every 401 to
   `{ kind: "unauthorized" }`. The report sender toasts a generic message. The push-token path
   warns. Nothing calls the forced-logout path that already exists for a dead refresh token.
3. **Idle time is the trigger, not installation.** The renewal path runs on any cold start whose
   stored access token has expired. A user who leaves the app closed for longer than the access token
   lifetime and then opens it walks the same path, new build or not. Reinstalling does not help
   either: both the app's SecureStore blob (`auth_credentials_v1`) and the Auth0 SDK's own credential
   store live in the iOS Keychain and survive app deletion.

### Where the audience-less refresh token came from

REVISED 2026-09-10. The first draft called this "not settled" because it assumed the API access
token lifetime is ~30 days, which would have made the stored token (expired 2026-08-21) a JWT minted
in July, and a refresh token that minted a JWT in July should mint one now. That assumption was doing
all the work, and it is probably wrong:

- **The audience was missing from production builds for five weeks.** `AUTH0_CONFIG.audience` was
  added to `app/services/auth/auth0.ts` on 2026-02-26 (`b947af3`), but `EXPO_PUBLIC_AUTH0_AUDIENCE`
  only reached `eas.json` on 2026-04-02 (`c759d69`, whose own message says production builds "fell
  back to empty strings for … Auth0"). `.env` is gitignored and easignored, so every EAS / TestFlight
  build from v3.12.1 through v4.1.6 called `authorize({ audience: "" })`. Auth0 answers that with an
  opaque `/userinfo` token and a refresh token bound to no API audience. Logins before 2026-02-26 had
  no audience at all and produced the same thing.
- **Renewal never adds an audience.** Auth0.swift 2.19 (pinned by react-native-auth0 5.4) renews via
  `CredentialsManager.credentials()`, which passes scope and `minTTL` but no audience; only the MRRT
  path `apiCredentials(forAudience:)` does, and we do not use it. A refresh token from an audience-less
  login therefore mints opaque tokens for as long as it lives, across app updates and reinstalls.
- **The 24 h expiry is consistent with the whole session being opaque.** Auth0's default access
  token lifetime is 24 hours for both audience-less and API tokens unless the API's Token Expiration
  was raised. If the stored token that expired on 2026-08-21 was also a 24 h opaque token, it was
  minted on an app open around 2026-08-20, and nothing about this session ever changed shape.

**Verify before closing this paragraph:** (a) the API's Token Expiration in the Auth0 dashboard, and
(b) Loki for that device's session around 2026-08-20 and whether it ever produced a 200 from
`POST /reports`. If both agree, the population at risk is "anyone who signed in on a TestFlight build
at or before 4.1.6 and never signed out". Loki for the last 30 days shows JWTInvalid from exactly one
device (this tester, 8 lines, all 2026-09-10), so that population is small but it is not one person,
and the fix below covers all of them.

## Decisions

- **Validate shape and claims, never signature.** The client cannot verify the signature and should
  not try. It checks a strict subset of what the server checks: three segments, a decodable header
  and payload, `aud` containing the configured audience, `exp` present. A token that passes may still
  be rejected by the server; a token that fails is guaranteed to be. That is what makes the check a
  faithful predictor with no false ejects, and it is why the rule set stays minimal — every extra rule
  is extra false-eject surface (see the `iss` note in Section 1).
- **Reuse the forced-logout path, do not add a second one.** `createUserTokenRefresher` already has
  `onPermanentFailure`, which `app.tsx` wires to timer-aware deferral and `performForcedLogout`
  (clears MST, SecureStore, and the SDK store, then resets the refresher). An invalid token from any
  source is treated as a permanent failure and goes through that.
- **One helper, three call sites.** The check lives in `jwtUtils.ts` next to `decodeJwtPayload` and
  is called wherever an access token enters the store: cold-start hydration, the Auth0 sync effect,
  and the refresher. No call site keeps its own copy of the rule.
- **A rejected bearer is a signal, not just an error — but only when the server says the token itself
  is the problem.** REVISED 2026-09-10: the server's 401 catch-all also covers failures on the
  server's side (JWKS timeouts, key rotation), so the client must not infer "this token can never
  work" from a message string. The API returns a machine-readable `code`, and the client ejects only
  on the codes that describe the token (Section 2).
- **App side ships as an OTA; the API side went out first.** Nothing here touches native code or
  the Auth0 SDK config. The API change is additive (a new field in an existing 401 body, plus a 503
  where a JWKS failure used to be a 401), so shipped app builds see the same generic toast they
  always did, and the app half can land whenever it is ready.

## Section 1 — Token shape validation

### `isUsableAccessToken(token, config)` in `app/services/auth/jwtUtils.ts`

Pure function. Returns `{ ok: true }` or `{ ok: false, reason }` with `reason` one of:

| reason | Condition |
| --- | --- |
| `not-jwt` | `token.split(".").length !== 3`, or header/payload fail to decode as JSON |
| `wrong-audience` | `config.audience` is non-empty and `payload.aud` (string or array) does not contain it |
| `no-expiry` | `payload.exp` missing or not a number |

`config` is `{ audience: string }` taken from `AUTH0_CONFIG`. The parameter exists so tests never
touch env. When `config.audience` is the empty string (dev builds without
`EXPO_PUBLIC_AUTH0_AUDIENCE`), the audience rule is skipped and a debug line says so once.

**No `iss` rule.** REVISED 2026-09-10: the first draft compared `payload.iss` to `https://${domain}/`.
The API verifies `issuer` against its own `AUTH_ISSUER` env (default: the canonical
`meetingmaker.auth0.com` tenant, while the app mints tokens through the custom domain
`auth.recoverysky.app`). If the two strings ever differ, the client-side rule would eject users the
server accepts — the exact false eject the "strict subset" decision forbids — and the failure we
actually saw is fully caught by `not-jwt` plus `wrong-audience`. If an issuer rule is ever wanted, it
must read the same string the API is configured with, not derive its own.

The function never logs the token or any substring of it. Callers log `reason`,
`token.length`, and the segment count.

### Call site 1: cold-start hydration (`setupRootStore.ts`)

After `loadAuthCredentials()` returns, run the check on `creds.accessToken` before `setTokens`.

- Pass: unchanged behaviour.
- Fail: log at WARN `"Stored access token unusable — discarding"` with `reason`. Do **not** call
  `setTokens`. Call `clearAuthCredentials()` (fire and forget, errors logged). Continue to
  `setAuthReady()`. The Auth0Provider's `[user]` effect still runs and gets its own chance to produce
  a good token, so a user with a valid SDK session is not punished for a corrupt SecureStore blob.

### Call site 2: Auth0 sync effect (`useAuth0Wrapper.ts`)

After `getCredentials()` resolves, run the check.

- Pass: unchanged.
- Fail: log at ERROR `"Auth0 SDK returned unusable access token — signing out"` with `reason`. Do
  **not** call `setTokens` or `saveAuthCredentials`. Call `onUnusableToken()` (a new optional prop on
  the wrapper, wired from `app.tsx` to the same handler as `onPermanentFailure`). Still call
  `setAuthReady()` so the splash never waits on a session that is being torn down; the forced-logout
  path calls `authStore.logout()`, which flips `isAuthenticated` and routes to Login.

  Note that skipping `setTokens` means the store holds no access token, so `isAuthenticated` is
  already false and the navigator shows Login immediately, whether or not the timer deferral in
  `onPermanentFailure` fires. In practice this call site runs at cold start before any timer can
  exist, so nothing is lost — but the deferral is not what protects the user here.

### Call site 3: refresher (`tokenFreshness.ts`)

Inside the single-flight `refresh` after `getFreshCredentials()` resolves, run the check.

- Pass: unchanged.
- Fail: throw a `UnusableTokenError` (a small class in `tokenFreshnessLogic.ts` carrying `reason`).
  `classifyRefreshError` returns `"permanent"` for it. The existing catch in `getToken` then logs,
  sets `permanentlyFailed`, calls `onPermanentFailure`, and returns `null`. No new branch in
  `getToken`.
- If `withTimeout` has already handed the caller the stale fallback when the check fails, the
  rejection is observed only by the race and the verdict is lost for that request. This matches how
  every other permanent refresh error behaves today: the next request past the backoff ladder retries
  and lands in the catch. No special handling.

## Section 2 — Rejected bearer feedback

### Why the first draft was wrong

The draft matched two message strings, `"Invalid token"` and `"Token validation failed"`, on the
theory that they are what `verifyToken` produces "for non-expiry failures" and therefore mean the
token can never work. They are not. `verifyToken`'s catch-all returns `"Invalid token"` for
**anything** that is not `JWTExpired` or `JWTClaimValidationFailed` — including `JWKSTimeout`,
`JWKSNoMatchingKey` (Auth0 signing-key rotation), and any fetch error between the API and Auth0.
Production Loki, last 30 days:

| jose error | count | meaning |
| --- | --- | --- |
| JWTExpired | 30 | normal; the gate's skew handles it |
| JWKSTimeout | 10 | the API could not reach Auth0's JWKS in time |
| JWTInvalid | 8 | this tester, all on 2026-09-10 |

Each of those ten JWKSTimeout responses went out as `{"message":"Invalid token"}` with a valid
bearer attached. Under the draft, each would have force-logged-out a user whose token was fine.
Matching copy strings is also a brittle contract even where it happens to be right.

### API: machine-readable code on bearer rejections (`api/src/middleware/auth.ts`) — SHIPPED v1.7.0

`verifyToken` classifies by jose error class and `authenticate` puts a `code` on the body. Bodies
are exactly:

```json
{ "error": "Unauthorized",       "message": "Invalid token",                      "code": "token_malformed" }
{ "error": "Unauthorized",       "message": "Token validation failed",            "code": "token_claims" }
{ "error": "Unauthorized",       "message": "Invalid token",                      "code": "token_signature" }
{ "error": "Unauthorized",       "message": "Token expired",                      "code": "token_expired" }
{ "error": "Unauthorized",       "message": "Invalid token",                      "code": "token_invalid" }
{ "error": "ServiceUnavailable", "message": "Authentication service unavailable", "code": "auth_unavailable" }
```

| `code` | status | jose cause | app action |
| --- | --- | --- | --- |
| `token_malformed` | 401 | `JWTInvalid` (not compact JWS — the opaque token), `JWSInvalid` | **eject** |
| `token_claims` | 401 | `JWTClaimValidationFailed` (iss / aud / nbf) | **eject** |
| `token_signature` | 401 | `JWSSignatureVerificationFailed` | **eject** |
| `token_expired` | 401 | `JWTExpired` | nothing; the gate refreshes |
| `token_invalid` | 401 | any other `JOSEError` about the token (alg not allowed, unsupported) | nothing |
| `auth_unavailable` | **503** | JWKS fetch failed after retry, `JWKSNoMatchingKey`, `JWKSMultipleMatchingKeys` | nothing; transient |

Points the app half must respect:

- **`token_invalid` is a fifth 401 code** (added during implementation for jose errors that are
  about the token but none of malformed / claims / signature / expired). It must **not** eject: the
  monitor's allow-list of three codes gives that, and the test list names it.
- **Two 401s carry no `code`**, and absence means "do not eject": `{"message":"Invalid API key"}`
  (bad `X-API-Key`) and `{"message":"Missing or invalid authorization header"}` (no credential).
  A 401 from `deviceAuth` (`"Missing device credentials …"`) is a third; it never carries a bearer
  verdict either.
- **`message` copy is unchanged for humans**, as asked, which means `token_malformed`,
  `token_signature` and `token_invalid` all say `Invalid token`. Nothing in the app may branch on
  `message`.
- **The 503 bucket is rare by construction, not just relabelled.** The API makes two JWKS attempts
  of `AUTH_JWKS_TIMEOUT_MS` (3000) with a 250 ms pause (≈6.3 s worst case, sized under the app's
  10 s client timeout), verifies against the last good key set when a periodic refresh fails, and
  warms the set at startup. `auth_unavailable` now means "Auth0 unreachable twice in a row from a
  cold container" or "the token's `kid` is genuinely not in the published set". The app has **no
  reason to retry a 503 itself** — the API already did, and a client retry would double Auth0
  pressure during the exact outage it is meant to survive. It flows through `GeneralApiProblem` as
  `{ kind: "server" }`, which no call site turns into a sign-out (confirm when implementing).
- **`optionalAuth` routes never emit a code.** `POST /reports/status` (the delivery poller) runs
  `deviceAuth` + `optionalAuth`; a bad bearer there does not 401, the request proceeds
  unauthenticated. The monitor only ever sees an eject signal from routes that require a signed-in
  user (`POST /reports`, `/push-tokens`, `/reminders`, `/notifications` subscriptions, `/sync`,
  `/firebase`, `/storage`, `/auth0`, `/api/replyke`). This matches the incident: the tester's polls
  "succeeded" while the sends failed.
- **`POST /auth0/profile`** gained a 4 s per-attempt timeout and one retry on transport failure,
  5xx or 429. A final failure is still the route's existing 500; no new code.
- The OpenAPI `ApiError` schema declares `code` with the six-value enum.

### API client (`app/services/api/index.ts`)

Add `addMonitor` to the apisauce instance. For each response where all of the following hold:

- `response.status === 401`
- the request carried an `Authorization` header. In a monitor `response.config.headers` is an
  **AxiosHeaders instance**, not the plain object the request transform sees (the gate's comment
  explains the difference) — read it case-insensitively via its `get`, do not index it.
- `response.data?.code` is one of `token_malformed`, `token_claims`, `token_signature`

call `this.onBearerRejected?.()`. Any other code, a missing code, a 503, or a request that carried
`SKIP_AUTH_GATE_HEADER` → nothing. No fingerprint, no dedupe state in the monitor. REVISED
2026-09-10: the draft kept the last 8 characters of the bearer to avoid reporting the same token
twice. The refresher latch below already makes the call idempotent, and once latched no further
bearers go out, so there is nothing to dedupe — and a token-derived value that must "never be logged"
is a footgun with no payoff.

`registerTokenRefreshers` gains an optional third field `onBearerRejected`. `app.tsx` wires it to a
new `userRefresher.markRejected()`.

### Refresher: `markRejected()`

Sets `permanentlyFailed = true` and calls `onPermanentFailure()`. Idempotent: a second call while
latched is a no-op. `reset()` clears it as it clears the rest. This is the only new public method on
the refresher.

### Why not retry with a refresh first

A `token_malformed` / `token_claims` 401 means the token never was a JWT or has the wrong claims.
Refreshing with the same refresh token produces the same kind of token (see "Renewal never adds an
audience" above). The only recovery is a new login, which is what forced logout leads to.

## Section 3 — What the user sees

- **Report send with `kind: "unauthorized"`:** toast copy changes from "Failed to send report" to
  "Please sign in again to send this report". Both strings become `tx` keys. REVISED 2026-09-10:
  `useReportSender` currently hardcodes its English toast copy, which already breaks the project's
  i18n rule; this change must not add another. New keys are a nine-locale change (English placeholder
  text in the other eight is acceptable, the key must exist — see CLAUDE.md "Internationalization").
  The report is still rolled back as today. In practice the forced logout swaps the navigator to
  Login within the same tick, so the toast is a brief explanation of why the screen changed.
- **Push-token `unauthorized`:** unchanged (silent WARN). The monitor in Section 2 fires on that 401
  too, so a bad token is caught at the first cold start, before the user tries anything that matters.
- **Timer running:** the existing `pendingLogout` deferral applies to the refresher and monitor
  paths. REVISED 2026-09-10: the draft said "attendance in progress is never interrupted", which
  overstates what the deferral can do. `isAuthenticated` compares `expiresAt` to the clock, so once
  the token the store still holds expires (within about a minute of the failed refresh) the next
  observer re-render of `AppNavigator` shows Login regardless of `pendingLogout`. That is a
  pre-existing limit of the deferral design, not something this change introduces or fixes; noted
  here so nobody relies on the stronger claim.
- **Login screen:** unchanged, no new copy. `performForcedLogout` clears both credential stores
  but does **not** call `clearSession`, so the Auth0 web-session cookie survives the eject. The next
  Login tap runs `authorize()` with the API audience and, while that cookie is alive, usually
  completes without the user re-entering a password. The eject is close to invisible; "you were signed
  out" copy would only confuse a user who was never told they were signed in on this install.

## Section 4 — Telemetry

Every rejection logs one WARN or ERROR line carrying `reason`, `tokenLength`, `tokenSegments`, and
`source` (`hydration`, `sdk-sync`, `refresh`, `server-401`). Structured metadata in Loki, so
`{service_name="recoverysky-app"} | source=~"hydration|sdk-sync|refresh|server-401"` finds every
occurrence across testers, and `loki count ... --by reason,source` shows whether pre-audience sessions
are the only cause. The `server-401` line also carries the server's `code`.

On the API side (shipped in v1.7.0) the failure log carries `code`, `tokenLength` and
`tokenSegments`, and the 20-character `tokenPrefix` is gone from **both** the success and failure
paths — for a valid JWT it was the same header bytes every time, and for a 32-character opaque token
it was most of a live credential. `auth_unavailable` logs at **warn**; every other code at debug.
The API's Loki stream is `{service_name="app_api"}` and its lines are pretty-printed pino text, so
use line filters, not `| json`:

```
{service_name="app_api"} |= "Auth: JWT verification failed" |= "auth_unavailable"
```

That filter is the ongoing count that replaces the manual 30-day tally in review finding 1.
Re-run it a couple of weeks after the deploy: the JWKS retry + stale fallback should have cut the
volume behind the 503 bucket sharply.

## Testing

Unit (vitest, alongside `tokenFreshnessLogic.test.ts`):

- `isUsableAccessToken`: opaque string, two segments, three segments with non-JSON payload, `aud`
  as string match, `aud` as array match, `aud` mismatch, missing `exp`, empty configured audience
  skips the audience rule, valid token passes, a token with an unexpected `iss` but correct `aud`
  **passes** (regression guard for the dropped issuer rule).
- `createUserTokenRefresher` with a stubbed `getFreshCredentials` returning an opaque token:
  `setTokens` not called, `saveAuthCredentials` not called, `onPermanentFailure` called once,
  `getToken` resolves `null`, a second `getToken` short-circuits without calling
  `getFreshCredentials` again, `reset()` re-enables it.
- `classifyRefreshError(new UnusableTokenError("not-jwt"))` is `"permanent"`.
- `markRejected()`: calls `onPermanentFailure` once, second call is a no-op.
- API client monitor: 401 with `code: "token_malformed"` (and separately `token_claims`,
  `token_signature`) and a bearer calls `onBearerRejected`; 401 with `code: "token_expired"` does
  not; 401 with `code: "token_invalid"` does not; 401 with no `code` (`Invalid API key`, missing
  header, older API) does not; 401 without a bearer does not; 401 on a request with
  `SKIP_AUTH_GATE_HEADER` does not; 503 `auth_unavailable` does not.
- No call site maps `{ kind: "server" }` to a sign-out (grep, one assertion is enough).

API unit tests: shipped in v1.7.0 (`src/middleware/auth.test.ts`, 17 cases; `src/routes/auth0.test.ts`,
7 cases). They mint real RS256 tokens against an in-process JWKS server that can hang, 500 or serve,
so the retry, stale-fallback and warm-up paths run against jose's real remote-JWKS behaviour rather
than a mock. Nothing further to add on the API side for this change.

Manual, on a dev build:

1. Sign in normally, confirm a report sends.
2. In the dev menu, overwrite the SecureStore `auth_credentials_v1` access token with an opaque string
   and a future `expiresAt`, then cold start. Expect the WARN from call site 1, no
   `isAuthenticated`, and either a good token from the SDK or the Login screen.
3. Temporarily set `EXPO_PUBLIC_AUTH0_AUDIENCE` to empty, sign in (Auth0 issues an opaque token),
   restore the audience, cold start. Expect the ERROR from call site 2 and the Login screen. This is
   the exact shape of the production sessions from builds ≤ 4.1.6.
4. With a good session, use a proxy to rewrite one `POST /reports` response to a 401 with
   `{"error":"Unauthorized","message":"Invalid token","code":"token_malformed"}`. Expect the new
   toast and the Login screen. Repeat with `code: "token_expired"`, with `code: "token_invalid"`,
   and with a 503 `auth_unavailable`, and expect no eject in any of the three. No proxy is needed
   for the malformed case against the real API: send any opaque string as the bearer to a
   signed-in-only route and v1.7.0 answers `token_malformed` (see the change-request doc, §5).
4b. **Stays ejected.** After step 4's malformed-token case, watch the screen for ten seconds. The
   app must stay on Login and never bounce back to the tabs. This is the observation that covers a
   late-landing refresh (final review I1) and the SDK-credential-clear race (final review M3).
4c. **Concurrent 401s.** Repeat step 4's malformed-token case with two report sends fired back to
   back and count the app-side `source=server-401` lines. More than one is the documented double
   eject (final review I2 — the latch is reset by the logout itself), not a regression.
5. Tap Login after the eject in step 3 and confirm the SSO cookie path completes without a password
   prompt (Section 3, last bullet).

Confirmation in production: after the app OTA, `{service_name="app_api"} |= "token_malformed"`
should show no repeats from the same device, and the app-side `source=server-401` line should
appear once per incident, occasionally more when requests 401 concurrently. `JWKSTimeout` lines
already sit next to 503s as of v1.7.0.

## Out of scope

- Changing the Auth0 SDK configuration or how `authorize()` requests the audience. Fresh logins on
  every build since 4.1.7 already produce correct tokens.
- Handling `token_expired` 401s differently. The request gate's skew-driven refresh covers them.
- Migrating or versioning the SecureStore blob. Discarding an unusable token is enough.
- Fixing the `isAuthenticated`-vs-clock limit of the timer deferral (Section 3). Separate design if
  it is ever worth doing.
- Proactively signing out every pre-4.1.7 session. The three call sites catch each such session on
  its next cold start or refresh, which is the same moment a proactive sweep could act.
- A rate limiter on the API auth path. The API cannot see real client IPs (see the `/attest` note
  in the API's `CLAUDE.md`), so a limiter there would collapse every device onto one bucket.
- A client-visible distinction between "JWKS unreachable" and "`kid` not found". Both are
  `auth_unavailable`; the app does the same thing for either.
- Making `optionalAuth` routes fail closed on a bad bearer. They still proceed unauthenticated, as
  before. Separate design if ever wanted.
- A negative cache on failed JWKS refreshes. During an Auth0 outage every bearer request past the
  10-minute cache age pays one 3 s attempt before succeeding on the stale set (concurrent requests
  share the fetch). Bounded and acceptable for now; revisit if it shows up in latency.

## Open question for review

Should `isUsableAccessToken` also be applied to the **id** token before `handleSqliteKeyFromJwt`?
That path already returns `null` on a non-JWT and logs an error, so it fails safe today, and ID tokens
are always JWTs by the OIDC spec. Left out to keep the change to access tokens only.

## Review findings (2026-09-10)

Recorded so the reasoning survives the edits above.

1. **Section 2 as drafted would have ejected healthy users.** The catch-all "Invalid token" string
   covers JWKS timeouts; Loki shows 10 of those in 30 days against 8 genuine JWTInvalid lines.
   Resolved by the server-side `code` field and moving the JWKS bucket to 503.
2. **The "not settled" root cause is most likely the 2026-02-26 → 2026-04-02 gap** between the
   audience landing in `auth0.ts` and reaching `eas.json`, combined with the SDK never adding an
   audience on renewal. The draft's counter-argument depended on a ~30-day token lifetime that is
   probably the 24 h Auth0 default. Two checks listed under "Root cause" close it.
3. **The `iss` rule was dropped**: the API's issuer is env-configured with a canonical-domain default,
   and the client cannot guarantee it matches. Not needed to catch the real failure.
4. **The dedupe fingerprint was dropped**: the latch already makes the path idempotent.
5. **Monitor header access** must use AxiosHeaders' case-insensitive `get`, not bracket access.
6. **Toast copy must be i18n keys**; the existing hardcoded string is fixed in the same change.
7. **"Never interrupted" was softened** to what the deferral actually guarantees.
8. **Post-eject re-login is near-silent** because `clearSession` is not called; documented rather
   than adding Login-screen copy.
9. **API `tokenPrefix` logging** exposes most of an opaque credential; dropped from both paths.
10. **API half shipped as v1.7.0 (2026-09-10)** and its deltas were folded into Section 2 above:
    `token_invalid` as a fifth 401 code, the three code-less 401s, the ≈6.3 s bounded verification
    with retry / stale fallback / warm-up (which made the 503 bucket rare rather than merely
    relabelled), `optionalAuth` never emitting a code, and the Management API timeouts. The change
    request that recorded them is `2026-09-10-api-bearer-rejection-codes-change-request.md`.
