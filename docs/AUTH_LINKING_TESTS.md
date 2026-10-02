# Auth linking + sync — basic manual test run

ADDED 2026-09-30. A basic, repeatable run on the **dev** tenant (`bad-bitch-tenant`). It proves
three things:

- An existing password or Google account gains email-code login through the **Link passwordless
  identity** Action.
- A linked account's attendance syncs between iOS and Android.
- A device whose owner gets linked from *another* device carries its local data across (the
  relinked owner, spec 2 §7).

Happy paths only. Edge cases live in plan Task 18 Step 4
(`docs/superpowers/plans/2026-09-17-passwordless-auth-and-wrong-account-recovery.md`) and the
`docs/BACKUP.md` checklist. Takes about 30 minutes.

## Setup (once)

- [ ] `auth0/scripts/wipe-dev-users.sh --delete` → the tenant has zero users.
- [ ] Auth0 → Applications → RecoverySky Dev App → Connections: **Username-Password-Authentication**,
      **email**, **google-oauth2** enabled. Post-login order is Link passwordless identity → Identities claim
      (`auth0/scripts/deploy-actions.sh bad-bitch-tenant` dry run prints it).
- [ ] Dev builds on a physical **iOS** device and an **Android** device, both pointed at the dev tenant.
- [ ] Two real email addresses whose inboxes you can read on the phone. Each one is used on
      **both** devices: that's the point, since the same address must land in the same account.
  - **E1**: the Part 1 address, for the password account, e.g. a plus-address `you+pw@…`. You
    choose its password in 1.1 and only use it there; every later sign-in is by email code.
  - **G1**: the Gmail address of the Google account you'll use in Part 2, both for
    **Continue with Google** and for its email code.
- [ ] Know the purchase and backup controls (both devices can buy from the RevenueCat Test Store,
      which is free in dev builds):
  - **💳 Buy:** Settings → **Upgrade to Premium** → complete the Test Store purchase. Right after it,
    the app shows **"Welcome to Premium!"** with a **Back up attendance** button. Answer as the step
    says.
  - **☁️ Cloud Backup:** Settings → Cloud Backup → **Back up attendance** switch. The section only
    shows once the signed-in account holds the attendance entitlement.
  - The entitlement belongs to the **account** (the RevenueCat customer is the Auth0 sub), not the
    phone. So each account buys **once**, and the other phone inherits it by signing into the same
    account.
  - ⏱️ **Test Store subscriptions expire within minutes** (seen 2026-09-30: H1's subscription, bought
    by about 20:36, was gone on both phones by 20:47). Do the "Don't buy" steps soon after the
    purchase. If the Cloud Backup section is missing on a "Don't buy" step, check the
    other phone first. If it's gone there too, the purchase expired: buy again on this phone and
    carry on. Only a section missing here but present on the other phone is a finding.
  - Recording attendance is free: Settings → **Enable Attendance**. Only reports and Cloud Backup
    need the subscription. The first time an account's entitlement shows up after a 🧨 Purge (bought
    or inherited), the app turns Enable Attendance **on by itself**. In those steps, check it's on;
    don't tap it, or it turns off.
  - If the app is relaunched while signed in with the entitlement and Cloud Backup off, a one-time
    **"Back up your attendance?"** prompt may appear. Tap **Back up attendance**.
- [ ] iOS: VPN **off**. The dev tenant has no email provider, so code sends take 5–19 s, and through
      the VPN they run past the SDK's 10 s timeout.
- [ ] Android plugged in by USB (`adb devices` lists it), so Claude can read its logs.
- [ ] Start Metro with `npm run dev-log` (here) and the local dev API with `pnpm dev-log` (in `../api`,
      on :4000). Each one runs as usual and also saves its output to `/tmp/rs-metro.log` /
      `/tmp/rs-api.log`, which Claude reads at the checkpoints.

## How to check

