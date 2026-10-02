# Device owner

Each app install holds the local data of **one** account: the owner. A different account signing in on that install is refused with the wrong-account screen. This protects local attendance and report data, and, when Cloud Backup is on, stops one user's queued rows being pushed into another user's account (the server stamps every pushed record with the authenticated uid).

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email or raw sub into a ticket, a Loki query or a log.

## The owner record

Stored on the install, in the auth store (MMKV):

| Field | What it is |
| --- | --- |
| `ownerSub` | The Auth0 sub of the account that owns this install's data. |
| `ownerEmail` | The address offered as "Send code to {{email}}", and the login hint for a Google or Apple owner. Never logged. For a code sign-in it is the address the user **typed** (not the token's email, which for a linked account is the primary's). Adoption by Apple or Google uses the token's email, so an Apple owner can hold a relay address; it is never displayed. |
| `previousOwnerSubs` | The owner's earlier subs, kept after [relinks](#relink-after-another-device-linked-the-account). |

The proof method (how the owner proves it is them) is **derived from the sub prefix**, never stored: `email|` and `auth0|` mean "send a code", `google-oauth2|` means Google, `apple|` means Apple, anything else is "unknown".

A separate in-memory field, `foreignSession`, holds a refused session (sub, email, ID token, login method). It is never persisted.

### When it is set

- **Adopt.** The first accepted sign-in on an install with no owner sets it. Log: INFO `Device owner adopted` with `ownerId` (hashed).
- **Hydration stamp.** On a cold start of an install that was already signed in when this feature arrived, the owner is stamped from the stored `userId` and `authEmail` if there is no owner, there is a user id, the session is not anonymous, and the user id is not the device id. Log: INFO `Owner stamped from hydration` (module `RootStore`). The guards exist because a device-id owner is unrecoverable (the wrong-account screen would offer only Cancel).
- **Relink.** The owner moves to the primary's sub ([below](#relink-after-another-device-linked-the-account)).
- **Email refresh.** Every owner code sign-in re-stores the typed address.

### When it is cleared

**Only** by `resetLocalDatabase`, as the last step of the same teardown, after the database file and its key are gone. Two callers: Settings, Delete User Data, and the "Reset local data" button on the database-open failure overlay. Logs: WARN `Resetting local database and encryption key`, then WARN `clearOwner()` (module `AuthStore`), then WARN `Local database reset complete`.

