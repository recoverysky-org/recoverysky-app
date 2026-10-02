# "The app signed me out by itself"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email or raw sub into a ticket, a Loki query or a log. Examples are fake.

Background: [sign-in methods: signed out unexpectedly](../reference/sign-in-methods.md#signed-out-unexpectedly) and [device owner](../reference/device-owner.md).

## Symptoms

- The user opens the app and sees the Login screen although they were signed in.
- The Login screen shows: **"You were signed out because your session could not be restored on this device. Please sign in again."**
- "I saved my meeting and it threw me out."
- "It happens every few days."
- "I tapped Log out and nothing happened" / "I deleted my data and I'm still signed in." (these are *not* a sign-out; see Cause 6)
- "Everything says offline / maintenance / connecting." (also not a sign-out; Cause 7)

## Diagnose

1. **What exactly did they see?**
   | They saw | Go to |
   | --- | --- |
   | Login screen with the "You were signed out because your session could not be restored..." line | Diagnose 2 (a forced logout) |
   | Login screen with no message | They logged out, cleared the app's data, reinstalled, or the notice was already shown once (it appears once and is cleared when the user taps a sign-in button). Diagnose 2 may still find the forced logout |
   | A red banner, "You're offline...", "Network issues...", "Connecting to RecoverySky...", "Maintenance in progress..." | Not a sign-out: Cause 7 |
   | "This device is set up for a different RecoverySky account." | Not a sign-out: [wrong-account-screen](wrong-account-screen.md) |
   | Signed in, but nothing loads | Cause 5 |
2. **Loki: was it a forced logout?** Use the user's `userId` hash (computed locally, [tools](../reference/tools.md#hash-an-auth0-sub-into-the-log-userid)). Module-level lines (`Api`, `AuthStore`, `ConfigStore`, `sqliteKey`, `App`) carry no `userId` on builds up to 4.10.1-4; judge coverage on 4.10.1-5 and later, and for windows that include builds before 4.10.1-9 match `| userId="<hash>" or user_id="<hash>"` ([tools](../reference/tools.md#auth-queries-replace-hash)); on those older builds find any line with their hash and pivot on `sessionId`.
   ```
   {service_name="recoverysky-app", module="App"} |= "Performing forced logout after permanent refresh failure" | userId="<hash>"
   {service_name="recoverysky-app", module="tokenFreshness"} |= "forcing logout"
   {service_name="recoverysky-app", module="tokenFreshness"} |= "renewed into an unusable access token"
   {service_name="recoverysky-app", module="useAuth0Wrapper"} |= "returned unusable access token"
   {service_name="recoverysky-app", module="Api"} |= "Server rejected the bearer as unusable"
   {service_name="recoverysky-app", module="App"} |= "deferring logout"
   {service_name="recoverysky-app", module="LoginScreen"} |= "Showing forced-logout notice"
   ```
   Add `| userId="<hash>"` to each except `Showing forced-logout notice`, which is logged while signed out and carries no `userId` (match it by time window and `appVersion`). The ERROR `Performing forced logout...` is the one definitive line; expect duplicates in a burst. What the nearby lines tell you:
   | Line (level) | Attribute | Meaning |
   | --- | --- | --- |
   | `Access token refresh failed permanently — forcing logout` (ERROR) | `error` | A credentials-manager error in the permanent list: `NO_REFRESH_TOKEN`, `NO_CREDENTIALS`, `INVALID_CREDENTIALS`, `DPOP_KEY_MISSING`, `DPOP_KEY_MISMATCH`. Cause 1 |
   | `Auth0 SDK renewed into an unusable access token` (ERROR) or `Auth0 SDK returned unusable access token — signing out` (ERROR) | `reason` (`not-jwt`, `wrong-audience`, `no-expiry`) | The login or renewal produced a token that is not usable. Cause 2 |
   | `Server rejected the bearer as unusable` (ERROR, then `... — forcing logout`) | `source: "server-401"`, `code` | API answered 401 `token_malformed`, `token_claims` or `token_signature`. Cause 2 |
   | `Refresh dead but timer is live — deferring logout` (WARN) | none | Cause 3 |
   | `Access token refresh failed transiently — proceeding with current token` (WARN) | `error` | **Not** a sign-out. Cause 5 |
3. **Tenant log: was the refresh token revoked or expired?** Dashboard, Monitoring, Logs ([event codes](../reference/tools.md#tenant-log-event-codes)). `sertft` is a refresh that worked; `fertft` a refresh that failed (read its description). No `fertft` and no forced-logout line: the app did not sign the user out.
4. **Was an attendance timer running?** Ask: "Did you just save or cancel a meeting timer?" A deferred logout runs the moment the timer is saved or cancelled (Cause 3).
5. **Which build?** `appVersion`. Builds 3.12.1 to 4.1.6 shipped without the API audience, so their logins could renew into an unusable token ([history](../reference/sign-in-methods.md#what-triggers-it)). Newer builds should not.
6. **iOS: did they log out or delete data and stay signed in?** Look for `Logout cancelled by user` (module `useAuth0Wrapper`). The iOS system "Sign In" dialog appeared and they cancelled it. Cause 6.
7. **Is a restart going to bring it back?** The Auth0 SDK holds credentials in its own keychain entry. If the app's store has been cleared but the SDK's entry survives, a cold start restores the session and goes through the ownership gate again.

## Causes

### 1. The refresh token or its key is gone (permanent refresh failure)
The Auth0 SDK could not renew: no stored refresh token, no credentials, invalid credentials, or the DPoP key is missing or mismatched. A DPoP key that vanished from the Keychain after a phone restore or device transfer is a real-world cause. The app forces a logout and clears both credential stores. Android clearing app data, or the key being lost, can also end a session with **no log at all** (inferred).

### 2. The renewed or issued token is unusable
The token fails the shape check (`not-jwt`, `wrong-audience`, `no-expiry`), or the API returns 401 with `token_malformed`, `token_claims` or `token_signature`. The user is signed out one tick after signing in or on the next renewal. On an old audience-less build this repeats every login.

### 3. A timer deferred the sign-out
While an attendance timer is running the eject is held (`pendingLogout`), so the in-meeting timer survives. When the timer is saved or cancelled, the forced logout runs. The pending flag is in memory only; a cold start clears it, and the dead refresh is simply re-detected. "It signed me out right after I saved my meeting" is this.

### 4. The user, or the OS, ended the session
Settings, Log out ("Are you sure you want to log out?"), Delete User Data, Android "clear storage", or reinstalling. No error lines. Logout logs `Logging out` then `Logout complete`.

### 5. Not signed out: the session is alive but requests fail
An ordinary revoked or expired refresh token is classified **transient** on purpose (the SDK reports many network-ish failures the same way), so the app can stay "logged in" while every request returns 401. The refresher backs off 15 s, 60 s, 5 min, 15 min. Signs: `Access token refresh failed transiently — proceeding with current token` repeating, `API request` debug lines with `status` 401. A `token_expired`, `token_invalid`, code-less 401 or 503 `auth_unavailable` never signs the user out either. (Inferred from the classification code; not observed in a ticket.)

### 6. They are still signed in (iOS dialog cancelled)
Logout on iOS shows a system "Sign In" dialog for browser sessions (Google, Apple, password; not code sessions). If the user cancels it, logout is aborted and they stay signed in (`Logout cancelled by user`). The same call sits inside **Delete User Data**: the handler goes on to wipe the database and reload anyway, so the user can report "I deleted my data but I'm still signed in" (the SDK session is restored and adopted into the empty database).

### 7. A banner, not a sign-out
These sit above every screen; the user is still signed in. Offline, "Network issues", "Connecting to RecoverySky…" (device attestation degraded) and maintenance are covered in [sign-in methods: banners that are not sign-outs](../reference/sign-in-methods.md#banners-that-are-not-sign-outs). The alerts "Device Not Supported" and "Verification Rejected", and the full-screen `MaintenanceScreen`, are not sign-outs either.

## Solution

1. **Always first:** tell the user their data is safe on the phone; a forced logout does **not** clear the device owner or local data ([device owner](../reference/device-owner.md#when-it-is-cleared)). Signing back in as the same account is a normal match.
2. **Cause 1 and 2:** the user signs in again with the same method and address as before. If they use a different method that creates a different account they get the wrong-account screen ([wrong-account-screen](wrong-account-screen.md)), not data loss. If it recurs within days for the same user and the build is current, **escalate**. On an audience-less old build (3.12.1 to 4.1.6), the user must update the app ([forgot-password-or-old-app](forgot-password-or-old-app.md#solution)).
3. **Cause 3:** nothing is wrong. Explain it: the app waited for the meeting to be saved. They sign in again.
4. **Cause 4:** confirm what they did. If the phone was restored or transferred, they need to sign in again (the database may also show "Can't unlock your local data": [data-missing-after-new-phone](data-missing-after-new-phone.md)).
5. **Cause 5:** not a sign-out. Fully close and reopen the app; if requests still fail, sign out and in again (Settings, Log out) to mint fresh tokens. If the pattern is a revoked refresh token, a tenant-side change may have caused it: check the tenant log for `fertft` with the user's `user_id` and read the description.
6. **Cause 6:** on the iOS "Sign In" dialog, tell the user to go through the system dialog instead of cancelling it to complete a logout (the dialog is iOS's own; its button labels are not ours). For Delete User Data: the local data is gone; they can sign out again from Settings, or just carry on. Do **not** suggest Delete User Data as a fix for any sign-out problem.
7. **Cause 7:** work the banner as a connectivity or maintenance problem, not an auth problem.
8. **Never advise a reinstall** as a first step: it deletes the encrypted local database and key, and unsynced records are gone.

**Old app versions.** Old builds have the same sign-out paths but none of the owner gate. A session restored by an old build records no sign-in method, so a password account may be shown the verify-email screen once the new JS runs ([verify-screen-wont-go-away](verify-screen-wont-go-away.md)).

## Escalate

When forced logouts recur for the same user on a current build; when `unusable access token` or `Server rejected the bearer as unusable` appears with `reason` or `code` on a current build; when a user is signed in but every request returns 401 for hours. Attach: the hash, `appVersion`, platform, timestamps (timezone), the exact log lines above with their `error` / `reason` / `code`, the `traceId` of a recent `API request` with `status` 401 ([Tempo](../reference/tools.md#tempo)), whether a timer was running, and whether the phone was restored or transferred.

## Reply

See [../replies/signed-out-unexpectedly.md](../replies/signed-out-unexpectedly.md). Expected variants:

- `sign-in-again`: Causes 1 to 4; sign in the same way, data is safe.
- `still-signed-in`: Cause 6; you were never signed out.
- `looks-like-a-connection-issue`: Causes 5 and 7; not a sign-out.
- `update-the-app`: Cause 2 on an old build.

## Sources

- `app/app.tsx` (`performForcedLogout`, the timer deferral)
- `app/services/auth/userTokenRefresher.ts` (`latchAndEject`), `app/services/auth/tokenFreshnessLogic.ts` (`classifyRefreshError`)
- `app/services/auth/tokenFreshness.ts`
- `app/services/api/index.ts`, `app/services/api/bearerRejectionLogic.ts` (`Server rejected the bearer as unusable`)
- `app/services/auth/useAuth0Wrapper.ts` (`Logout cancelled by user`, sync effect)
- `app/screens/LoginScreen.tsx` (`Showing forced-logout notice`)
- `app/screens/SettingsScreen.tsx` (`handleDeleteUserData`)
- `app/i18n/en.ts` (`loginScreen.sessionUnrecoverable`, `common.*Banner`)
- `docs/support/reference/sign-in-methods.md`, `device-owner.md`, `tools.md`