| What | Where |
|---|---|
| Which account you're in | the `Syncing Auth0 user to MST store` log line's `userId`: a hash of the sub. Compare hashes between steps, never raw subs. |
| Users and their identities | `auth0/scripts/diagnose-linking.mjs` (or `wipe-dev-users.sh` with no flag) |
| The Action linked | `diagnose-linking.mjs` marks every email-code login that came back with a non-`email` sub `⇐ LINKED`, so after the link each later code login is marked too. The Action's own console line (`linked email identity into <provider> primary`) is only in the dashboard: Monitoring → Logs → the login → Action Details. |
| Linked methods in the app | Settings → Account |

## Diagnostics checkpoints (Claude runs these)

At each **🔎 diag** row below, tell Claude "diag". Claude runs these read-only commands and reports
pass/fail for that step, so you don't have to read logs on the phone:

1. **Auth0 state:** `node auth0/scripts/diagnose-linking.mjs --since 30`. This lists users, their
   identities, and each identity's app log hash, plus the recent tenant log with each login's
   connection, sub, `⇐ LINKED` marker and Action results. It's dev-only (refuses any other tenant),
   uses the `AUTH_MGMT_*` client from `../api/.env`, and never prints the secret, the token or a full
   email.
2. **Android app log:**
   `adb logcat -d -v time -s ReactNativeJS | grep -E "Syncing Auth0 user|Device owner|Relinked owner|Moved local rows|Account switch|link"`
3. **iOS app log** (and Android, since both share Metro):
   `grep -aE "Syncing Auth0 user|Device owner|Relinked owner|Moved local rows|Account switch" /tmp/rs-metro.log | tail -40`

4. **API log:** which account each pushed attendance landed under (pino output, ANSI stripped):
   `sed 's/\x1b\[[0-9;]*m//g' /tmp/rs-api.log | grep -aE -A6 "Attendance sync push processed|Sync push refused|auth0/link" | grep -aE "push|refused|link|userId|accepted|rejected" | tail -40`

Claude then matches the `userId` hashes from steps 2–4 against the users in step 1, so
"same account" is checked, not guessed. Dev builds don't ship logs to Loki (the OTLP endpoint is
commented out in `.env`), which is why the device logs come from adb and Metro.

A password (`auth0|`) identity and a code (`email|`) identity on the same address count as ONE
"Email" to the user, so Settings → Account shows a single Email row for them (deduped in
`accountMethodsLogic.ts`).

## Part 1: Password → email code, then sync

