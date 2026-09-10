# Change request: API bearer rejection codes, JWKS resilience, Auth0 call timeouts

**Date:** 2026-09-10
**Status:** Shipped in `api` (commit `e527658`, merged to `prod` as `4e9568c`, not yet tagged or deployed)
**Amends:** `2026-09-10-opaque-access-token-after-idle-renewal-design.md`, Section 2 "API: machine-readable code on bearer 401s"

> This document targets the **app** spec above but was written from the `api` repo, where the change landed. It records what the API actually shipped, where that differs from the spec's Section 2, and what the app half must do and verify. The app half (Sections 1–3 of the spec) is **not yet implemented**; the spec file itself is still untracked in this repo.

## Why this exists

The spec's Section 2 described the API change as a small classification tweak. Implementing it surfaced that the JWKS fetch itself was the cause of the "ten cases in 30 days" the review found: jose made one 5 s attempt with no retry and no fallback, on every cold start, on every unknown key id, and every 10 minutes. The API change therefore grew beyond the spec's table. The contract the app codes against is unchanged in spirit but has one extra code, one status change already anticipated, and a behavioural guarantee the app can now rely on.

## 1. What the API now returns

Every rejection produced by `verifyToken` carries a `code`. Bodies are exactly:

```json
{ "error": "Unauthorized",       "message": "Invalid token",                    "code": "token_malformed" }
{ "error": "Unauthorized",       "message": "Token validation failed",          "code": "token_claims" }
{ "error": "Unauthorized",       "message": "Invalid token",                    "code": "token_signature" }
{ "error": "Unauthorized",       "message": "Token expired",                    "code": "token_expired" }
{ "error": "Unauthorized",       "message": "Invalid token",                    "code": "token_invalid" }
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

Two 401s carry **no** `code`, and the monitor must treat absence as "do not eject" exactly as the spec already says:

- `{"error":"Unauthorized","message":"Invalid API key"}` — an `X-API-Key` caller with a bad key.
- `{"error":"Unauthorized","message":"Missing or invalid authorization header"}` — no credential at all.

The OpenAPI `ApiError` schema now declares `code` with the six-value enum, so codegen sees it.

## 2. Deltas from the spec's Section 2

Please fold these into the spec when the app half is implemented.

1. **`token_invalid` is a new row.** The spec's table had no home for a jose error that is about the token but is none of malformed / claims / signature / expired. It is a 401 and **must not eject** — the monitor's allow-list of three codes already gives that, but the spec's table and its test list should name it.
2. **The 503 bucket is now rare by construction, not just relabelled.** The API retries a failed JWKS fetch once (two attempts of 3 s with a 250 ms pause), verifies against the last good key set when a periodic refresh fails, and warms the key set at startup. `auth_unavailable` now means "Auth0 was unreachable twice in a row from a cold container" or "the token's key id is genuinely not in the published set". The spec's argument for the 401/503 split still holds; the volume behind it should drop sharply. Re-run the Loki count from review finding 1 after the API deploys.
3. **The bearer verification is bounded at ~6.3 s worst case.** The app's 10 s client timeout was the sizing constraint. The spec's "Why not retry with a refresh first" stays correct; add that the app also has **no reason to retry a 503 `auth_unavailable` itself** — the API already did, and a client retry would double Auth0 pressure during the exact outage it is meant to survive.
4. **`tokenPrefix` is gone from both log lines, not just the failure path.** Section 4 said "consider the same on the success path". Done; for a valid JWT the prefix was the same 20 header bytes every time and carried nothing.
5. **`message` copy is unchanged for humans**, as the spec asked. Note that `token_malformed`, `token_signature` and `token_invalid` all say `Invalid token`; only `code` distinguishes them. Nothing in the app may branch on `message`.
6. **`optionalAuth` routes never emit a code.** `POST /reports/status` (the delivery poller) runs `deviceAuth` + `optionalAuth`; a bad bearer there does not 401, the request proceeds unauthenticated. The monitor will therefore never see an eject signal from the poller, only from routes that require a signed-in user (`POST /reports`, `/push-tokens`, `/reminders`, `/notifications` subscriptions, `/sync`, `/firebase`, `/storage`, `/auth0`, `/api/replyke`). This matches the incident: the tester's polls "succeeded" while the sends failed.
7. **`POST /auth0/profile` is more reliable but not more informative.** Its two Auth0 Management API calls gained a 4 s per-attempt timeout and one retry on network error, timeout, 5xx or 429. A final failure is still the route's existing 500; no new code.

## 3. What the app half must do

Unchanged from the spec, restated so this document stands alone:

- [ ] `addMonitor` on the apisauce instance: `status === 401`, request carried an `Authorization` header (read via AxiosHeaders' case-insensitive `get`), and `response.data?.code ∈ { token_malformed, token_claims, token_signature }` → `onBearerRejected()`. Any other code, a missing code, a 503, or a request with `SKIP_AUTH_GATE_HEADER` → nothing.
- [ ] 503 `auth_unavailable` flows through the existing `GeneralApiProblem` mapping as `{ kind: "server" }`. Confirm no call site turns `server` into a sign-out. Do not add a client-side retry for it (delta 3).
- [ ] `isUsableAccessToken` at the three call sites (Section 1) is still the primary defence; the server code is the backstop for a token that passes the shape check but fails on the server.
- [ ] Add `token_invalid` to the monitor's negative test list alongside `token_expired`.
- [ ] Telemetry: the `server-401` log line carries the server's `code` (Section 4).

## 4. Sequencing

Either side can ship first; both are additive.

- **API first** (recommended): older app builds see a 503 where they used to see a 401 on a JWKS failure. No shipped build acts on that 401 beyond showing the generic failure toast, so the visible behaviour is the same toast.
- **App first**: the monitor never sees a `code` from an older API and never ejects. The shape check in Section 1 still catches the incident's exact case on the device.

API release steps, for whoever cuts it:

1. `git tag v1.7.0 && git push origin v1.7.0` from `prod` at `4e9568c` or later. Merging alone deploys nothing.
2. Watch `GET /status` on `api.recoverysky.app` for the new version.
3. Changelog entry (the spec asked for one; the API repo keeps none, so it goes in the tag message or the release notes):

   > **Bearer rejections carry a machine-readable `code`; JWKS failures are 503.** A rejected access token now says why (`token_malformed`, `token_claims`, `token_signature`, `token_expired`, `token_invalid`). A bearer the server could not evaluate because Auth0's signing keys were unreachable is now `503 auth_unavailable` instead of `401 Invalid token`. The key fetch is retried once, served from the last good set on refresh failure, and warmed at startup. Auth0 Management API calls behind `POST /auth0/profile` gained a timeout and one retry. New env: `AUTH_JWKS_TIMEOUT_MS` (3000), `AUTH_MGMT_TIMEOUT_MS` (4000).

## 5. Verifying against the deployed API

Use a user-auth route with an `X-API-Key` (clears `deviceAuth`) and a deliberately opaque bearer. `authenticate` tries the bearer first, so the API key never masks the result.

```bash
curl -s -H "X-API-Key: $AUTH_KEY" \
     -H "Authorization: Bearer Xk9pQ2vL8mN4rT6wY1zA3bC5dE7fG0hJ" \
     https://api.recoverysky.app/reminders
# expect 401 {"error":"Unauthorized","message":"Invalid token","code":"token_malformed"}
```

A 401 **without** `code` means the container is still running the previous build. Do not grep `/api/openapi.json` to decide that; the status-code probe is the test.

In Loki, the rejection line now carries the code. The API's stream label is `app_api` (not the
`service` name in `/status`), and its lines are pretty-printed pino text with ANSI colour codes, so
`| json` does not parse them — use line filters:

```
{service_name="app_api"} |= "Auth: JWT verification failed" |= "auth_unavailable"
```

`auth_unavailable` lines are logged at **warn** (every other code is debug), so that filter is the
ongoing count that replaces review finding 1's manual tally. Strip `\e[..m` before grouping by
anything.

## 6. Not changed, deliberately

- No rate limiter on the auth path. See the `/attest` note in the API's `CLAUDE.md`: the API cannot see real client IPs, so a limiter here would collapse every device onto one bucket.
- No client-visible distinction between "JWKS unreachable" and "key id not found". Both are `auth_unavailable`; the app does the same thing for either.
- Bearer verification on `optionalAuth` routes still fails open to "unauthenticated", as before (delta 6). Changing that is a separate design.
