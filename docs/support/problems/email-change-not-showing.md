# "I changed my email but the app still shows the old one"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email or raw sub into a ticket, a Loki query or a log. Examples are fake (`user@example.com`, `typo@exmaple.com`).

Background: [email verification](../reference/email-verification.md#what-a-successful-verify-does), [account linking](../reference/account-linking.md#settings-account).

## Symptoms

- "I fixed my address on the verify screen, but Settings still shows the old one."
- "My reports still go to the old address." (the address the app holds, see Diagnose 4)
- "Settings > Account shows a different address from the one I typed."
- "It came back to the old address after I restarted the app."
- "On my other phone it still shows the typo."

## Diagnose

1. **What did the user change, and where?** Three ways an address can change:
   - On the verify-email screen (password accounts only): the API updates the Auth0 profile.
   - By support in the Auth0 dashboard ([mistyped-email-locked-out](mistyped-email-locked-out.md)).
   - By the user signing in with a different method (a code to a new address, Google, Apple), which does **not** change the old account's address.
2. **What does Auth0 say the account's email is now?** Dashboard, User Management, Users, open the user. Read **Email** and **Email verified**, and **Identities**. Or `GET /api/v2/users/{sub}` and read `email`. For a linked account the primary user's address is what tokens carry; a linked `email` identity keeps the address that was typed at the code login.
3. **Did the verify succeed?**
   ```
   {service_name="recoverysky-app", module="VerifyEmailGate"} |= "Email verified" | userId="<hash>"
   {service_name="recoverysky-app", module="VerifyEmailGate"} |= "Credential renewal after verify failed" | userId="<hash>"
   {service_name="app_api"} |= "POST /auth0/email/verify: email verified" |= "<hash>"
   ```
   `changed` on `Email verified` / the API line says whether the address actually changed (`true`) or was only confirmed (`false`). If `changed=false`, the address was not changed; the user confirmed the old one.
4. **Which address is the user looking at?** These come from different places:
   | Where | Source |
   | --- | --- |
   | Settings, Account rows | The ID token's identities claim (and the token's address). Refilled at each sign-in or refresh; not persisted. |
   | The address the app holds as the account's (`authEmail`: used for report sends and RevenueCat's `$email`) | Set from the token at each sign-in and cold start; set directly after a successful verify. |
   | "Send code to {{email}}" on Login / the wrong-account screen | The device owner's stored address: the address typed at the last code sign-in, or the new address after a verify if this account is the device owner. |
5. **Is the token stale?** After a verify the app forces a credential renewal so the cached ID token carries the new address. If that failed (WARN `Credential renewal after verify failed`) the cached token still has the old address, and **the next cold start writes the old (typo) address back over the app's stored address** until a natural renewal. Settings can show the old address then.
6. **Did the user verify on a different phone?** Phone B's token keeps the old address until its next refresh or sign-in.

## Causes

### 1. The Auth0 account did change, but this phone's cached ID token has not renewed
The token carries claims at the time it was issued. The renewal after verify is fire-and-forget; if it failed, the old address lingers until the next natural renewal (a hedge: the timing depends on the tenant's token lifetimes). The local "verified" record means the verify screen does not come back, but addresses can revert on a cold start.

### 2. The change was made on another phone
The other install has not refreshed its token. Its own local record and skip count are independent.

### 3. The verify only confirmed the address (`changed=false`)
The user pressed "Send code" on the review step without changing the address. The mail went to the old (still-working) address.

### 4. The change was in Auth0 by support and the phone has not signed in again
A dashboard edit does not push anything to the phone. The token updates at the next refresh or sign-in.

### 5. The user signed in by another method and expects the account address to change
A code login to a new address creates (or joins) a different account; it does not rewrite a password account's address. For a linked account, a linked `email` identity can sit on a different address from the account's (Settings shows it as "Linked"); address changes there do not change the root account's address. Auth0 cannot change a Google or Apple address.

### 6. Settings shows "Hidden by Apple"
Apple relay address (`...@privaterelay.appleid.com`) is hidden by design. It is not a stale value.

## Solution

1. **Confirm the truth in Auth0** (Diagnose 2). If Auth0 has the right address, the account is correct; the phone just needs a fresh token.
2. **Causes 1, 2, 4:** ask the user to sign out and sign in again on that phone (password, or code to the corrected address). This pulls a new ID token. The password path gets the corrected address in the token directly; the code path links into the same account via the automatic link (same sub, same data). Do not suggest Delete User Data.
3. **Cause 3:** the address was never changed. The verify screen is not shown again to a verified account, so there is no in-app way to change it afterwards. Support can change it with the Management API body in [tools](../reference/tools.md#update-an-email-or-set-email_verified-password-users-only) (password accounts only; confirm the user can read the new inbox, check `users-by-email` for a collision; the sub and data do not change), then the user signs in again.
4. **Cause 5:** explain that sign-in methods are separate identities; for Google and Apple the address is controlled by Google or Apple.
5. **Report address:** reports go to the address the app holds. After the user signs in again, send a test report. If reports went to the old address already, those cannot be recalled.
6. **Cause 6:** not a bug; the real address is not shown.
7. If a user signed in again and the old address returns on the next cold start, the token issued still carries the old address, so Auth0 still has the old one: re-check Diagnose 2.

**Old app versions.** Builds without the OTA never run the verify flow and never write `authEmail` this way; the address they show is whatever their last token held. Ask for `appVersion`.

## Escalate

When Auth0 shows the new address and the user has signed in again but the app still shows the old one; when `Credential renewal after verify failed` repeats for one user; when the Auth0 `email` changed back unexpectedly. Attach: hash, `appVersion`, platform, timestamps (timezone), `Email verified` (`changed`) lines, the `Credential renewal` WARN `code`, the Auth0 **Email** and **Email verified** state (describe, do not paste the address), the identities list with provider prefixes only, and the `traceId` of a recent `API request`.

## Reply

See [../replies/email-change-not-showing.md](../replies/email-change-not-showing.md). Expected variants:

- `sign-out-and-in`: Causes 1, 2, 4; sign out and in to refresh.
- `address-was-only-confirmed`: Cause 3.
- `different-sign-in-method`: Cause 5; each way of signing in has its own address.
- `apple-hidden-address`: Cause 6.

## Sources

- `app/components/VerifyEmailGate.tsx` (`verify`, credential renewal)
- `app/services/auth/useAuth0Wrapper.ts` (`authEmail`, `emailVerified` from the ID token)
- `app/models/AuthenticationStore.ts`
- `app/services/auth/accountMethodsLogic.ts`
- `app/components/AccountMethodRow.tsx`
- `app/i18n/en.ts` (`verifyEmailScreen`, `settingsScreen`)
- `docs/support/reference/email-verification.md`, `account-linking.md`, `tools.md`
- `api:src/routes/auth0Email.ts`