| # | Device | Do | Expect | ✓ |
|---|---|---|---|---|
| 1.1 | iOS | 🧨 Purge → 🔑 **DEV: Sign in with password** → **Sign up** with E1 (and any password). 💳 **Buy** → at "Welcome to Premium!" tap **Back up attendance** (☁️ on). Check Enable Attendance is on, log 1 attendance. | Signed in. Note the hash (**H1**). (The push is silent; step 1.4 proves it.) | |
| 🔎 | Claude | diag | One user `auth0|…`, one identity. Its hash = the iOS `Syncing Auth0 user` hash (that's **H1**). Tenant log: a password signup + login. API: `Attendance sync push processed` under **H1**, `accepted` 1. | |
| 1.2 | iOS | Sign out → **Continue with Email** → type E1 → enter the code from that inbox. | No wrong-account screen. Hash = **H1**. Attendance still there. Auth0 log: `linked email identity into auth0 primary`. Users dry run: ONE user, identities `auth0` + `email`. | |
| 1.3 | iOS | Sign out → **Continue with Email** → E1 → code again (not the 🔑 password button). | Hash = **H1**. NO new `linked …` log line (the Action's one-identity guard). Settings → Account: one **Email · Active** row. | |
| 🔎 | Claude | diag | Still ONE user, identities `auth0` (primary) + `email` (linked). The 1.2 and 1.3 code logins are both issued for `auth0|…`, so both show `⇐ LINKED` (the script marks every code login that lands on a non-`email` sub, not just the one that linked). "Linked only once" is the dashboard check in 1.3. Every iOS `Syncing Auth0 user` line since 1.1 shows **H1**. Both Actions ran `ok`. | |
| 1.4 | Android | 🧨 Purge → **Continue with Email** → E1 → code. **Don't buy.** Check Enable Attendance is on, then ☁️ Cloud Backup **on**. | Hash = **H1**. The Cloud Backup section is there without buying (the entitlement came with the account; if it's missing, that's a finding, so note it and buy). The iOS attendance appears in Attendance. | |
| 1.5 | Android | Log 1 attendance. Then on **iOS**: background and foreground the app (or open Attendance). | The Android attendance appears on iOS. | |
| 🔎 | Claude | diag | The Android `Syncing Auth0 user` hash = **H1**. API: the 1.5 push is under **H1**, `accepted` 1. No `Account switch` line on either device. | |

## Part 2: Google → email code, relinked owner, then sync

Start with `auth0/scripts/wipe-dev-users.sh --delete`. The order matters: the email account must
exist **before** the Google one, so the iOS device ends up owned by an `email|` sub that later gets
linked into Google from the Android phone.

| # | Device | Do | Expect | ✓ |
|---|---|---|---|---|
| 2.1 | iOS | 🧨 Purge → **Continue with Email** → G1 → code. **Don't buy** (so there's no Cloud Backup yet, which is the point; see below). Enable Attendance, log 1 attendance. | Signed in as a new `email|` user. Note the hash (**HX**). No Auth0 `linked` line (nothing to link to yet). | |
| 2.2 | Android | 🧨 Purge → **Continue with Google** (the G1 account). 💳 **Buy** → at "Welcome to Premium!" tap **Back up attendance** (☁️ on). Check Enable Attendance is on. | A new account. Note the hash (**HY**, ≠ HX). Users dry run: 2 users (`email|…` and `google-oauth2|…`). | |
| 2.3 | Android | Sign out → **Continue with Email** → G1 → code. | Hash = **HY**. Auth0 log: `linked email identity into google-oauth2 primary`. Users dry run: ONE user, identities `google-oauth2` + `email`. | |
| 🔎 | Claude | diag | ONE user `google-oauth2|…` (primary) with `email|…` linked; the iOS 2.1 hash (**HX**) is now the *linked* identity's hash. The 2.3 login shows `⇐ LINKED`. Android hash = **HY**. | |
| 2.4 | iOS | Sign out → **Continue with Email** → G1 → code. | Goes straight in, no wrong-account screen. Hash = **HY**. App logs, in order: `Moved local rows to the relinked owner` (moved > 0), `Device owner relinked into a linked account` (the rows are moved before the relink is logged). Then `Relinked owner — keeping the outbox under the new account`, also at sign-in (it doesn't wait for Cloud Backup, which is still off here). **Never** `Account switch — clearing the previous owner's outbox`. The 2.1 attendance is still listed. | |
| 🔎 | Claude | diag | iOS Metro log: the relink lines in order, `ownerId` = **HY** and `previousId` = **HX**, `moved` > 0, and no `Account switch`. No wrong-account lines. | |
| 2.5 | iOS | **Don't buy.** Settings → check Enable Attendance is on → ☁️ Cloud Backup **on**. | The Cloud Backup section is there now: iOS is on the Google account, which Android bought for in 2.2. No error (the push is silent; 2.6 proves it). | |
| 2.6 | Android | (☁️ already on since 2.2) → open Attendance, or background and foreground the app. | The iOS attendance from 2.1 appears. | |
| 2.7 | iOS | Settings → Account. | **Email · Active** and **Google · Linked**. (iOS only: Android's 2.3 login is the one that made the link, so its first token was issued before the account had two identities. It shows a single Email row until its next sign-in or token refresh, which re-runs the Identities claim. In the 2026-09-30 run, Android had refreshed by 2.7 and showed both rows too.) | |
| 🔎 | Claude | diag | Final state: one user, two identities; both devices' latest `Syncing Auth0 user` = **HY**; no `Account switch` anywhere in either log. API: the 2.5 push is under **HY** with `accepted` ≥ 1, and **no push ever under HX** (that would be the stranded-row gap). | |

**Why iOS doesn't buy in 2.1.** It keeps Cloud Backup off on the `email|` account. Also, a purchase
there would belong to that `email|` customer in RevenueCat, and nothing moves it when Auth0 links
the accounts (untested; the same class of gap as the server rows below). A new attendance always
goes into the local outbox; only the
*push* waits for Cloud Backup. Kept local, the row is moved to the Google account in 2.4 and pushes
there. If it had pushed in 2.1, it would sit on the server under the `email|` sub. The Action's link
does **not** move server rows (only the API's `POST /auth0/link` does, via `reassignUserRows`), so
Android would never see it. That's a known gap for email-first users who later sign up with
Google/Apple, and it isn't part of this basic run.

## Part 3: Legacy email verification

Needs the local API with Postmark configured. Wipe users first.

| # | Device | Do | Expect | ✓ |
|---|---|---|---|---|
| 3.1 | iOS | 🧨 Purge → **Can't get a code? Sign in with your password** → **Sign up** with a mistyped address (e.g. your Gmail + `f`). Finish onboarding. | The verify screen: heading "Please review and verify your email address", the mistyped address in full, "Skips left: 6". | |
| 3.2 | iOS | Tap **Why is verification required?** | The browser opens the RecoverySky post. | |
| 3.3 | iOS | Tap **Not now**. Background and foreground the app. | Into the app. The screen does not return today. | |
| 3.4 | iOS | Set the phone's date forward one day, foreground the app. | The screen returns with "Skips left: 5". | |
| 3.5 | iOS | **Not my email? Change it** → type E1 → **Send Code** → enter the code from E1's inbox. | Into the app. Settings → Account shows E1. | |
| 🔎 | Claude | diag | One `auth0|` user whose email is now E1 (masked), verified. API log: `email verified` with `changed: true`, and no address in any line. Metro: `Email verified {"changed":true}`. | |
| 3.6 | iOS | Force-quit and reopen. | No verify screen (this install's record wins over the cached token). | |
| 3.7 | iOS | Sign out → **Continue with Email** → E1 → code. | Same account (the hash matches 3.1), attendance intact, no verify screen. | |
| 3.8 | Android | 🧨 Purge → sign in with the password link as a second mistyped account. Skip on six different days (move the date each time). | Day 7: no "Not now", the support line instead. Android's back button does nothing. | |
| 3.9 | Android | Turn on airplane mode, relaunch. | No verify screen while offline; it returns when back online. | |
| 3.10 | Android | With the mandatory screen from 3.8 showing, turn on airplane mode. Then turn it off. | The screen closes while offline (the app is usable) and returns once back online. | |

Put the phone's date back to automatic afterwards.

## Not covered here

- **Apple "Hide My Email"**: these accounts link by neither path. The automatic email-match link
  can't match the `privaterelay` address, and the wrong-account rescue only links when both
  accounts have the same address (`decideForeignLink` in `app/services/auth/ownerLogic.ts`). Such a
  user must always use Sign in with Apple. See
  [account linking](support/reference/account-linking.md#apple-hide-my-email).
- Wrong-account screen → link from Settings (`POST /auth0/link`), failure paths, and two-candidate
  ordering: plan Task 18 Step 4 and `docs/BACKUP.md`.

## Results

| Run date | Build | Part 1 | Part 2 | Notes |
|---|---|---|---|---|
| 2026-09-30 | dev 4.10.1-15 | ✅ (1.1 on Android, devices swapped) | ✅ | Test Store subscription expired mid-run (bought again for 1.4). 2.7: both rows on both devices. Relink moved 1 row; the 2.5 push landed under HY (accepted 2), none ever under HX. |
