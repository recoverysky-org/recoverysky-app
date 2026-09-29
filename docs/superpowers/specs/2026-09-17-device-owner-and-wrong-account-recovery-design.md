# Device owner record, wrong-account recovery, and identity linking

**Date:** 2026-09-17
**Status:** Spec approved; not started. Depends on spec 1
(`2026-09-12-passwordless-login-design.md`) — reuses its code step, its `loginMethod` field and
its owner-aware login button — so it lives on the same feature branch and ships after it.
Blocked, like spec 1, on Auth0 tenant access.
**Repos touched:** `app` (auth wrapper, store, navigator, new screen, i18n), `api` (one endpoint,
one config value). Tenant: nothing beyond spec 1's runbook.
**Origin:** the 2026-09-12 brainstorm on "user logs in as A, accumulates data, later logs in as
B". Spec 2 of 2.

## Why

The app is local-first: a user's attendance, reports, reminders, chat and profile live in one
encrypted SQLite file plus the MMKV root snapshot on the device. Today nothing ties that data to
the account that created it. Sign out as A, sign in as B, and B reads A's attendance; worse, the
sync service sees "a different uid signed in" and clears A's unpushed outbox rows. With three
login methods (spec 1) a wrong-button login is a normal mistake, and the person making it may be
in a fragile moment. The fix has three parts: remember who owns the device, refuse to let a
foreign session touch anything, and get the person back into their own account with one tap —
leaving a link behind so the same mistake next time resolves itself.

## Decisions (settled in the brainstorm — do not re-derive)

- **Not multi-user.** One device, one owner. There is no per-user database file, no per-user
  key, no "start fresh as B". That design was explored and rejected on 2026-09-12.
- **A foreign session can never delete, rekey, or overwrite the owner's data.** The
  wrong-account screen offers exactly two things: prove you are the owner, or Cancel. Lost
  credentials are a support matter (support@recoverysky.app). Reinstalling the app is the
  user-side reset (`allowBackup` is false on Android; iOS keeps only Keychain items, which are
  harmless without the database file).
- **Proof is a normal login as the owner.** For an email or legacy-password owner that is a
  code sent to the owner's email (spec 1's Action links a code login into a legacy `auth0|`
  account when the address matches). For a Google or Apple owner it is that provider's button.
  Social owners are never shown an email — Apple private-relay addresses mean nothing to the
  user.
- **After the owner signs back in, the foreign identity is linked into the owner's account**
  through the API, so a future login with it returns the owner's sub. This is the one place a
  link happens outside the tenant Action, because the two identities differ by email and the
  Action cannot match them.
- **B's server-side rows move to A.** Reassign, never delete: reminders are created once and
  never re-sent by the app, so deleting them would drop scheduled pushes. Rows whose uniqueness
  rule A already satisfies (push token per device, subscription per device+type) are dropped;
  everything else moves. Deliveries are per device (the sender resolves the token by uid+did), so
  a reassigned reminder still reaches the device that set it.
- **The owner record is written in one place and cleared in one place.** Written on `adopt` in
  the auth wrapper's sync effect; cleared only inside `resetLocalDatabase()`. Logout never
  touches it.
- **Anonymous sessions never own the device.** The first real sign-in adopts.

## 1. Owner record

### 1.1 Fields

Two new persisted props on `AuthenticationStore` (MMKV root snapshot, beside `deviceId`):

| prop | type | meaning |
| --- | --- | --- |
| `ownerSub` | `string \| undefined` | Auth0 `sub` of the account that owns this device's data |
| `ownerEmail` | `string \| undefined` | that account's email as reported by Auth0 at the time of stamping |

Nothing else. The owner's proof method is **derived** from the sub prefix by a pure function,
not stored — storing it would let the two drift.

