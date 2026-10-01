# Legacy email verification (password accounts with a bad address)

Written 2026-09-30. Status: approved 2026-10-01 (sections 3–5 revised the same day after review). Ships in the **same OTA** as passwordless
sign-in (spec `2026-09-12-passwordless-login-design.md`); the API half deploys first.

## 1. Problem

Passwordless sign-in finds an account by its email address. A legacy password account whose
address is a typo or a dead mailbox can't be reached that way:

- Typing the **real** address creates a new, empty account. The Link passwordless identity Action
  only links when the address equals the old account's email, which is the typo.
- Typing the **typo'd** address sends the code to a mailbox nobody reads.
- The wrong-account screen has the same hole: for a password owner it offers only "send a code to
  the owner's email".

These users lose their attendance history and their subscription at the next sign-out, reinstall
or new phone. The OTA itself signs nobody out (the live build has no owner record, so the first
launch adopts the restored session: `decideOwnership` → `adopt`), which is the window to fix the
address while the user is still signed in.

New accounts can't get into this state under passwordless: sign-in doesn't finish without
receiving the code.

## 2. What we build

1. **Verify-email screen** (app). Shown to signed-in password accounts whose email isn't verified.
   The user confirms the address with a code, or changes it to one they can read.
2. **Two API endpoints** that send the code and, on a match, set the account's email in Auth0 and
   mark it verified.
3. **"Sign in with your password"** on Login and on the wrong-account screen, for people who are
   already locked out. Once in, they hit the verify-email screen.

Not built: any automatic merge of two accounts. If the new address already belongs to another
account, the API refuses and the user is sent to support.

## 3. Who sees the verify-email screen

All of these must hold (pure `needsEmailVerification`, `emailVerifyLogic.ts`):

- The signed-in account's sub starts with `auth0|` (a password account).
- The ID token's `email_verified` claim is not `true`. The app already requests the `email` scope,
  so the claim is there.
- This install hasn't recorded a successful verification for that account. The local record wins
  over the claim: a cold start can restore a cached ID token that still says unverified.
- The session was **not** started by an email code (`loginMethod !== "email"`). Someone who signed
  in with a code has just proved the inbox, even though the token for a linked password account
  still carries the password identity's unverified flag (decided 2026-10-01).

Verified password accounts, Google and Apple never see it (decided 2026-09-30: a verified address
has access, even though a verified mailbox can later go dead; those users have the password link
and support).

The claim is read in `useAuth0Wrapper`'s `[user]` sync effect for an accepted session and kept on
`AuthenticationStore` as a persisted `emailVerified` flag, because the ID token itself is volatile.

## 4. When it shows, and skipping

Decided 2026-09-30; raised on 2026-10-01 from two skips to six, so a user gets a full week:

| Showing | Behaviour |
|---|---|
| 1 to 6 | Skippable. "Not now", a warning that verification is required, and the count: "Skips left: N" (6 on the first showing, 1 on the sixth). |
| 7 and after | Mandatory. No skip. Verify, or contact support@recoverysky.app. |

- At most **one showing per local day** the app is used. So the mandatory showing lands on the
  seventh day of use at the earliest.
- Once mandatory, it shows on every launch until verified.
- The counter is per install and per account (MMKV, keyed by the hashed sub): `count`, `lastDay`.
  A showing is counted when the screen is displayed, not when "Not now" is tapped, so killing the
  app doesn't dodge the count.
- Pure `decideVerifyPrompt({ count, lastDay, today })` → `"hidden"`, `"skippable"` (with the skips left) or `"mandatory"`.

It is checked at three moments (revised 2026-10-01: this is urgent, so a returning user is asked
on the day they come back, not at the next cold start):

- **App start.**
- **Every return to the foreground.** Backgrounded yesterday, opened today → it shows.
- **Right after a sign-in.** In practice only the password link (section 7) leads here, since a
  code session is excluded above.

It never interrupts work in progress:

- It is deferred while an attendance timer is running (`isTimerSessionActive()`), and during
  onboarding.
- It is not shown, and not counted, while offline, in maintenance or in outage mode. The API can't
  send a code then, and a mandatory screen with no way to pass would lock a user out of meetings.

## 5. The screen

`VerifyEmailGate.tsx` (observer shell, in `app/components/`) + `VerifyEmailView.tsx`
(presentational, jest-covered), the same split as `WrongAccountScreen` / `WrongAccountView`.

**Not a navigator state** (revised 2026-10-01). It is a full-screen modal, `VerifyEmailGate`,
mounted beside `AnnouncementGate` in `app.tsx` and built the same way (check on mount and on each
foreground). Because it can now appear mid-session, a navigator swap would unmount Main and lose
whatever the user had open; a modal leaves every screen mounted underneath. The two gates share a
tiny "one overlay at a time" lock (`overlayGate.ts`), so an announcement and this screen never
present together. On the mandatory showing, Android's back button does nothing.

**Steps:**

1. **Review.**
   - Heading: "Please review and verify your email address".
   - The account's email, shown in full (it's their own address on their own device, and the point
     is to eyeball it).
   - **Send code** button.
   - "Not my email? Change it" link → step 3.
   - "Not now" (showings 1–6) with the required-warning line and "Skips left: N"; on the
     mandatory showing, the support line instead.
2. **Code.** Six digits, auto-submit, **Resend after 60 s** (`resendWaitSeconds`, as on Login).
   Errors on one strip, live-region, as on `WrongAccountScreen`.
