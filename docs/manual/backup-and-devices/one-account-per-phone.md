---
title: One account per phone
area: backup-and-devices
screen: Settings → Account
tier: free
aliases: ["different account", "wrong account", "share a phone", "switch accounts", family, partner, "set up for a different account"]
---
<!-- sources: docs/support/reference/device-owner.md, app/i18n/en.ts, app/i18n/platformStrings.ts, app/screens/WrongAccountView.tsx, app/screens/WrongAccountScreen.tsx, app/screens/SettingsScreen.tsx, app/screens/login/guestEntryLogic.ts, docs/BACKUP.md, app/db/resetLocalDatabase.ts, app/db/feedbackCache.ts, CLAUDE.md -->
Each install of RecoverySky holds the data of one account: the first account that signs in on that phone. If a different account signs in, the app shows "This device is set up for a different RecoverySky account." and keeps the phone's records safe. Logging out does not change which account the phone belongs to.

## What the different account screen means

You just signed in, and the app shows "This device is set up for a different RecoverySky account."

Under it, the app says: "Sign in to that account to continue. Your meetings and records are safe." Nothing on the phone has been deleted or changed.

The screen offers the way the phone's account signs in:

- **"Send code to" and an address**, for an account that signs in with an email code. The address is shown partly hidden. Tap it to get a code at that address.
- **"Sign in with Google"** or **"Sign in with Apple"**, for an account that signs in with Google or Apple.
- **"Sign in with your password instead"**, for an older account that signs in with a password.
- **"Cancel"**, which takes you back to the login screen. It deletes nothing.

Once you sign in as the phone's account, the app opens as usual.

At the bottom, the screen says: "If you can't sign in to that account, contact support@recoverysky.app".

## Sharing a phone

Two people cannot both keep their own records on one phone. A second person needs their own phone for their own account.

On Android, someone else can tap "Just join meetings" on the login screen. That opens the Meetings tab as a guest, with no account. A guest can browse and join meetings. A guest sees none of your records or favorites, and nothing personal is recorded for them.

Guest mode is only on Android. On iPhone, using the app needs an account.

## Switching this phone to a different account

You want to hand this phone over to a different account on purpose.

1. Sign in as the phone's current account.
2. Open Settings → "Account" and tap "Delete User Data".
3. Confirm "Are you sure you want to delete all your user data? This cannot be undone." by tapping "OK!".
4. On iPhone, a "Sign In" system message may appear if the phone's account uses Google or Apple. Go through it.

This removes everything on this phone: attendance records and reports, favorites, star ratings, reminders, your profile, your settings and your conversations with Sky. Attendance that was never backed up is lost.

It leaves your Cloud Backup untouched, and it does not delete your account. The next account to sign in becomes the phone's account.

## Good to know

**Logging out keeps the phone's account.** After "Logout", your records stay on the phone, protected, until that same account signs back in.

**Why the rule exists.** It keeps one person's attendance and reports from mixing with another person's, on the phone and in Cloud Backup.

**Two ways into one account.** You may sign in with one method (say Google) on a phone set up with another (say an email code). If both use the same email address, then after you prove it is you with the phone's own method, the other method may be joined to your account. The app does not tell you either way.

## If something's wrong

You can't sign in to the account the phone is set up for.

Contact support@recoverysky.app and mention that your phone shows "This device is set up for a different RecoverySky account" and how you used to sign in.

## Questions people ask

**Q:** It says this phone is set up for a different account.
**A:** The phone holds the records of the first account that signed in on it. Your records are safe. Sign in the way that account signs in, using the button on that screen, or tap "Cancel" to go back.

**Q:** Can my partner use the app on my phone?
**A:** Not with their own account. One phone holds one account's records. On Android, they can tap "Just join meetings" to browse and join meetings as a guest, and they see none of your records. On iPhone, they need their own phone.

**Q:** How do I switch accounts on this phone?
**A:** Sign in as the phone's current account, then open Settings → "Account" and tap "Delete User Data", then "OK!". That clears this phone, but not your Cloud Backup. The next account to sign in becomes the phone's account.
