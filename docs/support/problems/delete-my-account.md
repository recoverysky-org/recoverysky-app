# "Delete my account" / "delete my data from your servers"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email or raw sub into a ticket, a Loki query or a log. Examples here are fake (`user@example.com`, `auth0|65f0000000000000000000aa`).

Background: [device owner: Delete User Data](../reference/device-owner.md#delete-user-data), [tools: delete a user](../reference/tools.md#delete-a-user), [what the link sweep moves](../reference/account-linking.md#what-moved-covers).

**There is no complete account-deletion process today.** No single action removes everything. This doc says what each piece deletes, the order that avoids stranding a phone, and what has to go to engineering. Do not invent a step that is not here.

## Symptoms

- "Please delete my account."
- "Delete all my data from your servers."
- "I deleted my data in the app. Is my account gone?"
- "How do I close my account?"

## Diagnose

1. **What does the user want gone?** Ask, and write it down:
   - only the data on their phone;
   - their sign-in account (they never want to sign in again);
   - their data on our servers (cloud backup, reports, reminders and the rest);
   - their subscription.
   Most requests are "all of it". A user who only wants a fresh start on one phone needs Delete User Data alone (Solution, Case A).
2. **Confirm the user controls the account.** They must write to you **from** the address on the account, or prove it with a code to that address. **Never delete account A because B asked.** Find every account on their address(es) in the dashboard ([tools](../reference/tools.md#find-a-user-by-email)) and note each `user_id` prefix, `created_at` and the Identities list. A linked account is one user with several identities; separate rows are separate accounts, and the user must confirm each one they want deleted.
3. **Which phones own the account?** Compute each account's hash locally ([tools](../reference/tools.md#hash-an-auth0-sub-into-the-log-userid)) and search Loki:
   ```
   {service_name="recoverysky-app", module="useAuth0Wrapper"} |= "Device owner adopted" | ownerId="<hash>"
   {service_name="recoverysky-app", module="useAuth0Wrapper"} |= "Foreign session on an owned device" | ownerId="<hash>"
   {service_name="recoverysky-app", module="useAuth0Wrapper"} |= "Device owner relinked into a linked account" | ownerId="<hash>"
   ```
   Loki keeps 31 days, so no hit does not prove no phone owns it. Ask the user how many phones they have used.
4. **Does the account hold server data?** There is no support-side query for server rows. The partial check is the API push line, `{service_name="app_api"} |= "Attendance sync push processed" |= "<hash>"` ([data-missing-after-new-phone](data-missing-after-new-phone.md#diagnose) step 5). Assume server data exists if the user ever had Cloud Backup on, sent a report, set a reminder or allowed push notifications.
5. **Active subscription?** Ask. Store subscriptions are billed by Apple or Google; nothing we delete cancels them.

## What each piece deletes

| Action | Deletes | Does not delete |
| --- | --- | --- |
| Settings, "Delete User Data" (user, in the app) | This phone's local data: attendance, reports, reminders, profile, settings, conversation history; the phone's owner record. Signs out. | Anything on our servers. The Auth0 account. The subscription. Other phones. The confirmation it shows does not mention servers, but the handler makes no server call (`handleDeleteUserData`). |
| Auth0 user delete (support, `DELETE /api/v2/users/{sub}`) | The sign-in account, its linked identities and login history. Irreversible. | Server rows, the RevenueCat customer, any store subscription. |
| Server rows | Nothing deletes them today. There is no account-deletion route in the API (`/auth0` has only `profile`, `link` and the email-verify routes). `DELETE /sync/backup` exists but answers 404 unless `SYNC_BACKUP_DELETE_ENABLED=true` (tabled 2026-09-30, off), the app never calls it, and it would remove only attendance not yet in a report, never reports. | |
| RevenueCat customer | Nothing support can run. | |

Server data for an account is at least what the link sweep knows about: attendance, attendance reports, reminders, notification deliveries, report unsubscribes, push tokens, notification subscriptions ([list](../reference/account-linking.md#what-moved-covers)). Engineering owns the full list.

## Causes

### A. The user wants a fresh start on one phone
Local data only. Delete User Data does it.

### B. The user wants the account and their data gone
Needs the user (each phone), engineering (server rows, RevenueCat) and support (Auth0 user), in that order.

### C. The user ran Delete User Data and thinks the account is gone
It was local only. Their account and any server data remain; if they want those gone, this is case B.

## Solution

### Case A
The user opens Settings, taps "Delete User Data" and confirms with "OK!". Warn first: it discards anything on that phone that was not backed up. On iPhone, for a Google or Apple account, they must go through the system "Sign In" message and not cancel it; a cancel leaves them signed in to the same account after the reload ([device owner](../reference/device-owner.md#delete-user-data)).

### Case B (and C when the user wants everything gone)
1. **Confirm control** (Diagnose 2). No deletion of any kind without it.
2. **Each phone first.** Ask the user to open the app on every phone they use, signed in, and run Settings, "Delete User Data". This clears the phone's owner record. Skip it and that phone's owner record keeps pointing at an account that can never sign in again: the phone is stuck on "This device is set up for a different RecoverySky account." and only a reinstall frees it (unsynced local data lost). If a phone is lost or the user cannot sign in on it, tell them a reinstall is the way out there, and note it in the ticket.
3. **Subscription.** Tell the user to cancel it in their App Store or Google Play subscription settings. Deleting the account does not stop billing.
4. **Escalate server data and RevenueCat to engineering before deleting the Auth0 user.** Engineering needs the sub to find the rows and the customer, and once the Auth0 user is deleted the dashboard can no longer map the user's address to it. Attach what the Escalate section lists. Wait for engineering to confirm they have what they need. If the user came from the old app, say so: old-app records were imported from a separate store and engineering decides about those too.
5. **Delete the Auth0 user** (`DELETE /api/v2/users/{sub}`; [tools: delete a user](../reference/tools.md#delete-a-user)). Keep the `GET /api/v2/users/{sub}` before-state out of the ticket (it holds the address). Deleting a primary removes its linked identities. A separate account on the same address is a separate delete, only if the user confirmed it. The tenant log shows `sdu`.
6. **Tell the user honestly** what is done and what is still with engineering (reply `account-deleted`). Do not promise a date for server-data deletion.

### Case C
Explain that Delete User Data cleared the phone only. Ask whether they want the account and server data gone too; if yes, Case B.

**Old app versions.** A phone still on an old build has no owner record yet. If it later updates while still signed in, the update stamps the signed-in account as owner (`Owner stamped from hydration`), and after the Auth0 delete that phone would be stuck too. Ask the user to sign out on any old-build phone, or to update it and run step 2. (Code-derived from `setupRootStore.ts`, not device-tested.)

## Escalate

Every Case B goes to engineering for server rows and the RevenueCat customer: there is no support procedure for either. Also escalate when the user cannot prove control of the address, when a phone that owns the account cannot be cleared and the user still wants the Auth0 user gone now, or when the request mentions a legal deadline. Attach: the hash of every account to delete (computed locally; never raw subs or addresses), their `user_id` prefixes and `created_at`, whether Cloud Backup, reports, reminders or a subscription were used, whether the user came from the old app, the `ownerId` Loki hits (phones that own the account), `appVersion` and platform if known, and the date of the request (timezone).

## Reply

See [../replies/delete-my-account.md](../replies/delete-my-account.md). Expected variants:

- `clear-this-phone`: Case A; how to run Delete User Data.
- `before-we-delete`: Case B and C, first reply; confirm the address, clear each phone, cancel the subscription.
- `account-deleted`: Case B, after the Auth0 delete; what is done and what is still in progress.

## Sources

- `app/screens/SettingsScreen.tsx` (`handleDeleteUserData`)
- `app/i18n/en.ts` (`settingsScreen.deleteUserData`, `deleteUserDataConfirm`, `common.ok`)
- `app/services/auth/ownerLogic.ts` (`decideOwnership`)
- `app/services/auth/useAuth0Wrapper.ts` (`logout`, owner log lines)
- `app/models/helpers/setupRootStore.ts` (owner stamped from hydration)
- `docs/support/reference/device-owner.md`, `tools.md`, `account-linking.md`
- `api:src/routes/sync.ts` (`DELETE /sync/backup`, `backupDeleteEnabled`)
- `api:src/config/index.ts` (`SYNC_BACKUP_DELETE_ENABLED`)
- `api:src/routes/auth0.ts`, `api:src/routes/auth0Email.ts` (no account-deletion route)
- `api:src/routes/auth0.ts` (`POST /auth0/link`, the tables the sweep moves)
