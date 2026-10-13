---
title: Cloud Backup
area: backup-and-devices
screen: Settings → Cloud Backup
platforms: [ios, android]
tier: attendance
aliases: [backup, sync, "back up attendance", cloud, synced, "all backed up", encrypted]
---
<!-- sources: app/screens/SettingsScreen.tsx, app/i18n/en.ts, docs/BACKUP.md, app/services/sync/enableCloudBackup.ts, app/hooks/useCloudBackupPrompt.ts, app/db/BackupPassRunner.tsx, app/services/sync/index.ts, app/services/sync/attendanceSyncService.ts, app/db/resetLocalDatabase.ts, docs/support/reference/device-owner.md, docs/support/problems/data-missing-after-new-phone.md, app/db/feedbackCache.ts, app/models/ProfileStore.ts -->
Cloud Backup keeps a copy of your attendance records and the reports you have sent in your RecoverySky backup, and keeps them in step across your phones. It backs up nothing else. It is off until you turn it on, and the switch is remembered on each phone, not on your account. It needs the Attendance subscription. Cloud Backup is part of the iPhone and Android apps.

## How to turn on Cloud Backup

You're in Settings.

1. Scroll to the "Cloud Backup" section.
2. Turn on the "Back up attendance" switch.

Before the switch is on, the line under it reads: "Keep your attendance history safe and synced across devices. Encrypted on your device, in transit, and in the cloud."

The first time you turn it on, the app first fetches whatever is already in your backup. Then it backs up every attendance record on this phone, a batch at a time. For a long history this takes minutes, not seconds. Keep the app open and online until the line under the switch says "All backed up ✓".

This needs the Attendance subscription; without it the Cloud Backup section isn't shown.

## What you'll see

You're in Settings → "Cloud Backup", which shows only with the Attendance subscription. While "Back up attendance" is on, a status line under the switch says what backup is doing. The app checks these in this order and shows the first one that applies:

- **"Paused — offline"**: the phone has no connection. Backup waits until you are back online. This shows whenever you are offline, even right after a good backup.
- **"Backing up…"**: a full backup of this phone's attendance is running, as happens when you turn the switch on. A number such as "Backing up… (12)" means 12 records are still to send.
- **"Syncing…"**: the app is sending your latest changes to your backup.
- **"Backup issue — will retry"**: recent attempts to back up failed. After a short wait, the app tries again the next time backup runs.
- **"All backed up ✓ · 3:42 PM"**: everything is backed up. The time is when the last backup finished.
- **Nothing under the switch**: nothing has been sent to your backup since you opened the app. That is normal when you have not logged or changed attendance since then.

## Good to know

**When it runs.** Backup runs a few seconds after you log or edit attendance, when you open the app, and when you open the Attendance tab. There is no schedule, and nothing runs in the background while the app is closed.

**What it needs.** Backup only runs while you are signed in, online, the Attendance subscription is active, and the app is not in maintenance.

**Turning it off.** Switching "Back up attendance" off pauses backup. Nothing is deleted: not on the phone, and not in your backup. Switching it back on backs everything up again, which is safe.

**The app offers to turn it on.** If you have the Attendance subscription and backup is off, you may see an offer at three moments:

- Right after you buy a subscription, in the "Welcome to Premium!" dialog, with "Not now" and "Back up attendance".
- After you tap "Restore Purchases", in the "Back up your attendance?" dialog.
- Once when you open the app, in the same "Back up your attendance?" dialog. It is shown only once on this phone, whatever you answer.

The offers never appear while backup is already on. You can always turn it on yourself in Settings → "Cloud Backup".

**No button to back up right away.** The "Back up attendance" switch is the only control. To nudge a backup, open the Attendance tab or reopen the app.

**Encryption.** The app describes it this way: "Encrypted on your device, in transit, and in the cloud."

**Reports on another phone.** Each report's content is fetched on its own, about one a second, so a long list takes a little while to fill in.

**Deleting the cloud copy.** There is no way to delete the cloud copy from inside the app. "Delete User Data", "Reset local data" and switching backup off all leave it in place. Contact support@recoverysky.app and mention that you want your cloud backup deleted.

## If something's wrong

- **The "Cloud Backup" section is missing.** It shows only while the Attendance subscription is active on this phone. If you have the subscription, open Settings → "Subscription" and tap "Restore Purchases".
- **It stays on "Backing up…".** The first backup of a long history takes minutes. Keep the app open and online.
- **It says "Backup issue — will retry".** See the page "If Cloud Backup isn't working".

Still stuck? Contact support@recoverysky.app and mention what the status line under "Back up attendance" says.

## Questions people ask

**Q:** Does Cloud Backup save my favorites or my clean date?
**A:** No. Cloud Backup saves only your attendance records and the reports you have sent. Favorites, your clean date and your settings stay on the phone where you made them.

**Q:** Is my attendance encrypted?
**A:** Yes. The app describes it this way: "Encrypted on your device, in transit, and in the cloud."

**Q:** How do I delete my backup?
**A:** There is no way to delete the cloud copy from inside the app. Switching backup off only pauses it. Contact support@recoverysky.app and mention that you want your cloud backup deleted.

**Q:** Why don't I see Cloud Backup in Settings?
**A:** The "Cloud Backup" section shows only while the Attendance subscription is active on this phone. If you have the subscription, tap "Restore Purchases" in Settings → "Subscription" to bring it back.
