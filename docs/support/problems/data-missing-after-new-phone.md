# "I got a new phone and my data is gone"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email or raw sub into a ticket, a Loki query or a log. Examples are fake.

Background: [device owner](../reference/device-owner.md), [account linking](../reference/account-linking.md#what-data-follows-an-automatic-link). Cloud Backup design: `docs/BACKUP.md`.

## Symptoms

The user installed the app on a new (or reset, or restored) phone, signed in, and their attendance records, reports or subscription are missing.

They say:
- "All my meetings and history are gone."
- "I signed in with the same email and it's empty."
- "My subscription isn't there."
- "It says 'Can't unlock your local data'." (restored from a phone backup)

## Diagnose

1. **What exactly is missing?** Attendance records, reports, the subscription, or the profile and settings? The cases differ:
   - **Local-only data** (Cloud Backup never on): never left the old phone. Cannot be recovered from the server.
   - **Cloud-backed attendance and reports**: should pull back on the new phone only if Cloud Backup is on there and the subscription is active.
   - **Subscription**: belongs to the account (RevenueCat identity is the Auth0 sub), not the phone.
2. **Was Cloud Backup ever on?** Cloud Backup is opt-in (default OFF, per install) and its Settings section appears only with the `recoverysky-attendance` entitlement. Ask: "Did you turn on 'Back up attendance'? Do you have the attendance subscription?" If never, cause 1.
3. **Is the new phone's backup on?** The toggle is stored on each install, not on the account. On a new phone it starts OFF. Nothing syncs until the user turns "Back up attendance" on (Settings, Cloud Backup) with an active attendance subscription, or accepts a one-off opt-in prompt (after Restore Purchases, or the backup pass, which asks once per pass id and never again; [BACKUP.md](../../BACKUP.md)). Ask whether Settings shows a "Cloud Backup" section at all. No section: the entitlement is not active on this account (Cause 3).
4. **Is it the same account as before?** Compare how they signed in before and now ([empty-account-after-sign-in](empty-account-after-sign-in.md#diagnose) steps 1 to 4). In the dashboard, find every account on their address(es); a different `user_id` today than the one that backed up means the data is under the other sub (Cause 2). Hide My Email, a different address, a Google tap instead of a code, are the usual reasons.
5. **Did the old account ever push rows?** There is **no support-side query that lists or counts a user's server rows** (the API repo has no admin route or script for it). The partial check: for each candidate account's hash (computed locally, [tools](../reference/tools.md#hash-an-auth0-sub-into-the-log-userid)):
   ```
   {service_name="app_api"} |= "Attendance sync push processed" |= "<hash>"
   ```
   Strip ANSI colour codes. A line with `accepted` above 0 proves that sub backed up attendance within Loki's 31-day retention. Absence proves nothing. Anything beyond that is an engineering query: **escalate**.
6. **Pull problems on the new phone** (user has backup on, account right, still empty):
   ```
   {service_name="recoverysky-app", module="AttendanceSync"} | userId="<hash>"
   ```
   Look for `sync: pull failed — backing off` (with `resource` and `kind`), `sync: pull merge failed for record`, `Account switch — clearing the previous owner's outbox`. The sync gate also needs: signed in, not offline, not in maintenance, RevenueCat configured. Module-level lines carry `userId` only on builds from 4.10.1-9 ([tools](../reference/tools.md#auth-queries-replace-hash-and-deviceid)).
7. **Restored from a phone backup/transfer?** If the user sees "Can't unlock your local data" (body: "The key that protects this device's local data is missing or no longer matches it. That data can't be recovered without the key. Resetting starts fresh on this device; attendance you backed up to the cloud syncs back after you sign in."), the encrypted database file came across but its key did not. Loki: `{service_name="recoverysky-app"} |= "sqliteKey"` and `database` lines for the device ([RS-024](../../../CLAUDE.md) background in the repo CLAUDE.md). The local data is unrecoverable.
8. **Came from the old app?** Old-app data lives in Firebase and comes in through Settings, Import (or the onboarding import), not through Cloud Backup. Ask which app they used before.

## Causes

### 1. Data was local-only
Cloud Backup was off (or the user never had the attendance subscription). The records lived only on the old phone. The server has nothing to give back.

### 2. A different account than before
The new phone signed in as a different Auth0 account (different method, different address, Hide My Email). The data is under the first account. Cloud rows belong to the sub that pushed them and do not follow a different sub.

### 3. Backup was on before, but is not on or not entitled now
Per-install toggle is OFF on the new phone, or the attendance entitlement has lapsed or not been restored (the Cloud Backup section is hidden without it).

### 4. Rows stranded by an automatic link
The account was linked in Auth0 after data was backed up under the old `email|` sub. The user now signs in with the primary's sub, which has no server rows. Open product decision ([what follows a link](../reference/account-linking.md#what-data-follows-an-automatic-link)). Subscription may be missing for the same reason.

### 5. Reports specifically
Reports are pull-only: the server generates them and the phone fetches metadata, then the body, one at a time. A report row is only on the new phone after a pull with backup on; very old or Firebase-imported reports can have no body on the server at all (the app remembers the 404 and stops asking).

### 6. Local database key lost (restored phone)
Phone backup restore moved the database but not the key. The overlay offers "Reset local data".

## Solution

1. **Cause 1:** be honest: no copy exists on the server. If the old phone still works, the user can turn Cloud Backup on **there** first (if entitled), let it finish ("All backed up"), then sign in on the new phone with the same account. If the old phone is gone, the data cannot be recovered; say so kindly.
2. **Cause 3:** the user signs in, opens Settings, taps Restore Purchases if the Cloud Backup section is missing, then turns on "Back up attendance". The first pass pulls both resources before pushing. It can take minutes; the status line shows "Backing up…" and finishes with "All backed up". Keep the app open and online.
3. **Cause 2:** confirm which account backed up (Diagnose 4 and 5), and have the user sign in with that method on the new phone. **Do not hand-link accounts to move data**: a hand link moves no server rows ([tools: link two accounts](../reference/tools.md#link-two-accounts)). **Never delete an account to "reset" it.** If the backed-up account cannot be signed into, see [forgot-password-or-old-app](forgot-password-or-old-app.md) or [wrong-account-screen](wrong-account-screen.md).
4. **Cause 4:** escalate; do not unlink or hand-edit rows.
5. **Cause 5:** with backup on and the right account, wait for the pass; open the report again. If a particular report never gets a body, it is likely not on the server: escalate with the report's date if the user needs it.
6. **Cause 6:** the user taps "Reset local data" and confirms ("Reset local data?", "This deletes the local database on this device. It cannot be undone."). Nothing real is lost beyond what was already unreadable. Then sign in; backed-up attendance syncs back once Cloud Backup is on.
7. **Old app data:** point the user at Settings, Import (or the onboarding import).

**Old app versions.** A user who moves from an old build to the new sign-in can land on a different account than their old password one (a code login on a mistyped or different address makes a fresh account). Check Cause 2 and [forgot-password-or-old-app](forgot-password-or-old-app.md).

## Escalate

Hand to engineering when: cloud data is missing and the user is sure backup was on, on an account you can identify (stranded rows, Cause 4); you need to know which sub owns server rows or how many exist (no support query exists); a pull keeps failing (`sync: pull failed`) for a signed-in, entitled, online user; Auth0 shows a link but the API log has the partial-failure lines. Attach: the hashes of every candidate account (computed locally), whether Cloud Backup was on and the entitlement status, `appVersion`, platform, timestamps (timezone), the `AttendanceSync` and API push lines you found, and what is missing and since when.

## Reply

See [../replies/data-missing-after-new-phone.md](../replies/data-missing-after-new-phone.md). Expected variants:

- `turn-on-backup-and-sign-in`: Causes 3 and 5; turn on Cloud Backup and wait.
- `sign-in-the-original-way`: Cause 2; use the account you used before.
- `data-was-only-on-old-phone`: Causes 1 and 6; kind, honest answer.
- `checking-your-data`: Cause 4; we are looking into it.

## Sources

- `docs/BACKUP.md` (the gate, toggle semantics, backup pass, reports)
- `CLAUDE.md` ("Attendance Cloud Backup & Sync", "Opening the encrypted database")
- `app/services/sync/index.ts`, `app/services/sync/attendanceSyncService.ts` (log lines)
- `app/screens/SettingsScreen.tsx` (Cloud Backup section gated on `hasAttendance`)
- `app/i18n/en.ts` (`database`, `settingsScreen`)
- `docs/support/reference/account-linking.md`, `device-owner.md`, `tools.md`
- `api:src/routes/sync.ts` (log `Attendance sync push processed`)