3. **Change email.** One email field → sends a code to the new address → step 2.

**On every step:** a link "Why is verification required?" that opens
`https://www.recoverysky.org/post/8/recoverysky-required-email-verification` in the browser
(`Linking.openURL`; the URL lives in one constant).

**On success:** set `emailVerified`, update `ownerEmail` / `authEmail` to the verified address,
push the address to RevenueCat's `$email` through the existing path, log
`Email verified` with `changed: true|false` (never the address), and leave the screen.

All strings go in the nine locale files. Every control carries VoiceOver/TalkBack props.

## 6. API (api repo)

Both routes live in `src/routes/auth0.ts`, behind `authenticateSignedIn`, with their own limiter
(`auth0-email`). Both refuse a caller whose sub isn't `auth0|` (`not_password_account`): Auth0
can't change a Google or Apple address.

### `POST /auth0/email/start` `{ email }`

1. Validate the address.
2. If it belongs to any **other** Auth0 user (`users-by-email`), answer 409 `email_in_use`.
3. Generate a 6-digit code (crypto random). Store in Redis under the caller's hashed sub: the
   lowercased address, a hash of the code, and an attempt count. TTL 10 minutes. A new start
   replaces the previous code.
4. Send it with the existing mailer (`services/email.ts`, Postmark). Subject:
   "`<code>` is your RecoverySky verification code".
5. Answer 200 with nothing identifying.

Limits: 3 per minute, 10 per hour per user. Redis or mailer down → 503 (the app shows a retry).

### `POST /auth0/email/verify` `{ email, code }`

1. Load the stored record. Missing or expired → 400 `code_expired`. Address differs → 400
   `invalid_code`.
2. Compare in constant time. Wrong → count the attempt; the fifth wrong attempt deletes the record
   (`too_many_attempts`).
3. Re-check `email_in_use`.
4. Management API: `PATCH /users/{sub}` with `email`, `email_verified: true`,
   `verify_email: false` and the connection name. Same address → only the verified flag changes.
5. Delete the record. Answer 200 `{ email }`.

The sub never changes, so no server rows move and the RevenueCat customer is untouched.

**Logging:** hashed `userId` only. Never the address, never the code.

**Known trade-off:** `email_in_use` tells a signed-in caller that an address has an account. The
rate limit bounds it, and the alternative (silently accepting, then failing at verify) costs the
user a wasted code. Accepted.

## 7. Password sign-in for the locked out

- **Login:** a small link, "Can't get a code? Sign in with your password". It calls the existing
  browser path with the password connection (today's DEV button: `DEV_PASSWORD_CONNECTION`,
  renamed `PASSWORD_CONNECTION` and no longer dev-only). It goes through the same legal gate.
- **Wrong-account screen:** when the owner's sub is `auth0|`, the same link under the code prompt,
  with the owner's address as `loginHint`.
- A password session records no `loginMethod` (unchanged), so logout takes the browser branch.
- After a password sign-in, section 3 applies: unverified → the verify-email screen.

Sign-ups stay enabled on the password connection for now. A fresh install runs the embedded old
bundle on its first launch, and that bundle signs up through Universal Login. Any typo'd address
created that way is caught by this same screen after the OTA applies. Disabling password sign-ups
is a follow-up for the next native release.

## 8. What happens afterwards

Once the account's email is right and verified, a code sign-in with that address is linked into
the password account by the Link passwordless identity Action (it matches on the account's email
and doesn't require the flag). Verified on dev 2026-09-30 for a matching address
(`docs/AUTH_LINKING_TESTS.md` Part 1).

## 9. Failure handling

| Situation | Result |
|---|---|
| Code email never arrives | Resend after 60 s; "Not my email? Change it"; "Not now" on showings 1–6. |
| Mailer or Redis down | 503 → "try again"; the showing still counts for the day. |
| Offline / maintenance | Screen not shown, not counted. |
| New address already has an account | "This email is already in use. Contact support@recoverysky.app." |
| Wrong email **and** forgotten password | Support only: the address is changed by hand in Auth0. |
| User verifies on phone A, opens phone B | B's next token refresh carries `email_verified: true`; no screen. |

## 10. Verified on the dev tenant (2026-10-01)

On a throwaway password user on `bad-bitch-tenant`:

- One `PATCH /users/{id}` with `email`, `email_verified: true`, `verify_email: false` and the
  connection name answers 200 and returns the new address, verified.
- A `PATCH` with only `email_verified: true` also answers 200 (the same-address case).
- `users-by-email` finds the user under the new address straight away.

So the verify endpoint makes one Management call.

## 11. Testing

- **Vitest:** `emailVerifyLogic.ts` (who sees it; the showing counter across days, the mandatory
  latch, offline/timer deferral inputs). API: code generation/compare, attempt counting, the
  conflict check, the non-password refusal.
- **Jest:** `VerifyEmailView` (skippable vs mandatory, the three steps, the "why" link, a11y).
- **Manual (add to `docs/AUTH_LINKING_TESTS.md`):** password account with a typo'd address →
  OTA build → change email → verify → sign out → code sign-in with the new address lands in the
  same account. Plus: skip six times (the count goes down each day), seventh day mandatory; locked-out user via the password link.

## 12. Out of scope

- Merging two existing accounts.
- Verified-but-dead addresses.
- The email-first gaps (server rows and RevenueCat purchases under an `email|` account).
