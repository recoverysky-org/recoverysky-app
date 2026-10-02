# "It says this device is set up for a different account" / "I'm signed in with the wrong account"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email or raw sub into a ticket, a Loki query or a log. Examples are fake.

Background: [device owner](../reference/device-owner.md) and [account linking](../reference/account-linking.md).

## Symptoms

The user sees: **"This device is set up for a different RecoverySky account."** / "Sign in to that account to continue. Your meetings and records are safe." / "If you can't sign in to that account, contact support@recoverysky.app", with a few buttons ("Send code to {{email}}", "Sign in with Google", "Sign in with Apple", "Sign in with your password instead", "Cancel").

They say:
- "I signed in and my meetings are gone / it wants a different account."
- "It only offers Apple, but I used my email."
- "It sends the code to an address I don't recognise."
- "I keep landing on this screen, even after I sign in."
- "I got a new phone and typed my real email; now it's stuck." (Hide My Email)

## Diagnose

1. **Is the data safe?** Yes: nothing on this screen deletes or overwrites local data. The install holds the data of one account (the owner), and the session the user just signed in with belongs to a different account.
2. **Which buttons show** tells you the owner's sign-in method (derived from the owner's sub prefix):
   | Buttons | Owner |
   | --- | --- |
   | "Send code to {{email}}", "Cancel" | Code account (`email\|`) |
   | "Send code to {{email}}", "Sign in with your password instead", "Cancel" | Password account (`auth0\|`) |
   | "Sign in with Google", "Cancel" | Google account |
   | "Sign in with Apple", "Cancel" | Apple account |
   | "Cancel" only | Unrecognised owner and no stored address |
   The address in "Send code to" is masked (`u***@example.com`). Ask the user to read it back.
3. **Loki: whose data is on the device.**
   ```
   {service_name="recoverysky-app", module="useAuth0Wrapper"} |= "Foreign session on an owned device" | ownerId="<hash of the account the user believes is theirs>"
   ```
   Use a time window around the report. If you already know the device, an earlier line with the user's `userId` shows its `deviceId`; then `| deviceId="<deviceId>"` works too (the user cannot tell you one). WARN, module `useAuth0Wrapper`, with `ownerId` (hash of the account that **holds the data**) and `loginMethod` (`email`, `apple`, `google`, `unknown`). Compare `ownerId` with the hash of the account the user thinks is theirs:
   - Equal: the user is signing in as the wrong thing (a different method that produced a different account). Causes 1 to 3.
   - Not equal: the device was last used by someone else, or by the user's other account. Cause 4.
   Also look for `Device owner adopted` (with `ownerId`) to see when ownership began. `Owner stamped from hydration` (module `RootStore`) carries no attributes, so you can only find it by `deviceId` or `sessionId`.
