---
title: Moving to a new phone
area: backup-and-devices
screen: Settings → Cloud Backup
platforms: [ios, android]
tier: attendance
aliases: ["new phone", transfer, "switch phones", "restored from backup", "lost my records", "data is gone", "records are gone"]
---
<!-- sources: docs/support/problems/data-missing-after-new-phone.md, docs/support/replies/data-missing-after-new-phone.md, docs/BACKUP.md, app/i18n/en.ts, app/db/DatabaseLoadingOverlay.tsx, app/db/resetLocalDatabase.ts, app/screens/SettingsScreen.tsx, app/screens/onboarding/OnboardingImport.tsx, docs/support/reference/device-owner.md, app/models/ProfileStore.ts, app/db/feedbackCache.ts, docs/superpowers/specs/2026-10-25-my-day-tab-design.md, app/services/dailyDash/resetDailyDashLocalData.ts, app/db/DatabaseProvider.tsx, app/services/support/supportContactsStorage.ts, docs/manual/home/support.md -->
Your attendance records live only on your phone unless Cloud Backup is on. Moving to a new phone takes two steps: turn on Cloud Backup on the old phone and let it finish, then sign in on the new phone with the same account and turn on Cloud Backup there. Your attendance records and the reports you have sent come back. Cloud Backup needs the Attendance subscription.

## Before you switch

You're still on your old phone, and it still works.

1. Open Settings → "Cloud Backup".
2. Turn on "Back up attendance".
3. Keep the app open and online until the line under the switch says "All backed up ✓".

Do not erase the old phone until you see "All backed up ✓".

This needs the Attendance subscription; without it the Cloud Backup section isn't shown. Without the subscription, or if "Back up attendance" was never on, your records are only on the old phone. Once the old phone is gone, they cannot be recovered from anywhere else.

## On the new phone

You're on the new phone.

1. Sign in the same way you did before: the same Apple, Google or email address. The first account to sign in on a phone becomes that phone's account.
2. Open Settings. If you don't see the "Cloud Backup" section, open Settings → "Subscription" and tap "Restore Purchases".
3. In Settings → "Cloud Backup", turn on "Back up attendance".
4. Keep the app open and online. The first backup fetches what is in your backup before it sends anything. It can take a few minutes, and it finishes with "All backed up ✓".

Reports come across a few at a time, so give them a little while. Cloud Backup needs the Attendance subscription.

## What comes back and what doesn't

These come back through Cloud Backup:

- Your attendance records.
- The reports you have sent.

These do not come back. Set them up again on the new phone:

- Favorites (hearts) and star ratings.
- Meeting reminders.
- Your Support contacts. They are not in Cloud Backup, so a phone set up fresh starts with none. Add them again from the "Support" card on Home. A full restore of the whole phone from its own backup can bring them along.
- Your clean date and fellowship. Enter them again in Settings → "Recovery".
- Your settings, such as theme and language.

**Coming from the older RecoverySky app?** Data from the older app is not in Cloud Backup. Open Settings → "Import" and tap "Restart Import", or use the import step during first-time setup.

## If you signed in with a different account

Your records are under the account you used before, but the new phone now belongs to the account you just signed in with. This happens after signing in a different way: a different method, a different email address, or Apple's hidden address instead of your own.

First, check the Attendance tab and Settings. If you see records you made on this phone, stop there. Contact support@recoverysky.app and mention that this phone signed in with a different account than before.

If they hold nothing you made on this phone:

1. Open Settings → "Account" and tap "Delete User Data", then "OK!". This clears this phone only. Nothing in your backup is touched. It also deletes My Day's data on this phone; what My Day sent to The Daily Dash's server stays there for that account.
2. On iPhone, a "Sign In" system message may appear if you used a Google or Apple account. Go through it.
3. Sign in the way you did on your old phone.
4. Turn on "Back up attendance" in Settings → "Cloud Backup".

## If the new phone can't unlock your local data

You restored the new phone from a phone backup or transfer, and the app says "Can't unlock your local data".

The app's database came across to the new phone, but the key that protects it did not. That local data can't be read.

1. Tap "Reset local data".
2. Confirm "Reset local data?" ("This deletes the local database on this device. It cannot be undone.") by tapping "Reset local data".
3. Sign in.
4. Turn on "Back up attendance" in Settings → "Cloud Backup".

Anything in your Cloud Backup comes back once "Back up attendance" is on. Reset clears what was already unreadable, and it also deletes My Day's data on this phone; what My Day sent to The Daily Dash's server stays there for your account.

## If something's wrong

Cloud Backup was on, and records are still missing on the new phone.

Don't delete anything first, and don't uninstall the app. Contact support@recoverysky.app and mention how you signed in on the old phone (Apple, Google, an email code or a password), the email address you used, and roughly when you last saw your records.

## Questions people ask

**Q:** I got a new phone and my attendance is gone.
**A:** Sign in with the same account as before, then turn on "Back up attendance" in Settings → "Cloud Backup" and keep the app open. If Cloud Backup was on before, your records come back. If it was never on, your records are only on the old phone.

**Q:** Will my favorites and reminders move?
**A:** No. Only attendance records and the reports you have sent come back through Cloud Backup. Favorites, star ratings and reminders need to be set up again on the new phone.

**Q:** Can you restore records from my old phone?
**A:** Only what was in Cloud Backup. If "Back up attendance" was never on, the records were only on the old phone. If the old phone still works, turn on backup there first and wait for "All backed up ✓".
