# App Attest assertions, device JWT persistence, and attestation degrade

**Date:** 2026-09-09
**Status:** Approved design, awaiting implementation plan
**Repos touched:** `common` (schema), `api` (routes, verification, storage), `app` (credential lifecycle, retry, UX)

## Why

On 2026-09-08 01:00–02:48 UTC a Postgres backend restart left both API replicas holding an ended
connection pool (`api` commit `9d2f7a3` fixes that separately). `POST /attest` answered 500 for 108
minutes. The app treats that as a temporary failure and retries 4× inside ~6 s, regenerating a Secure
Enclave key and doing a full Apple round trip on every attempt, then shows a full-screen "Device
Verification Failed" alert whose copy tells the user to reinstall. A support ticket from that evening
reads: *"I do not wanna redownload the app because I have my attendance on here."*

Three underlying design problems, all fixed here:

1. **The App Attest key is never persisted.** Every cold start generates and attests a new key. Apple
   rate-limits key generation (two prior incidents in the code comments), and the server's
   `device_attestations` binding logs "already claimed by a different key" on ~40 % of attestations,
   which makes strict binding impossible.
2. **The device JWT is memory-only**, so every cold start pays a multi-second attestation and every
   attestation outage is a cold-start outage.
3. **Temporary failures block the app** behind a modal, even though attendance is local SQLite and works
   offline.

## Decisions already made

- **Rebind policy: A.** A valid full attestation for a device id already bound to a different key
  rebinds unconditionally and logs the swap. Attestation proves "genuine app on genuine hardware"; the
  binding buys identity continuity, not access control. Assertions with an unknown key are rejected.
- **Scope: the full package** — assertion flow, JWT persistence, split retry loop, degrade-instead-of-
  block, and alert copy, as one spec and one app OTA.
- **Nonce: stateless HMAC**, not Redis. The auth path must not gain a dependency.

## Section 1 — Server protocol and storage

Three public routes under `/attest`, rate-limited by IP (they run before any device token exists).

### `GET /attest/challenge?deviceId=<id>`

Returns `{ nonce: string, expiresAt: number }`.

`nonce = base64url( deviceId + "." + exp + "." + HMAC-SHA256(secret, deviceId + "." + exp) )` where
`exp` is Unix ms, now + 5 minutes, and `secret` is `config.attestation.jwtSecret`. Any replica can
verify it with no storage. The client never inspects `expiresAt`; it uses the nonce immediately.

### `POST /attest` (full attestation)

Body: `{ token, platform, deviceId, keyId?, nonce? }`.

1. If `nonce` is present: verify signature, expiry, and that its device id equals `deviceId`; reject
   with 400 `bad_nonce` otherwise. Use the nonce as the attestation challenge.
2. If `nonce` is absent (**legacy client**, app ≤ 4.8.0-3): use `deviceId` as the challenge, exactly
   today's behaviour, and log `legacy_challenge`. This keeps old installs working so the API can ship
   first. Remove in a later API release once Loki shows the count at zero for a week.
3. iOS: `verifyAttestation` from node-app-attest returns `{ keyId, publicKey }`. Android: Play
   Integrity verdict as today, plus, when a nonce was supplied, require
   `tokenPayloadExternal.requestDetails.requestHash` to equal the nonce the client passed to
   `requestIntegrityCheckAsync` (403 `attestation_failed` otherwise). Legacy clients pass the device
   id there, so the check is skipped on the legacy path.
4. Upsert `device_attestations` for `deviceId`: set `key_id`, `public_key` (PEM, iOS only, empty for
   Android), `assert_counter = 0`, bump `attest_count`, `last_seen`. If the row existed with a
   different `key_id`, log `Attest: device rebound` with both key prefixes. Never reject on conflict —
   `ATTESTATION_STRICT_BINDING` and the conflict branch in `claim()` are removed.
5. Mint the device JWT (unchanged: HS256, 7 days, `deviceId` + `platform` claims).

### `POST /attest/assert` (iOS only)

Body: `{ deviceId, keyId, nonce, assertion }`.

1. Verify the nonce as above.
2. Load the row for `deviceId`. Require `platform === "ios"`, `key_id === keyId`, non-empty
   `public_key`. Otherwise 403 `assert_rejected`.
3. `verifyAssertion` from node-app-attest with the stored public key, the nonce as the client data,
   the app id (`teamId.bundleId`), and the stored counter. Require the presented counter to be strictly
   greater than stored. Any failure → 403 `assert_rejected`.
4. Save the new counter and `last_seen`. Mint the device JWT.

`assert_rejected` is the one signal the client acts on structurally: it means "your key is not the
one we know, do a full attestation." It is never surfaced to the user.