4. **The foreign account is not in Loki.** The logger strips the caller's `sessionId`; only `ownerId` and `loginMethod` survive, and a foreign session never sets `userId`. Use the **Auth0 dashboard, Monitoring, Logs**: find the `s` (login OK) event near the time. Read its `connection` and `user_id`. Compare with the owner's `user_id`.
5. **Dashboard: find the user by email**, as in [tools](../reference/tools.md#find-a-user-by-email). Note how many rows share the address and their prefixes (`auth0|`, `email|`, `google-oauth2|`, `apple|`) and creation dates.
6. **Did an automatic or explicit link run?** See [account linking](../reference/account-linking.md#how-to-tell-in-the-tenant-log-that-a-login-was-linked): a `connection=email` login with a `user_id` that is not `email|` was linked. For the explicit path:
   ```
   {service_name="recoverysky-app", module="useAuth0Wrapper"} |= "Foreign identity not linked" | userId="<hash>"
   {service_name="recoverysky-app", module="linkForeignIdentity"} | userId="<hash>"
   ```
7. **Loop?** If the user signs in with the owner's own method and still lands here with the code going to the owner's address and the same primary sub returning: check the **Identities claim** Action is deployed on the tenant ([tools](../reference/tools.md#action-execution-results)); an older version makes `relinked` impossible. Also check Loki for `Device owner relinked into a linked account`.

## Causes

### 1. Hide My Email (Apple relay) mismatch
The owner is an Apple account (token address is a `...@privaterelay.appleid.com` relay). The user typed their real address on the email step, which created a fresh `email|` account (Apple's relay address never matches the real one, so automatic linking cannot match). Screen offers only "Sign in with Apple". On a **fresh phone** the order differs: no owner exists, so the new empty `email|` account is adopted as owner without any warning; the later Apple sign-in is then the foreign session, and the screen offers only a code for the empty account. See [Apple Hide My Email](../reference/account-linking.md#apple-hide-my-email).

### 2. Owner is a code account, user tapped Google or Apple with the same address
The user tapped "Continue with Google" or "Continue with Apple" by mistake, creating a newer account on the same address. Screen offers only "Send code to {{email}}". See the code-owner case in [account linking](../reference/account-linking.md#code-owner-and-a-googleapple-wrong-tap-inferred-from-code) (inferred from code, not device-tested): the code login runs the Link Action, which links the owner's code identity **into** the newer Google or Apple account and makes that account primary. The first rescue code lands back on this screen once; the next code entry returns `relinked` and signs in. The owner's cloud rows (and any subscription) stay under the old `email|` sub.

### 3. Owner is a Google/Apple account, user tapped the wrong provider or the email box
Same idea in reverse. The screen offers only the owner's provider button. A different provider, or typing the address, created or used a different account. Using the owner's provider ends the loop; nothing is linked unless the addresses match (they must be equal on both sides).

### 4. A different person's, or a different account's, data is on the device
`ownerId` is not the account the user means. Typical: a shared phone, a hand-me-down, or the user used two accounts in the past. The data on the device is the owner's; it is safe.

### 5. The owner cannot sign in
Dead or mistyped address on a code/password owner (they cannot receive the code), or a Google/Apple account they can no longer open. Screen's footer already points them at support.

### 6. Loop after a link (tenant Action missing)
The user proves they own the account, the code returns the primary's sub, and the device still refuses. Suspect the Identities claim Action (see Diagnose 7).

## Solution

1. **First, always:** tell the user their records are safe, and to sign in as the account that is on the device. Ask what they used on this phone originally ("Apple", "Google", "email").
2. **Cause 1 (Hide My Email):** the user taps "Sign in with Apple" (the owner's method). The stray `email|` account stays a separate empty account; do not hand-link it (a hand link does not make the code login find it, and it moves no rows). On a fresh phone where the empty account was adopted: the only exits are Delete User Data (in Settings, inside the app; only reachable if the user can get into the app, so in practice a **reinstall**) and then "Sign in with Apple" first. Tell the user to use the same Apple button on every device. Delete User Data discards unsynced local data; warn them.
3. **Cause 2 (code owner, Google/Apple tap; the second-code behaviour is inferred from code, not device-tested, so ask the user to tell you what they see):** have the user tap "Send code to {{email}}" and enter the code. The first code may bring the screen back once; ask them to enter a second code. Then check: did the user's cloud data and subscription follow? If the user had Cloud Backup and sees an empty account, or lost their subscription, **escalate** (rows are under the old `email|` sub; open product decision). Also see [empty-account-after-sign-in](empty-account-after-sign-in.md).
4. **Cause 3:** the user taps the owner's provider button. For a Google/Apple owner who wants the other method to work too, no support action: the explicit link only happens when addresses match.
5. **Cause 4:** if the data is theirs, they sign in as the owner. If the device genuinely belongs to someone else and the user wants it wiped, the only exit from the wrong-account screen is a reinstall (Delete User Data needs the owner's sign-in, which we never ask for). **Never delete account A because B asked** and never ask for the owner's credentials.
6. **Cause 5:** if the owner is a password account that cannot receive a code, they use "Sign in with your password instead" on this screen (only `auth0|` owners). If they have lost the password, see [forgot-password-or-old-app](forgot-password-or-old-app.md). If the address is mistyped, see [mistyped-email-locked-out](mistyped-email-locked-out.md). If the owner is a code (`email|`) account with a dead mailbox, there is no in-app exit except a reinstall (which loses unsynced local data). Support can correct a mistyped address only on a password (`auth0|`) account; a code-only account's address cannot be fixed this way, so escalate.
7. **Cause 6:** check the tenant has the Identities claim Action; escalate if missing. Interim: owner's original method; last resort Delete User Data or reinstall (loses unsynced local data).
8. **"Cancel"** abandons the foreign session and returns to Login; it never touches the owner record or local data. Safe to suggest.
9. Do not suggest uninstalling as a first step: it deletes the encrypted local database and key (unsynced records are gone).

**Old app versions.** Old builds have no owner gate and never show this screen. If the user reports "different account" on an old build, they have a different problem (probably [empty-account-after-sign-in](empty-account-after-sign-in.md)).

## Escalate

Hand to engineering when: cause 2 or any link shows missing cloud data or a subscription; a loop persists after the Identities claim check; the user cannot prove they own the owner account and wants data moved; API partial-failure lines (`sweep/COMMIT failed while Auth0 already had the identity linked`) appear. Attach: the owner hash (`ownerId`), the foreign hash computed locally from the dashboard `user_id` (never the raw sub), `loginMethod` from the log line, `appVersion`, platform, timestamps (timezone), whether Cloud Backup was on, and the dashboard identities (provider prefixes only).

## Reply

See [../replies/wrong-account-screen.md](../replies/wrong-account-screen.md). Expected variants:

- `use-original-method`: Causes 1, 3, 4; sign in the way you did first.
- `code-owner-wrong-tap`: Cause 2; enter the code, maybe twice.
- `cannot-sign-in-to-original`: Cause 5; what we can do next.
- `still-stuck`: Cause 6; we are looking into it.

## Sources

- `app/screens/WrongAccountScreen.tsx`, `app/screens/WrongAccountView.tsx`
- `app/services/auth/ownerLogic.ts` (`decideOwnership`, `decideForeignLink`)
- `app/services/auth/useAuth0Wrapper.ts`
- `app/services/auth/linkForeignIdentity.ts`
- `app/i18n/en.ts` (`wrongAccountScreen`)
- `auth0/actions/meetingmaker/link-passwordless-identity.js`, `identities-claim.js`
- `docs/support/reference/device-owner.md`, `account-linking.md`, `tools.md`
- `api:src/routes/auth0.ts` (`POST /auth0/link`)