- **Logout never clears the owner.** The record protects the data that stays on disk. Logging out and back in as the same account is a `match`.
- A forced logout ([signed out unexpectedly](sign-in-methods.md#signed-out-unexpectedly)) does not clear it either.
- Reinstalling the app is the user-side reset (new install, no owner).

## Ownership outcomes

`decideOwnership` (`app/services/auth/ownerLogic.ts`) returns one of four outcomes. The gate runs in the Auth0 sync effect **after** the token shape check and **before** any token or user id is written.

| Outcome | When | Result |
| --- | --- | --- |
| `adopt` | No owner on the install. | Owner is set to this session's sub. Normal sign-in. |
| `match` | Owner sub equals the session's sub. | Normal sign-in. |
| `relinked` | Subs differ, but the owner's sub appears among the `sub` fields of the ID token's `https://recoverysky.app/identities` claim. | Owner moves to the new sub, local rows are rewritten, normal sign-in. See [relink](#relink-after-another-device-linked-the-account). |
| `mismatch` | Anything else. | Session refused: wrong-account screen. |

On `mismatch` nothing is written: no tokens, no user id, no SecureStore copy. `isAuthenticated` stays false, so sync, RevenueCat, push and the Sentry identity never see the foreign session. The Auth0 SDK still holds the foreign credentials in its own keychain, so a **cold start restores the session and hits the gate again, landing on the same screen**.

An anonymous session never reaches the gate as anonymous (the call site passes a literal `false`), and the anonymous login is not offered on the login screen.

### Foreign session on an owned device

Log: WARN `Foreign session on an owned device` (module `useAuth0Wrapper`) with `ownerId` (hashed: the account that **holds the data**) and `loginMethod` (`email`, `apple`, `google` or `unknown`).

**The foreign account is not identifiable from the app log.** The line also passes a `sessionId` carrying the foreign hash, but the logger reserves `sessionId` and strips caller-supplied values, so Loki shows the launch's own random `sessionId`. Only `ownerId` and `loginMethod` survive, and a foreign session never sets the logger's `userId`. To find the foreign account, use the Auth0 tenant log (`s` login success events near that time; match `connection` and the user's address) and compare the `user_id` there with the owner's. Do not paste either into a ticket.

This line is the key for "I signed in and my meetings are gone": the device belongs to another account, and the data is safe on disk. Nothing further is logged if the user cancels.

## The wrong-account screen

Shown by the app navigator instead of Login while a foreign session is held and the user is unauthenticated. Copy (verbatim):

- Title: "This device is set up for a different RecoverySky account."
- Body: "Sign in to that account to continue. Your meetings and records are safe."
- Footer: "If you can't sign in to that account, contact support@recoverysky.app"

### Which buttons show

| Owner sub prefix | Controls |
| --- | --- |
| `email\|` | "Send code to {{email}}" (needs a stored `ownerEmail`), "Cancel". |
| `auth0\|` | "Send code to {{email}}", "Sign in with your password instead", "Cancel". |
| `google-oauth2\|` | "Sign in with Google", "Cancel". No address is drawn anywhere. |
| `apple\|` | "Sign in with Apple", "Cancel". No address is drawn anywhere. |
| Unrecognised, with a stored address | Treated like a code owner. Logs WARN `Owner has an unrecognised sub prefix` with `hasEmail`. |
| Unrecognised, no address | "Cancel" only. |

The address in "Send code to {{email}}" is masked (`u***@example.com`).

### What each button does

- **"Send code to {{email}}".** Sends a code to the stored owner address and shows the code step in place (same step as login; same 30 s resend cooldown; same error strip and copy as [login errors](sign-in-methods.md#login-error-messages)). The "Wrong email? Go back" link is wired to **Cancel**, because the owner address cannot be edited. Verifying needs no navigation: the gate then says `match`, and the navigator swaps to the main app.
- **"Sign in with Google" / "Sign in with Apple".** Runs the provider login with the owner's address as the login hint. If the foreign session came from a browser (login method is not `email`, including undefined), the app clears the browser session **first**, because the browser still holds the cookie for the wrong account and the provider would silently hand it back. On iOS that shows the system "Sign In" dialog; dismissing it proceeds anyway (INFO `Browser session clear cancelled by user — proceeding`).
- **"Sign in with your password instead".** Same as the provider button with the password connection. Only for `auth0|` owners.
- **"Cancel".** Abandons the foreign session: clears the Auth0 browser session unless the foreign login method is `email`, then the SDK credentials, then drops the foreign record. It **never** touches the owner record or local data. Returns to Login. Log: INFO `Abandoning foreign session` with `loginMethod`; on trouble, WARN `Browser session clear failed — clearing credentials only` and WARN `Foreign record dropped while the SDK session survived — self-heals on next cold start`. Umami event `wrong_account_cancelled`.

Nothing on this screen can delete, rekey or overwrite local data.

### Linking from the rescue

After the user proves they are the owner, the foreign identity may be linked into the owner's account (`linkForeignIdentity`, `POST /auth0/link` with the foreign ID token, authorised as the owner). It happens **only** when the foreign session's email equals the accepted account's email (trimmed, case-insensitive; both must exist). **The user is told nothing either way.** Logs:

| Log | Meaning |
| --- | --- |
| INFO `Accepted session matches the recorded foreign one — record dropped` | Same sub; nothing to link. |
| INFO `Foreign identity not linked — address differs from the account's` (`foreignId` hashed, `foreignProvider`) | Addresses differ; deliberately not linked. |
| WARN `Foreign session had no ID token — nothing to link` | The foreign ID token was gone (it is memory only; a process death loses it). |
| INFO `Foreign identity linked` (`linked`, `reason`, `moved`) | Linked. `moved` counts server rows swept to the owner. |
| ERROR `Foreign identity link failed` | The API call failed; no retry is persisted. |

The different-address rule exists because Auth0 finds a code user by the root account's email only, so a linked email identity on a different address can never sign in again: the next code login creates a fresh unlinked `email|` user and the device lands back here, while Settings shows the dead identity as "Linked". Links of that kind made before 2026-09-30 may still exist. See [account linking](account-linking.md).

### The Apple relay case

A Hide My Email user who types their real address on the email step gets a fresh `email|` account, which is a `mismatch` against their Apple owner. They are shown only "Sign in with Apple". The relay address cannot be matched to the real one, so the rescue cannot link them (different addresses). This is by design.

## Relink after another device linked the account

When an owner's identity is linked into another account (typically from another device's wrong-account rescue, or outside the app by the Action or the dashboard), Auth0 answers every login for it with the **primary's sub**. The old device still holds the pre-link sub as `ownerSub`. The gate finds that sub among the identities claim's `sub` fields and returns `relinked`:

1. Rewrites the `uid` column in `attendances`, `attendance_reports` and `reminders` from the old sub(s) to the new one, in one transaction, in raw SQL so nothing re-enqueues to sync.
2. Moves `ownerSub` to the new sub and appends the old one to `previousOwnerSubs`.
3. Logs INFO `Device owner relinked into a linked account` (`ownerId`, `previousId`, both hashed) and INFO `Moved local rows to the relinked owner`.
4. Writes tokens and the user id as a normal sign-in.

If the rewrite cannot run (database not yet open), ERROR `Relinked owner: row rewrite failed; retried on next open`; the migrator repeats it on every database open while `previousOwnerSubs` is non-empty (ERROR `Failed to move local rows to the relinked owner` if that fails). The sync service **restamps** the outbox instead of clearing it, keeping unpushed edits: INFO `Relinked owner — keeping the outbox under the new account`. Without the rewrite, reports would poll "Pending" forever, reminders would be orphaned, and the queue would read as an account switch.

**What the user sees: nothing special.** They sign in and land in the main app. Settings, Account then shows the new primary's identity plus the linked identities.

**Dependency.** `relinked` needs the identities-claim Action to emit a per-identity `sub`. The deployed prod and dev Action files do. A tenant on an older version of the Action returns `mismatch`, and the user loops on the wrong-account screen (the code goes to the owner's address, returns the same primary sub, and is refused again); only Delete User Data or a reinstall breaks that loop. If a ticket shows that loop, check the identities-claim Action is deployed on the tenant ([tools](tools.md#action-execution-results)).

Trust assumption: `relinked` treats every identity inside the account as the owner.

## Delete User Data

Settings, Delete User Data. Confirmation: "Are you sure you want to delete all your user data? This cannot be undone." (buttons "Cancel" and "OK!"). It is reachable only inside the main app, so only by the owner. Umami event `data_deleted`.

**Steps, in order (verified in `app/screens/SettingsScreen.tsx`, `handleDeleteUserData`):**

1. RevenueCat logout (`logOut`; the SDK goes back to an anonymous id).
2. Push opt-out and notification user logout.
3. Clear the AI conversation history.
4. `profileStore.reset()`.
5. Clear all MMKV storage (every persisted snapshot, including the auth store props, the owner record's MMKV copy, sync queue ownership and the local `emailVerify.*` records).
6. Clear SecureStore auth credentials and the stored terms acceptance (`clearAllSecureData`: these two keys only).
7. Auth0 `logout()` (clears the Auth0 browser session unless the login method is `email`, then the auth state). If anything in steps 1 to 7 throws, the handler falls back to `authStore.logout()`.

   Caveat: on iOS, if the user cancels the system "Sign In" dialog, `logout()` returns without throwing (log `Logout cancelled by user`) and clears no auth state, and it clears nothing if the SDK has no `user`. The handler still goes on to wipe the database and reload. Likely result: the SDK keychain session is restored on restart and adopted into the empty database, so the user reports "I deleted my data but I'm still signed in".
8. Outside that try: `resetLocalDatabase({ clearOwner })`: close the database, delete the encrypted SQLite file and its `-wal`, `-shm` and `-journal`, clear the SQLite key, then clear `ownerSub` and `ownerEmail`. A failure logs ERROR `Delete User Data: local database reset failed`.
9. `reloadApp()`.

**Effects**

| Where | Effect | Basis |
| --- | --- | --- |
| This install's local data | Gone: attendance, reports, reminders, profile, settings, conversation history. Unsynced local records are lost. | Verified in handler |
| Device owner | Cleared. The next sign-in on this install (any account) is `adopt`ed into an empty database. | Verified |
| Legal agreements | Asked again at the next sign-in (terms key cleared). | Verified |
| Verify-email skip count and local "verified" record | Reset (MMKV cleared), so a user mid-skip gets six more skips and the ID-token claim decides again. | Verified clear; consequence is inferred |
| Device attestation (device JWT and App Attest key id) | **Not** cleared by `clearAllSecureData` (only the credentials and terms keys are). The install keeps its device trust. | Verified in `secureStorage.ts` |
| Auth0 user (account, identities, email, verified flag) | **Untouched.** The handler makes no Auth0 or API call. The user can sign in again with the same method. | Verified: no server call in the handler |
| Cloud backup (server attendance rows) | **No server call is made by this handler**, so rows already pushed stay on the server and a later sign-in with Cloud Backup on can pull them back. Reports are never deleted server-side. A "delete cloud backup" feature is not built. | Handler verified; the survival of server rows follows from there being no delete call, and was not checked on the API |
| Subscription | RevenueCat is logged out locally. The entitlement belongs to the RevenueCat customer for the Auth0 user id, so it should return on sign-in. | Inferred, not tested |

The user-facing consequence is that Delete User Data is the only in-app way out of a stuck wrong-account loop, and it discards unsynced local data. Advise it only after confirming nothing unsynced matters, or after trying the owner's original sign-in method.

## Log recipes

Hash first, locally ([tools](tools.md#hash-an-auth0-sub-into-the-log-userid)). Use the hash only in queries. Module label is `module` in the log record.

| Question | Line to look for |
| --- | --- |
| Whose data is on this device? | `Foreign session on an owned device`, read `ownerId`. |
| Was the owner just adopted? | `Device owner adopted`, `Owner stamped from hydration`. |
| Did a relink run? | `Device owner relinked into a linked account`, `Moved local rows to the relinked owner`. |
| Did the owner get cleared? | `Resetting local database and encryption key` then `Local database reset complete`. |

## Sources

- `app/services/auth/ownerLogic.ts`
- `app/services/auth/useAuth0Wrapper.ts`
- `app/services/auth/linkForeignIdentity.ts`
- `app/services/auth/accountMethodsLogic.ts`
- `app/services/auth/secureStorage.ts`
- `app/models/AuthenticationStore.ts`
- `app/models/helpers/setupRootStore.ts`
- `app/screens/WrongAccountScreen.tsx`
- `app/screens/WrongAccountView.tsx`
- `app/screens/SettingsScreen.tsx` (`handleDeleteUserData`)
- `app/db/resetLocalDatabase.ts`
- `app/db/rewriteOwnerUid.ts`
- `app/db/OwnerRelinkMigrator.tsx`
- `app/services/sync/index.ts`
- `app/i18n/en.ts` (`wrongAccountScreen`, `settingsScreen`)
- `auth0/actions/meetingmaker/identities-claim.js`
- `docs/DIAGNOSTICS.md`
- `docs/superpowers/specs/2026-09-17-device-owner-and-wrong-account-recovery-design.md` (history only; code wins)