### Storage

`device_attestations` gains two columns, defined in the common repo's JSON model and regenerated into
Drizzle + a migration:

| column          | type    | default | notes                                   |
| --------------- | ------- | ------- | --------------------------------------- |
| `public_key`    | text    | `''`    | PEM SPKI from `verifyAttestation`, iOS |
| `assert_counter`| integer | `0`     | last accepted App Attest counter       |

`DeviceAttestationRepository.claim()` becomes `bind()` (unconditional upsert returning whether the key
changed) plus `recordAssertion(deviceId, counter, nowMs)`. Both get tests in common.

Rows written before this change have `key_id` but empty `public_key`; their next `/attest/assert` is
rejected, the client falls back to a full attestation, and the row is completed. No backfill.

## Section 2 — Client credential lifecycle

Two credentials persist in `expo-secure-store` via `app/services/auth/secureStorage.ts` helpers:

| key                       | platforms     | written                                  | cleared                                                |
| ------------------------- | ------------- | ---------------------------------------- | ------------------------------------------------------ |
| `device_jwt_v1`           | ios, android  | every successful mint (`{ jwt, expiresAt }`) | 403 from `/attest/assert` or from `/attest`; never on transient errors |
| `app_attest_key_id_v1`    | ios           | once, after a successful full attestation | `assert_rejected`, or the OS throwing `invalidKey`     |

Neither is touched by sign-out, account switch, or `clearAllSecureData()` — the device credential is
per install, not per user.

### Cold start decision tree

Lives in `app/services/attestation/deviceToken.ts`; the decisions are extracted to a pure,
vitest-covered `deviceTokenLogic.ts` with no runtime `@/` imports (same split as
`tokenFreshnessLogic.ts`).

1. **Stored JWT with more than `DEVICE_JWT_SKEW_MS` remaining** → load into module state, mark the lane
   initialized, done. No network.
2. **iOS with a stored key id** → `GET /attest/challenge`, `AppIntegrity.generateAssertionAsync(keyId,
   nonce)`, `POST /attest/assert`. Success → persist JWT. `assert_rejected` or `invalidKey` → drop the
   key id, go to 3. Temporary error → go to 4.
3. **No key (first iOS launch, Android always)** → challenge, `generateKeyAsync` + `attestKeyAsync`
   (iOS) or `requestIntegrityCheckAsync(nonce)` (Android), `POST /attest`. Success → persist key id
   (iOS) and JWT. 403/400 → permanent failure (Section 3). Temporary → 4.
4. **Temporary failure** → retry ladder, then degrade (Section 3).

The 5-minute-skew refresher in `tokenFreshness.ts` and the foreground warm-up in `app.tsx` call the
same entry point, so a warm session refreshes with one assertion. `generateAssertion()` in
`services/attestation/index.ts` (currently unused) becomes the assertion primitive. The
`deviceAuthInitialized` one-way latch and the refresher's 30 s → 15 min backoff are unchanged.

Web and simulators keep `setApiKeyFallback()` exactly as today.

## Section 3 — Retry, degrade, and alerts

### Split retry loop

Key generation and Apple attestation happen **at most once per cold start**. Only the three network
exchanges retry, on a 2 s / 5 s / 10 s / 20 s ladder (4 retries, ≈ 37 s worst case), and only for
temporary kinds: `timeout`, `cannot-connect`, `server`, `unknown`. A 4xx stops immediately. The same
attestation object or assertion is re-sent on each retry; Apple is never contacted again.

### Degrade instead of block

When the ladder is exhausted on a temporary failure, `initializeDeviceAuthorization()` returns
normally: no device token in module state, lane marked initialized, app renders. Requests go out with
no `X-Device-Token`, receive clean 401s, and the API-dependent features already self-disable through
the existing `maintenanceMode` gates. A new `ConfigStore.deviceAuthDegraded` boolean (volatile, not
persisted) drives a third `MaintenanceBanner` variant, "Connecting to RecoverySky…", ordered below
offline and above maintenance. The device refresher's existing backoff keeps retrying; the first
successful mint clears the flag. Local attendance, journal export, reminders list, and the timer all
work throughout.

### What still blocks

Two cases keep the full-screen alert with Retry (full reload) and Close:

- `UNSUPPORTED` — the device cannot attest at all.
- A 403 or 401 from `POST /attest` — bundle/team mismatch, tampered app, or a failed Play verdict.