`ownerEmail` is stored for every owner, including Apple/Google, but:
- it is displayed only masked (`j***@proton.me`, spec 1's `maskEmail()`), and only for the code
  path;
- for social owners it is used solely as `login_hint` to the provider's account chooser;
- it is never logged (PII — see `docs/DIAGNOSTICS.md` "Identifiers in logs").

### 1.2 Pure logic — `app/services/auth/ownerLogic.ts` (vitest, no `@/` runtime imports)

```ts
export type OwnershipDecision = "adopt" | "match" | "mismatch"
export function decideOwnership(input: {
  ownerSub: string | undefined
  sessionSub: string
  isAnonymous: boolean
}): OwnershipDecision
// anonymous → "match" (never stamps, never blocks); no owner → "adopt";
// equal → "match"; otherwise → "mismatch"

export type ProofMethod = "code" | "google" | "apple" | "unknown"
export function ownerProofMethod(sub: string): ProofMethod
// "email|", "auth0|" → "code"; "google-oauth2|" → "google"; "apple|" → "apple"; else "unknown"
```

`auth0|` maps to `code` on purpose: spec 1's post-login Action links an `email|` login into the
legacy password account whenever the addresses match, so a code sent to `ownerEmail` returns the
owner's sub. `unknown` (a connection we have not seen) renders the code path if `ownerEmail` is
present and otherwise only Cancel — it should never happen and is logged at `warn`.

`match` is also the outcome after a successful link: Auth0 returns the primary's sub for either
identity from then on.

### 1.3 Stamping

- **Normal:** the auth wrapper's sync effect (§2.1) calls `decideOwnership`; on `adopt` it sets
  `ownerSub` / `ownerEmail` from the session and continues. Covers a fresh install and an
  upgraded install that was signed out when the OTA landed (the next account to sign in adopts,
  once — today's exposure, one last time, then closed).
- **Upgrade, signed in:** `setupRootStore` (cold-start hydration) stamps from the persisted
  `userId` / `authEmail` when `ownerSub` is empty and `userId` is present, before any reaction
  runs. A returning user never sees the wrong-account screen because of the upgrade itself.
- **Anonymous:** `loginAnonymously()` never stamps.

### 1.4 Clearing

`app/db/resetLocalDatabase.ts` is the single teardown for the file and the key (RS-024,
2026-09-14), reached from Settings → Delete User Data and from the database overlay's
**Reset local data** when the key is unusable. It gains one line: clear `ownerSub` /
`ownerEmail`. A record pointing at data that no longer exists would show the wrong-account screen
over an empty database. There is no other clear path; Settings → Delete User Data is inside
`Main`, which only the owner can reach.

## 2. The gate and the wrong-account screen

### 2.1 Gate — `useAuth0Wrapper.ts`, `syncUserToStore`

After `getCredentials()` and the `isUsableAccessToken` check, **before** the lines that call
`setTokens`, `setProp("isAnonymous", false)` and `setUserId`:

```ts
const decision = decideOwnership({ ownerSub: authStore.ownerSub, sessionSub: user.sub, isAnonymous: authStore.isAnonymous })
if (decision === "mismatch") {
  authStore.setForeignSession({ sub: user.sub, email: user.email, idToken: credentials.idToken, loginMethod })
  authStore.setAuthReady()               // the splash must never wait on a session we are refusing
  log.warn("Foreign session on an owned device", { ownerId: hashUserId(authStore.ownerSub), sessionId: hashUserId(user.sub) })
  return                                  // nothing below runs: no tokens, no userId, no SecureStore copy
}
if (decision === "adopt") authStore.setOwner(user.sub, user.email)
```

`foreignSession` is a **volatile** field on `AuthenticationStore` (`{ sub, email, idToken,
loginMethod }`); it is never persisted. Its `loginMethod` comes from a `pendingLoginMethodRef`
that the wrapper's three entry points (`sendCode`/`verifyCode` → `email`, `loginWithProvider` →
by connection) set before calling the SDK — **not** from the store's persisted `loginMethod`,
which spec 1 writes only when a session is accepted (move that write into the `match`/`adopt`
path). On a cold-start restore of B there is no in-flight call, the ref is empty, and the
foreign session's method is `undefined`: every consumer treats `undefined` as "browser possible"
and clears the browser session (§2.3, §2.4) — a harmless extra hop, never a leaked cookie. Because no access token is written, `isAuthenticated`
stays false, and every identity-driven consumer — the sync outbox handover
(`takeQueueOwnership`), RevenueCat `login`, push registration, logger/Sentry/Umami identity —
keys off the store and never learns B existed. The sync service's own owner check stays as
belt-and-braces; this gate is what makes it never fire.

The SDK has already saved B's credentials in its CredentialsManager (its `loginFlow` does that
before `user` is set). That is fine: a cold start restores B, hits the same gate, shows the same
screen. Our own SecureStore copy (`saveAuthCredentials`) is deliberately **not** written for a
foreign session, so hydration never carries B's tokens.

