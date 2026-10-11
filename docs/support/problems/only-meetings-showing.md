# "I only see Meetings" / "my clean time, attendance and Settings are gone"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email or raw sub into a ticket, a Loki query or a log. Examples are fake.

Background: [sign-in methods: guest mode](../reference/sign-in-methods.md#common-to-every-method) and [device owner](../reference/device-owner.md).

## Symptoms

Android only. The app opens straight onto the Meetings screen (Online, In-Person, Search) with no tab bar at the bottom: no Home, Attendance or Settings. Under the meeting filters sits a card, "Get more from RecoverySky", with a "Sign in" button. Closing and reopening the app lands there again.

They say:
- "I only see Meetings."
- "My clean time, attendance and Settings are gone."
- "There's no Settings, so I can't log out or change anything."
- "My favourite meetings and my colours are gone." Meeting popups show no heart, stars or visit count, and the app has the default look: dark, with the default colour.
- "Zoom didn't use my name." Not a sign of guest mode: the app sends no name to Zoom, for anyone. Zoom uses the name saved in the Zoom app, or asks for one.

## Diagnose

1. **What exactly do they see?** Ask for a screenshot if you can.
   | They see | Go to |
   | --- | --- |
   | Android: Meetings only, no tab bar, the "Get more from RecoverySky" card with "Sign in" | Guest mode: Cause 1 |
   | The login screen ("Continue with Email", Google, Apple) | Not guest mode: [signed-out-unexpectedly](signed-out-unexpectedly.md) |
   | "This device is set up for a different RecoverySky account." | Not guest mode: [wrong-account-screen](wrong-account-screen.md) |
   | All tabs, but an empty account | Not guest mode: [empty-account-after-sign-in](empty-account-after-sign-in.md) |
   | An iPhone showing only Meetings | Not guest mode (iOS has none): Escalate |
2. **Ask: "Did you, or anyone else using the phone, tap "Just join meetings" on the sign-in screen?"** It is the last button on the sign-in screen, under Google, Apple and Email, and the only way into guest mode. The mode survives relaunches, so the tap may be days old.
3. **Ask why the sign-in screen was showing at all.** Guest mode starts from the login screen, so the user was signed out first: they logged out, the app signed them out (the login screen then says "You were signed out because your session could not be restored on this device. Please sign in again."), or the app was new on this phone. If they never chose to sign out, also work [signed-out-unexpectedly](signed-out-unexpectedly.md).
4. **Loki has no hash to search.** A guest has no user id, so guest lines carry no `userId`, and the Umami event `guest_mode_entered` carries none either. Diagnose from what the user describes. Only if you already have the user's hash from an earlier signed-in session ([tools](../reference/tools.md#hash-an-auth0-sub-into-the-log-userid)): a line with their `userId` shows the phone's `deviceId`, and then
   ```
   {service_name="recoverysky-app", module="AuthStore"} |= "enterGuest()" | deviceId="<deviceId>"
   {service_name="recoverysky-app", module="AuthStore"} |= "exitGuest()" | deviceId="<deviceId>"
   {service_name="recoverysky-app", module="AuthStore"} |= "logout()" | deviceId="<deviceId>"
   ```
   `enterGuest()` (INFO) is the tap on "Just join meetings". A WARN `enterGuest() refused: a signed-in identity is present` is a tap that did not start guest mode, because the phone still held a signed-in account. `exitGuest()` (INFO) is the "Sign in" tap or a later real sign-in. A `logout()` shortly before `enterGuest()` shows they were signed out first.

## Causes

### 1. Guest mode
Someone tapped "Just join meetings" on the login screen, so the app is in guest mode: the Meetings tab alone, no account, nothing personal recorded about the guest (no attendance, reminders, favourites, ratings or profile), and the device owner's data hidden. The phone keeps only device settings: that guest mode is on, the Meetings filters, list-or-map view and sort order picked (shared with the device owner, who sees the guest's last picks after signing back in), the location permission choice, and that the legal agreements were accepted. Hidden is not deleted. The owner's attendance, reports, clean time, favourites, theme and settings are still on the phone, and Cloud Backup is untouched. The mode stays on across relaunches until "Sign in" is tapped.

## Solution

1. **Always first:** tell the user their records are safe. Guest mode hides the phone owner's records; it never deletes or changes them.
2. Tap **"Sign in"** on the card under the meeting filters. The login screen appears.
3. Sign in **the same way as before**: Google, Apple, an email code to the same address, or the password link. The app opens with its tabs again, and the favourites, theme and name come back.
   - If a different way of signing in lands on "This device is set up for a different RecoverySky account.", work [wrong-account-screen](wrong-account-screen.md). If it opens an empty account, work [empty-account-after-sign-in](empty-account-after-sign-in.md).
4. **Never had an account?** The same "Sign in" button. Signing up is signing in: an email code creates the account on first use.
5. To go back to guest mode later, tap "Just join meetings" on the login screen again.
6. **Never advise a reinstall** or clearing the app's data: it deletes the encrypted local database and its key, and unsynced records are gone.

## Escalate

When a current Android build signs in and still shows only Meetings; when the user is signed in with the tabs back but hearts, stars or their theme are still missing after fully closing and reopening the app; when an iPhone shows only Meetings. Attach: platform, `appVersion`, timestamps (timezone), a screenshot, how the user signed in, and their hash if you have it (computed locally, never the raw sub).

## Reply

See [../replies/only-meetings-showing.md](../replies/only-meetings-showing.md). Expected variants:

- `sign-in-again`: Cause 1, the user has an account; sign in the same way as before, the records are safe.
- `create-an-account`: Cause 1, the user never had an account and wants the other features.

## Sources

- `app/screens/LoginScreen.tsx` (the guest entry, Umami `guest_mode_entered`)
- `app/models/AuthenticationStore.ts` (`isGuest`, `enterGuest()`, `exitGuest()`, `logout()`)
- `app/navigators/appRouteLogic.ts`, `app/navigators/GuestNavigator.tsx`
- `app/components/GuestPromoBar.tsx`, `app/screens/MeetingsScreen.tsx`
- `app/i18n/en.ts` (`guestPromo`), `app/i18n/platformStrings.ts` (`justJoinMeetings`)
- `docs/support/reference/sign-in-methods.md`, `device-owner.md`, `tools.md`
- `docs/superpowers/specs/2026-09-27-guest-mode-design.md` (history only; code wins)