CHANGED 2026-09-09 (final review): every other non-temporary response to `POST /attest` degrades
instead — a 400 (`bad_nonce`, e.g. Apple's `attestKeyAsync` stalling past the nonce TTL) and a 429
from the routes' per-IP rate limiter are protocol outcomes, not verdicts about the device, and a
carrier-NAT or campus population can trip the limiter through no fault of its own.

Both messages drop the "reinstall the app" sentence and gain: "Your attendance records stay on this
device." This is a nine-locale change; the eight non-English files ship the English text as a
placeholder and go on the translation review queue.

## Section 4 — Edge cases

- **Counter regression** (backup restored onto another device sharing a Keychain): assert is
  rejected, client drops the key id, full attestation rebinds with counter 0. One extra round trip.
- **Nonce clock skew**: server time only; the client never compares `expiresAt` to its own clock.
- **Stored JWT from a rotated server secret** (CHANGED 2026-09-09, final review — the original
  "bounded by the skew" claim was wrong): the JWT is now persisted, and there is no reactive 401 path
  (CLAUDE.md, "Auth, Attestation & Encryption Keys"), so nothing tells the client its token is dead.
  Every device 401s until the JWT's own expiry — up to 7 days — and relaunching re-hydrates the same
  dead JWT rather than re-minting, which is the escape hatch that existed before this branch. The
  remedy for a rotated `DEVICE_JWT_SECRET` or a server-side device revocation is therefore an app OTA
  that bumps the SecureStore key `device_jwt_v1` → `device_jwt_v2`, which makes every client miss the
  fast path and re-attest; the API runbook for secret rotation must say so. A narrow reactive path
  (on a 401 while holding a device JWT, mark it near-expiry so the refresher asserts) is the proper
  fix and is a follow-up, not part of this OTA.
- **iOS reinstall**: SecureStore normally survives, so the key id is still present and the assertion
  works. If the Keychain was wiped, step 2 is rejected and step 3 rebinds. Invisible to the user.
- **Android**: JWT persistence and the nonce as request hash only. Token provider still warmed once per
  process by `preparePlayIntegrity()`.
- **Legacy clients** (≤ 4.8.0-3) keep working through the missing-nonce fallback in `/attest`.

## Section 5 — Testing

**common**: repository tests for `bind()` (insert, same-key update, rebind returns `changed: true`)
and `recordAssertion()`.

**api** (vitest): nonce sign/verify (valid, expired, wrong device, tampered); `/attest/assert` with a
fixture P-256 keypair driving node-app-attest's pure `verifyAssertion` (accept, wrong key, stale
counter, missing public key); `/attest` rebind logging and the legacy-challenge fallback.

**app** (vitest): `deviceTokenLogic.ts` — the decision tree (stored JWT fresh / stale, key present /
absent, `assert_rejected` fallthrough), retry classification, and alert selection. `app/services/api`
gains typed `getAttestChallenge()` and `assertAttestation()` methods; no test, same as
`verifyAttestation()`.

**Manual checklist** (append to `docs/PRODUCTION_CHECKLIST.md`):

1. Fresh install on a physical iPhone: Loki shows `challenge → attest (full) → complete`; SecureStore
   holds key id and JWT.
2. Kill and relaunch inside 7 days: no attestation log lines at all.
3. Force JWT expiry (dev toggle sets `expiresAt` to now): relaunch shows `challenge → assert →
   complete`, no `generateKeyAsync`.
4. Delete the key id from SecureStore: relaunch shows `assert_rejected → attest (full) → complete`,
   API logs `device rebound`.
5. Point a dev build at a dead API URL with a stale JWT: app opens, banner reads "Connecting to
   RecoverySky…", attendance screen works; restore the URL, banner clears within the backoff window.
6. Android physical device: steps 1, 2, and 5.

## Rollout order

1. **common** release with the two columns and repository methods. CHANGED 2026-09-09: this step
   originally read "migration applied by the API on deploy as usual", which is wrong — the API runs
   none of common's migrations. Before deploying API 1.6.0, push the schema from the **common** repo
   with `pnpm drizzle:migrate:prod` (drizzle-kit push against production) and confirm
   `device_attestations` has `public_key` and `assert_counter`. Until that lands, every
   `POST /attest` 500s for every client, old and new.
2. **api** tag and deploy. Accepts both legacy and new clients from this point.
3. **app** OTA. JS-only (SecureStore and `@expo/app-integrity` are already native dependencies) — do
   **not** bump `runtimeVersion`.

Any other order locks real users out.

## Out of scope

- Moving the challenge to per-request assertions on sensitive routes (Apple's "assert every request"
  model). The device JWT remains the per-request credential.
- Removing the legacy-challenge fallback; that is its own small API release later.
- Fixing `resetPool()`'s null window (tracked separately in the API).