### 2.2 Routing — `AppNavigator.tsx`

The unauthenticated branch becomes:

```tsx
: authStore.foreignSession ? (
  <Stack.Screen name="WrongAccount" component={WrongAccountScreen} />
) : (
  <Stack.Screen name="Login" component={LoginScreen} />
)
```

`AppNavigator` is already an observer. The authenticated branch is untouched. Add `WrongAccount`
to `navigationTypes.ts` (no params).

### 2.3 `WrongAccountScreen` (`app/screens/WrongAccountScreen.tsx`, jest-covered)

Presentational apart from two store reads (`ownerSub`, `ownerEmail`, `foreignSession.loginMethod`)
and three wrapper calls. No network, no SDK access of its own.

- **Copy:** title `wrongAccountScreen:title` — "This device is set up for a different RecoverySky
  account." Body `wrongAccountScreen:body` — "Sign in to that account to continue. Your meetings
  and records are safe." Footer `wrongAccountScreen:support` — "If you can't sign in to that
  account, contact support@recoverysky.app." Nothing identifies the owner beyond what the proof
  control needs.
- **Proof control**, chosen by `ownerProofMethod(ownerSub)`:
  - `code`: spec 1's owner-aware button, "Send code to j***@proton.me" (`testID="wrong-account-send-code"`).
    Tapping it calls `sendCode(ownerEmail)` and renders spec 1's `CodeStep` in place (Resend,
    cooldown, error handling all inherited). Verify calls `verifyCode(ownerEmail, code)`.
  - `google` / `apple`: one button, "Sign in with Google" / "Sign in with Apple"
    (`testID="wrong-account-provider"`). Tapping it calls `loginWithProvider(connection,
    { loginHint: ownerEmail, clearBrowserSessionFirst: foreignSession.loginMethod !== "email" })`.
- **Cancel** (`testID="wrong-account-cancel"`): calls `abandonForeignSession()` (§2.4).
- Accessibility: the title is the screen's `accessibilityRole="header"`; every control carries a
  label; the masked email is read as typed (VoiceOver spells the asterisks, which is acceptable).

**The cookie trap.** If B arrived through the browser, Auth0's session cookie still holds B, and
tapping Google to reach A would silently come back as B. So both the provider button and Cancel
clear the browser session first when `foreignSession.loginMethod !== "email"` (which includes
`undefined`, the cold-start case). Two browser hops on a rare path is the accepted cost. `login_hint` makes the provider's chooser land on A's account.

### 2.4 Wrapper additions

- `loginWithProvider` gains an options object: `{ loginHint?: string,
  clearBrowserSessionFirst?: boolean }`. `loginHint` goes into `additionalParameters.login_hint`;
  `clearBrowserSessionFirst` runs `clearSession()` (browser) before `authorize`, swallowing
  `USER_CANCELLED` on the clear as "proceed anyway".
- `abandonForeignSession()`: if `foreignSession.loginMethod !== "email"` → `clearSession()` (browser
  logout; a cancel of the iOS dialog is treated as "proceed"), then `clearCredentials()`, then
  `authStore.clearForeignSession()`. The navigator shows Login.

### 2.5 Resolution

Signing in as A runs the normal flow: the SDK overwrites its credentials with A's, sets `user`,
the sync effect fires, `decideOwnership` returns `match`, and everything proceeds exactly as a
normal login. At the **end** of the `match` branch:

```ts
const foreign = authStore.foreignSession
if (foreign && foreign.sub !== user.sub) {
  authStore.clearForeignSession()
  void linkForeignIdentity(foreign.idToken)   // §3.4 — fire-and-forget, in-session retries
}
```

If the person signs into yet another wrong account, the gate replaces `foreignSession` and the
screen stays; only the latest foreign identity is linked. B's ID token lives only in memory and
is gone on process death — the worst case is the same mismatch next time and a link then.

### 2.6 Login screen wiring (spec 1's inert props come alive)

`LoginScreen` reads the store: when `ownerProofMethod(ownerSub) === "code"` it passes
`ownerEmail` and `maskEmail(ownerEmail)` to the choose step, so a returning user on their own
device taps once and gets a code. For social owners the login screen is unchanged — three plain
buttons.

