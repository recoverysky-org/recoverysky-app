# RecoverySky support knowledge base: sign-in, email verification, account linking

This knowledge base is for technical support staff. It covers the problems people have signing in to the RecoverySky app, confirming their email address, and ending up in the wrong or an empty account. You are expected to use the Auth0 dashboard and Management API, query Loki and Tempo, and read Postmark activity.

It describes the world **after** the production rollout (passwordless email code, password form, Google, Apple, email verification, automatic and explicit account linking all live on prod). Users on old store builds behave differently; each doc has a short "Old app versions" note where it matters.

**Pending decision (D5).** For a user who mistyped their address and now hits `email_in_use` on the mandatory verify screen, the support fix is to correct the address in the Auth0 dashboard. That is marked "Pending Jenova's decision on the in-app path" because decision 1 of the email-verification device pass (see `docs/superpowers/specs/2026-09-30-legacy-email-verification-design.md`) is still open.

## How to use these docs

1. **Diagnose first, reply second.** Find the symptom in the table below, open the problem doc, run its Diagnose checks, and only then pick a cause.
2. Fix it with the Solution steps for that cause.
3. Send the matching reply from `replies/` (same file name as the problem). Replies use plain language and no internal terms. Problem docs hold the internal detail.
4. If the Escalate section applies, hand it to engineering with the listed attachments.

## Privacy rule for support

Logs carry `hashUserId(sub)` only. **Never paste a user's email address or raw Auth0 `sub` into a ticket, a Loki query, a chat or a log.** Compute the hash locally (see [tools](reference/tools.md#hash-an-auth0-sub-into-the-log-userid)) and use the 16-character hash everywhere outside the Auth0 dashboard. Sentry and Umami do receive the raw sub; treat them as personal data too.

## Symptom to problem doc

| What the user says | Problem doc |
| --- | --- |
| "I never got the code" / "the email with my code doesn't arrive" | [no-code-email](problems/no-code-email.md) |
| "It says the code is wrong or expired" | [code-rejected-or-expired](problems/code-rejected-or-expired.md) |
| "It says I'm signed in with the wrong account" / "this phone belongs to another account" | [wrong-account-screen](problems/wrong-account-screen.md) |
| "It keeps asking me to verify my email and won't go away" | [verify-screen-wont-go-away](problems/verify-screen-wont-go-away.md) |
| "I typed my email wrong and now I'm locked out" / "this email is already in use" | [mistyped-email-locked-out](problems/mistyped-email-locked-out.md) |
| "I changed my email but the app still shows the old one" | [email-change-not-showing](problems/email-change-not-showing.md) |
| "I signed in and my account is empty" / "it made a new account" | [empty-account-after-sign-in](problems/empty-account-after-sign-in.md) |
| "I got a new phone and my data is gone" | [data-missing-after-new-phone](problems/data-missing-after-new-phone.md) |
| "I forgot my password" / "I'm on an old version of the app" | [forgot-password-or-old-app](problems/forgot-password-or-old-app.md) |
| "The app signed me out by itself" | [signed-out-unexpectedly](problems/signed-out-unexpectedly.md) |
| "Google or Apple sign-in just hangs" | [sign-in-hangs-google-apple](problems/sign-in-hangs-google-apple.md) |
| "Delete my account" / "delete my data from your servers" | [delete-my-account](problems/delete-my-account.md) |

## Reference

- [Sign-in methods](reference/sign-in-methods.md): email code, password, Google, Apple.
- [Account linking](reference/account-linking.md): automatic linking, the wrong-account rescue, what does and does not move.
- [Device owner](reference/device-owner.md): the one-account-per-install rule.
- [Email verification](reference/email-verification.md): who is asked, skips, mandatory day, error copy.
- [Tools](reference/tools.md): Auth0 dashboard and Management API, hashing a sub, Loki, Tempo, Postmark, what is never logged.

## Glossary

| Term | Meaning |
| --- | --- |
| sub | Auth0's user id, written `provider\|id` (for example `auth0\|65f0000000000000000000aa`). The provider is `auth0` (password), `email` (code), `google-oauth2` or `apple`. Personal data: do not paste it. |
| primary account | After linking, one Auth0 user holds several identities. The primary is the user whose sub every login now returns. The automatic link picks the oldest same-email account whose root identity is `auth0`, `google-oauth2` or `apple`. After the wrong-account rescue link, the primary is the device owner's account. |
| identity | One sign-in method attached to an Auth0 user (its `identities` array). `identities[0]` is the root identity. |
| connection | The Auth0 connection a login came through: `Username-Password-Authentication`, `email`, `google-oauth2`, `apple`. |
| owner | The one account whose local data an app install holds (`ownerSub`). It survives sign-out and is cleared only by Settings, Delete User Data or the "Reset local data" button on the "Can't unlock your local data" screen (a reinstall starts a new install with no owner). A different account signing in gets the wrong-account screen. |
| hash | The first 16 hex characters of the SHA-512 of the sub. This is the `userId` on every log line. |
| `loginMethod` | How the current app session was established: `email`, `apple` or `google`. It is **undefined** for a password sign-in and for a session restored by an old build. The verify-email screen is only shown to sessions with no `loginMethod`. |
| Hide My Email | Apple's relay address (`...@privaterelay.appleid.com`). It never matches the user's real address, so automatic linking cannot match it. |

## Sources

- `docs/DIAGNOSTICS.md`
- `app/utils/logger/hashUserId.ts`
- `app/services/auth/emailVerifyLogic.ts`
- `auth0/README.md`
- `auth0/actions/meetingmaker/link-passwordless-identity.js`
- `docs/superpowers/plans/2026-10-02-support-knowledge-base.md` (decisions D1 to D6)
