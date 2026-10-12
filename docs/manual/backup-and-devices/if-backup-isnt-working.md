---
title: If Cloud Backup isn't working
area: backup-and-devices
screen: Settings → Cloud Backup
platforms: [ios, android]
tier: attendance
aliases: ["backup stuck", "paused offline", "backup issue", "will retry", "not syncing", "not backing up", "missing on other phone"]
---
<!-- sources: app/screens/SettingsScreen.tsx, app/i18n/en.ts, docs/BACKUP.md, app/services/sync/attendanceSyncService.ts, app/services/sync/index.ts, docs/support/problems/data-missing-after-new-phone.md, app/components/MaintenanceBanner.tsx, app/utils/connectivityLogic.ts -->
When "Back up attendance" is on, a status line under the switch in Settings → "Cloud Backup" says what backup is doing. This page explains each status and what to try. Cloud Backup needs the Attendance subscription.

## What the status line means

You're in Settings → "Cloud Backup", and "Back up attendance" is on. This section shows only with the Attendance subscription.

- **"Paused — offline"**: the phone has no connection. Backup picks up again when the connection is back. This shows whenever you are offline, even right after a good backup.
- **"Backing up… (37)"**: 37 records are still to send. Records go in batches with a pause between them, so the first backup of a long history takes minutes. Keep the app open and online.
- **"Syncing…"**: the app is sending your latest changes to your backup. It clears by itself.
- **"Backup issue — will retry"**: recent attempts to back up failed. The app waits half a minute, then a minute, then five minutes between tries. After the wait, it tries again the next time backup runs: when you log or edit attendance, open the app, or open the Attendance tab. Check your connection first.
- **Nothing under the switch**: nothing has been sent to your backup since you opened the app. That is normal when you have not logged or changed attendance since then.

## If the Cloud Backup section is missing

You're in Settings, and there is no "Cloud Backup" section.

The section shows only while the Attendance subscription is active on this phone. If you have the subscription, open Settings → "Subscription" and tap "Restore Purchases". The section comes back once the subscription shows.

If you never subscribed, Cloud Backup is not available. It needs the Attendance subscription.

## If records are missing on your other phone

A record you logged on one phone does not show on the other. Check these, in order:

1. Both phones are signed in with the same account.
2. "Back up attendance" is on in Settings → "Cloud Backup" on both phones.
3. Both phones are online.
4. Wait a few minutes, then open the Attendance tab on the phone that is missing the record.

Reports arrive a few at a time, so a long list takes a little while. A record that was edited on both phones keeps the latest change.

## Good to know

**Maintenance and network banners.** If a banner at the top says "Maintenance in progress. Some features disabled." or starts with "Network issues", backup waits until the banner clears.

**Backup runs while the app is open.** There is no backup in the background. It runs when you log or edit attendance, open the app, or open the Attendance tab.

**Turning it off loses nothing.** Switching "Back up attendance" off pauses backup. Nothing is deleted on the phone or in your backup. Switching it back on backs everything up again.

**One stuck record.** Rarely, a single old record never backs up while the rest do. Contact support@recoverysky.app and mention the date of the record that is missing.

## If something's wrong

Don't delete anything first.

Contact support@recoverysky.app and mention what the status line under "Back up attendance" says, whether you have the Attendance subscription, and which records are missing where.

## Questions people ask

**Q:** What does "Paused — offline" mean?
**A:** Your phone has no connection right now. Backup picks up again by itself when you are back online. It shows whenever you are offline, even if everything was already backed up.

**Q:** It says "Backup issue — will retry".
**A:** Recent attempts to back up failed. Check your connection. After a short wait, the app tries again the next time you log attendance, open the app, or open the Attendance tab. Still there after that? Contact support@recoverysky.app and mention what the status line says.

**Q:** Why don't I see Cloud Backup in Settings?
**A:** The "Cloud Backup" section shows only while the Attendance subscription is active on this phone. If you have the subscription, tap "Restore Purchases" in Settings → "Subscription".