## 3. Link endpoint

### 3.1 Route

`POST /auth0/link` in `api/src/routes/auth0.ts`, beside the profile PATCH, sharing
`getManagementToken()` / `fetchAuth0()`. Middleware: `authenticateSignedIn` (A's bearer),
`createRateLimiter()`. Body (zod): `{ linkWith: string }` — a JWT-shaped string, max 8 KB.

### 3.2 Verify before touching anything

Verify `linkWith` with jose against the tenant JWKS exactly as the bearer middleware does, but
with `audience: config.auth.mobileClientId` — new config `AUTH_MOBILE_CLIENT_ID`, the Native
application's client id (the same value the app has as `EXPO_PUBLIC_AUTH0_CLIENT_ID`; a public
identifier, not a secret; **not** `AUTH_MGMT_CLIENT_ID`, which is the M2M application). A token
that fails verification → 400 `invalid_link_token`. No row moves on an unverified string.

Let `A = req.user.sub`, `B = payload.sub`.
- `B === A` → 200 `{ linked: false, reason: "same_user", moved: {} }`.
- `GET /api/v2/users/{A}` identities already contain B's `provider`+`user_id` → 200
  `{ linked: false, reason: "already_linked", moved: {} }`. (Confirm Auth0's own error for a
  duplicate link when tenant access returns — §6 — and map it to this response too.)

### 3.3 One transaction, link inside it

```
BEGIN
  sweep(B → A)                       -- §3.4
  POST /api/v2/users/{A}/identities { link_with: <verified token> }   -- via fetchAuth0
  if not ok → ROLLBACK, 502 link_failed (client may retry)
COMMIT
```

Order is deliberate: once Auth0 folds B into A, B's identity is gone and a failed sweep could
never be retried with a fresh proof; a failed link after a rolled-back sweep costs nothing.
Residual: Auth0 succeeds and COMMIT fails → log at `error` with both subs hashed and the table
counts so support can finish by hand. Rare, accepted.

### 3.4 Sweep

Seven tables carry a user id. Two groups:

| table | unique rule involving uid | action |
| --- | --- | --- |
| `attendances` | none (device-generated id) | `UPDATE SET uid = A, updated_at = now() WHERE uid = B` |
| `attendance_reports` | none | same |
| `reminders` | none (id is device-generated) | `UPDATE SET uid = A WHERE uid = B` |
| `notification_deliveries` | none | same |
| `unsubscribes` | none | same |
| `push_tokens` | `(uid, did)` | `DELETE WHERE uid = B AND EXISTS (same did under A)`, then `UPDATE` |
| `notification_subscriptions` | `(uid, did, type_id)` | `DELETE WHERE uid = B AND EXISTS (same did+type under A)`, then `UPDATE` |

The timestamp bump on attendances/reports is what makes A's devices pull them: `findChangedSince`
keys on the modified column and the pull cursor is per uid. Confirm the exact column name at
implementation.

Response: `{ linked: true, moved: { attendances, attendanceReports, reminders,
notificationDeliveries, unsubscribes, pushTokens, notificationSubscriptions } }`. In the
accidental case every count is zero.

Logging: `POST /auth0/link` lines carry `hashUserId(A)`, `hashUserId(B)` and the counts. Never
emails.

### 3.5 Client — `app/services/api/`

