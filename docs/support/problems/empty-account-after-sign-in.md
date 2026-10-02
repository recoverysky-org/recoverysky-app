# "I signed in and my account is empty" / "it made a new account"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email or raw sub into a ticket, a Loki query or a log. Examples here are fake (`user@example.com`, `auth0|65f0000000000000000000aa`).

Background: [account linking](../reference/account-linking.md), [device owner](../reference/device-owner.md), [sign-in methods](../reference/sign-in-methods.md).

## Symptoms

The user signed in successfully, was not stopped by the wrong-account screen, and finds no meetings, no history, no subscription, or a "new user" experience (onboarding again, Settings shows an address they did not expect).

They say:
- "I tapped Continue with Email and now my account is empty."
- "I used Google last time. Now it made a new account."
- "I use Hide My Email with Apple and my real address gives me nothing."
- "I got a new phone, typed my email, and none of my data is there."
- "My subscription is gone."

If the user *was* stopped by "This device is set up for a different RecoverySky account.", read [wrong-account-screen](wrong-account-screen.md) first. If the data was never backed up and the phone is new, read [data-missing-after-new-phone](data-missing-after-new-phone.md).

## Diagnose

1. **Ask what they used before**: "Apple, Google, email code, or a password?" and on which address. This is the single most useful question. The answer tells you which account holds the data.
2. **Dashboard: find every account on their address(es)** ([tools](../reference/tools.md#find-a-user-by-email)). Search the address they typed today and any other address they use (a work address, a Gmail, an Apple relay address). For each row note the `user_id` prefix, `created_at`, `last_login`, `logins_count` and the Identities list.
   - One user with several identities: the accounts are already merged. The problem is not duplication; go to step 5.
   - Several users: duplicates exist. Continue.
3. **Tenant log, what did today's login do?** Dashboard, Monitoring, Logs ([event codes](../reference/tools.md#tenant-log-event-codes)). Find the `s` event near the time. Read `connection` and `user_id`:
   - `connection` `email` and `user_id` starts `email|`: a fresh code account (no older linkable account matched). This is the commonest empty-account result.
   - `connection` `email` and `user_id` starts `auth0|`, `google-oauth2|` or `apple|`: the code login was linked into an older account ([durable check](../reference/account-linking.md#how-to-tell-in-the-tenant-log-that-a-login-was-linked)). The account is the older one; if it looks empty, step 5.
   - `connection` `google-oauth2` or `apple`: the user tapped a provider button. Provider logins never link to anything, so a first tap on Google or Apple with an address that already has a code or password account creates a **separate, empty** account.
   - `connection` `Username-Password-Authentication`: a password login; it cannot create an account.
4. **Is the address an Apple relay?** A row whose email ends `@privaterelay.appleid.com` ([Hide My Email](../reference/account-linking.md#apple-hide-my-email)). Settings, Account shows "Hidden by Apple" for it. No path links a relay account to the user's real address.
5. **Did data exist under another sub?** There is no support-side query for server rows ([data-missing-after-new-phone](data-missing-after-new-phone.md#diagnose) explains what you can and cannot check). What you can check:
   - The API push line for each candidate hash (computed locally from each dashboard `user_id`, [tools](../reference/tools.md#hash-an-auth0-sub-into-the-log-userid)): `{service_name="app_api"} |= "Attendance sync push processed" |= "<hash>"` with `accepted` greater than 0. A hit proves that sub backed up attendance at some point in the last 31 days. No hit proves nothing (older than retention, or never backed up, or Cloud Backup was off).
   - Whether a device owns the candidate: `{service_name="recoverysky-app", module="useAuth0Wrapper"} |= "Device owner adopted" | ownerId="<hash>"` and the same for `Foreign session on an owned device`.
6. **The empty account now owns this install.** If the user signed in to a separate account without the wrong-account screen, the account they are in now owns this install (`Device owner adopted`, `ownerId` = the empty account's hash). On a current build that is the only way a separate account gets in: the install had no owner (new phone, reinstall, Delete User Data, or an install that was signed out when the owner feature arrived), and the first accepted sign-in was adopted. If the install already had an owner, a different account would have hit the wrong-account screen instead. So Causes 1 to 3 all end the same way, and all take the [Cause 3 route](#solution). (Code-derived from `decideOwnership`, not device-tested.)
7. **Did a link strand rows?** A code login linked into an older account, and the user used the code login first earlier (so cloud rows sit under the old `email|` sub): [Cause 5](#5-data-did-not-follow-an-automatic-link).

## Causes

### 1. A different sign-in method created a separate account
The user signed in a different way than the first time and the two methods did not merge. Typical: first time Google, today "Continue with Email" with a **different address** than the Google account's; or first time a code, today a Google or Apple tap (provider logins never run the link Action, so they create their own account). Two real accounts on one address can also exist if a Google account and a password account were both created earlier: a code login joins only the oldest.

### 2. Hide My Email
The real account is an Apple relay account. A code login with the user's real address cannot match a relay address, so it makes a fresh `email|` account. See [account linking](../reference/account-linking.md#apple-hide-my-email).

### 3. Fresh phone, an empty account was adopted as owner
On a new install the first accepted login becomes the device owner. (Causes 1 and 2 also end with the empty account as owner; see Diagnose 6.) The user typed their real address (or tapped the wrong button) first, so the empty account owns the install. Later, signing in the right way (for Hide My Email: Apple) is the *foreign* session, and the wrong-account screen then shows, offering only a code for the empty account. See [Hide My Email fresh-phone gap](../reference/account-linking.md#apple-hide-my-email).

### 4. The code owner tapped Google or Apple with the same address
The device owner is a code (`email|`) account with data. The user tapped Google or Apple by mistake, creating a newer account on the same address. The next code login links the owner's code identity **into** that newer account and makes it primary. Inferred from code, not device-tested ([account linking](../reference/account-linking.md#code-owner-and-a-googleapple-wrong-tap-inferred-from-code)).

### 5. Data did not follow an automatic link
After an automatic link the user signs in with the primary's sub. Server rows (attendance, reports, reminders) and a RevenueCat purchase made under the old `email|` sub **stay under that sub** (open product decision; [what follows a link](../reference/account-linking.md#what-data-follows-an-automatic-link)). Local data on the device is not lost.

## Solution

1. **Always first:** tell the user nothing was deleted. Ask which method and address they used originally, and confirm it against the dashboard rows. **Never edit or delete account A because B asked**; confirm the user controls any account you touch.
2. **Causes 1, 2 and 3 (a separate, empty account now owns this install).** "Log out and sign in the original way" does **not** work here: logout keeps the owner, so the original sign-in is refused with the wrong-account screen, which offers only the empty account's method. One route for all three (code-derived from `decideOwnership` and `handleDeleteUserData`, not device-tested; ask the user what they see at each step):
   - **Check first.** Ask the user to confirm that the Attendance tab and Settings hold nothing they made on this phone. If records show up, **stop**: do not advise Delete User Data, escalate (an install that was signed out when the owner feature arrived can adopt a new account over local records).
   - **Still signed in to the empty account** (no wrong-account screen yet): Settings, "Delete User Data" (confirmation "Are you sure you want to delete all your user data? This cannot be undone.", buttons "Cancel" and "OK!"). It wipes the empty local database and clears the owner; the Auth0 accounts are untouched ([Delete User Data](../reference/device-owner.md#delete-user-data)). If the empty account is a **Google or Apple** account, on iPhone the user must go through the system "Sign In" message and **not cancel it**: a cancel leaves the empty session in place, and it is adopted again after the reload. Then the user signs in **the original way**, first: for Hide My Email, "Continue with Apple".
   - **Already on the wrong-account screen** (the user tried the original way first): tap "Send code to {{email}}" (the empty account's masked address) and enter the code. That is the owner proving itself, and it signs in normally. Then Settings, "Delete User Data", then the original sign-in. A code owner with a stored address always gets that button. A Google or Apple empty owner gets its provider button instead ("Sign in with Google" / "Sign in with Apple"), which also signs in as the owner. A reinstall also works; here it deletes nothing real.
   - Warn: Delete User Data discards unsynced local data. On a phone that holds only the empty account there is none. Never give this advice to someone with real local records.
   - **The stray empty account is harmless; leave it.** **Do not hand-link** the two: a hand link moves no server rows, and for different addresses or a relay address it leaves an identity that cannot sign in ([tools: link two accounts](../reference/tools.md#link-two-accounts)). Deleting the stray is only appropriate when all hold: no device owns it (Diagnose 5; after the Delete User Data above, this phone no longer does), `logins_count` and `last_login` show it was never used past creation, no Cloud Backup or purchase was on it, and the user agrees. Otherwise leave it.
   - For Hide My Email: the same Apple button on every device, always.
3. **Cause 4 (code owner wrong tap):** see the Solution for Cause 2 in [wrong-account-screen](wrong-account-screen.md#solution). If cloud data or a subscription is missing afterwards, escalate (Cause 5).
4. **Cause 5 (data stranded by a link):** do **not** unlink, hand-move rows or delete anything. Confirm in the dashboard that the user is one linked account, gather the Escalate attachments, and hand to engineering. Engineering finishes the move by hand; no support procedure exists. Tell the user their local data is still on the device they used before. For a missing subscription, ask them to open Settings and tap Restore Purchases first (the app syncs receipts once per identity per install and this has moved stranded subscriptions before); if that fails, escalate.
5. **Different addresses** (work vs personal) and no link possible: the accounts are genuinely separate. The data is under the account they used first; they sign in to that one, through step 2 if the other account now owns this install. Offer no linking promise.

**Old app versions.** Old builds have no owner gate, so on them "log out and sign in the original way" does work. They also sign in with the password only, so they never create `email|` accounts. If an old-build user reports an "empty account", the likelier cause is a new password signup: check the dashboard for a fresh `auth0|` row next to their old one, and see [forgot-password-or-old-app](forgot-password-or-old-app.md).

## Escalate

Hand to engineering when:
- cloud-backed data or a subscription is missing after a link (Cause 5), or after the code-owner wrong tap (Cause 4);
- the user lost data and no candidate account can be identified;
- the Attendance tab shows the user's records on an install the empty account has adopted (step 2's check failed);
- Auth0 shows the identity linked but the API log has `sweep/COMMIT failed while Auth0 already had the identity linked` ([partial failure](../reference/account-linking.md#partial-failure-auth0-linked-rows-not-moved)).

Attach: the hash of every account involved (computed locally from each dashboard `user_id`; never raw subs), their prefixes and `created_at`, the tenant-log `connection` and time of today's login, `appVersion`, platform, timestamps (timezone), whether Cloud Backup was on, which data is missing, and any API push lines you found.

## Reply

See [../replies/empty-account-after-sign-in.md](../replies/empty-account-after-sign-in.md). Expected variants:

- `use-original-method`: Causes 1 and 2; nothing is lost, clear this phone's empty data and sign in the way you did first.
- `fresh-phone-start-over`: Cause 3; clear the new phone's empty data and sign in again.
- Old build only (no owner gate): log out and sign in the original way; adapt `use-original-method` by hand.
- `checking-your-data`: Causes 4 and 5; we are looking into it, local data is safe.

## Sources

- `app/services/auth/ownerLogic.ts` (`decideOwnership`, `decideForeignLink`)
- `app/services/auth/useAuth0Wrapper.ts`
- `app/screens/SettingsScreen.tsx` (`handleDeleteUserData`)
- `app/i18n/en.ts` (`loginScreen`, `wrongAccountScreen`, `settingsScreen`)
- `auth0/actions/meetingmaker/link-passwordless-identity.js`, `identities-claim.js`
- `docs/support/reference/account-linking.md`, `device-owner.md`, `tools.md`
- `api:src/routes/sync.ts` (log `Attendance sync push processed`)
- `api:src/routes/auth0.ts` (`POST /auth0/link`)