`api.linkIdentity(idToken: string)` → `POST /auth0/link`. Goes through the token freshness gate
like any call (A's bearer). `linkForeignIdentity()` in `app/services/auth/` wraps it:
fire-and-forget, three in-session retries with backoff on **transport** failures only (reuse
`isRetryableProblem()` from `contentRetryLogic.ts`; a 4xx ends it), logs the outcome with the two
hashed subs and the counts. Nothing persisted; on final failure the next mismatch yields a fresh
token and a fresh attempt.

### 3.6 Tenant

Spec 1's runbook already grants the Management M2M client `update:users`, which is the scope
linking needs. Nothing new.

## 4. Testing

- **Vitest, app.** `ownerLogic.test.ts`: `decideOwnership` — no owner → adopt; equal → match;
  differ → mismatch; anonymous → match regardless. `ownerProofMethod` — four prefixes + unknown.
- **Vitest, API.** `auth0.test.ts` gains: rejected ID token → 400, no DB call; `B === A` → no-op;
  already linked → no-op; full sweep with counts against mocked repos; Auth0 failing after the
  sweep → rollback asserted and 502.
- **Jest.** `WrongAccountScreen.test.tsx` with the wrapper mocked: code variant shows the masked
  email button and no provider button; google/apple variants show one provider button and no
  email text anywhere; Cancel in all three; `unknown` with no email shows Cancel only.
- **Manual checklist** (dev tenant, after spec 1's runbook):
  1. Email-owned device, sign out, sign in as a different email → screen; tap Send code → code
     step → back in as A; `/auth0/link` logs zero counts.
  2. Apple-owned device, sign in by email → screen shows "Sign in with Apple" and no email;
     Apple button → back as A; link succeeds.
  3. Google B on an email-owned device → Cancel → Login; tap Google again → account chooser
     appears (cookie cleared), does **not** silently return B.
  4. Kill the app while on the wrong-account screen → cold start shows it again.
  5. Install signed in at upgrade → owner stamped, no screen, log line `Owner stamped from
     hydration`.
  6. Install signed out at upgrade → next login adopts, no screen.
  7. Create an attendance offline as A, sign out, sign in as B → screen → Cancel → sign in as A →
     the row pushes (outbox intact; sync's account-switch clear never ran).
  8. Real B account with attendance on a second phone → link → counts > 0 → A's device pulls the
     rows on the next tick.
  9. The second phone's B session after the link (§6): either continues as A or is signed out —
     record which.
  10. Settings → Delete User Data → owner record gone; next sign-in adopts.

## 5. Rollout and paperwork

- **API first.** Endpoint + `AUTH_MOBILE_CLIENT_ID`. Harmless without the app change.
- **App:** JS-only, same feature branch as spec 1, ships as an OTA after it. **No `runtimeVersion`
  bump.**
- **i18n:** `wrongAccountScreen:{ title, body, support, sendCodeTo, signInWithGoogle,
  signInWithApple, cancel }` in all nine locales; English placeholders in eight + a line in
  `docs/translation-review-2026-08-03.md`.
- **CHANGELOG:** Added — wrong-account recovery and identity linking. Security — a session for a
  different account can no longer read the device owner's data or clear their unsynced
  attendance.
- **CLAUDE.md:** Navigation (the `WrongAccount` branch), AuthenticationStore props (`ownerSub`,
  `ownerEmail`; volatile `foreignSession`), Attendance Cloud Backup & Sync (the gate is what keeps
  a foreign session out of `takeQueueOwnership`), Database Layer (`resetLocalDatabase` also clears
  the owner record).
- **`docs/BACKUP.md`:** add the mismatch case to the manual account-switch checklist.
- **`docs/DIAGNOSTICS.md`:** the `Foreign session on an owned device` line and its hashed ids.

## 6. Verify when tenant access returns

- Auth0's exact response (status + error text) when `link_with` names an identity already linked
  to the primary — needed for the idempotent path in §3.2.
- What Auth0 does to a linked secondary's existing refresh token on another device: keeps
  working and returns the primary's sub, or is revoked. Both are fine; the manual checklist
  (item 9) records which.
- That `link_with` accepts an ID token issued to the Native application when the Management call
  is authorised by the M2M client (documented; confirm on the dev tenant).
  **ANSWERED 2026-09-28 (dev tenant): no.** Auth0 returns 400 "JWT (link_with) contains an
  invalid aud claim" — `link_with` must have `aud` equal to the Management token's `azp`. The
  API now links with `{ provider, user_id }` built from the sub its own `verifyIdToken` has
  already authenticated (api `fix/link-provider-user-id`, 369818b); the ownership proof is
  unchanged.

## Non-goals

- Multi-user devices, per-owner database files, per-owner keys.
- Any erase / start-fresh / take-over path reachable from a foreign session.
- Reactive owner change for a legitimate account switch — there isn't one; Delete User Data is
  the reset.
- Linking two pre-existing accounts that differ by email without the user proving both — the
  wrong-account screen **is** that proof; there is no other trigger.
- Migrating B's Auth0-side profile fields (name, picture) onto A. A's win.
