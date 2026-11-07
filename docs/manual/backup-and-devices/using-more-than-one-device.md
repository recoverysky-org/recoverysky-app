---
title: Using RecoverySky on more than one device
area: backup-and-devices
screen: Settings → Cloud Backup
platforms: [ios, android]
tier: attendance
aliases: ["two phones", "second device", tablet, "sync between devices", "favorites didn't move", "didn't come over"]
---
<!-- sources: docs/BACKUP.md, app/screens/SettingsScreen.tsx, app/services/sync/attendanceSyncService.ts, app/services/sync/syncLogic.ts, app/db/feedbackCache.ts, app/services/api/index.ts, app/models/ProfileStore.ts, app/context/SubscriptionContext.tsx, app/hooks/useReminders.ts, app/i18n/en.ts, app/i18n/platformStrings.ts, app/screens/login/guestEntryLogic.ts, app.json, CLAUDE.md, app/hooks/useAgentConversation.ts, docs/superpowers/specs/2026-11-06-agent-chat-turn-only-design.md -->
You can use RecoverySky on more than one phone or tablet. Sign in with the same account on each one, and turn on "Back up attendance" on each one. Your attendance records and the reports you have sent then move between them through Cloud Backup. This needs the Attendance subscription. With Premium, your conversation with Sky also shows on each device, because Sky keeps it on RecoverySky's servers under your account. Nothing else you save in the app moves between devices.

## How to set up a second device

You're on the new device.

1. Sign in the same way you did on your first device: the same Apple, Google or email address.
2. Open Settings → "Subscription". If the "Status" row does not show your subscription, tap "Restore Purchases". Your subscription belongs to your account, not to a phone.
3. In Settings → "Cloud Backup", turn on "Back up attendance". The switch is remembered on each device, so you turn it on on every device you use.
4. Keep the app open and online until the line under the switch says "All backed up ✓".

This needs the Attendance subscription; without it the Cloud Backup section isn't shown.

## What moves between your devices

Two things move between your devices through Cloud Backup, which needs the Attendance subscription:

- **Attendance records.** New records, edits, archived records and deleted records all move.
- **The reports you have sent.** Reports arrive on the other device a few at a time.

When you turn on "Back up attendance" on a device, the app backs up that device's whole attendance history, not only what you log from then on.

When the same record is changed on both devices, the latest change wins.

**Your conversation with Sky** moves too, without Cloud Backup. Sky keeps it on RecoverySky's servers under your account, not on the phone, so the Sky Agent tab shows it on each device signed in to that account. The Sky Agent tab needs Premium. "New conversation" on one device starts it over on the others the next time you open the tab there.

## What stays on each device

These are not part of Cloud Backup, so they do not move to another device:

- **Your clean date and profile**, including your fellowship. They stay on the device where you set them.
- **Favorites (hearts) and star ratings.** They stay on the device where you tapped them.
- **Meeting reminders.** A reminder you set shows only on the device where you set it.
- **Your settings**, such as theme, language and the Meetings filters. They stay on the device where you chose them.
- **Money saved, and the start date of a 90-in-90 challenge.** They stay on the device where you set them up.
- **Attendance on a device where "Back up attendance" is off.** Those records stay on that device until you turn backup on there.

On a new device, set these up again by hand.

## Good to know

**Timing.** A change is sent to your backup a few seconds after you make it. The other device picks it up when you open the app there, or when you open its Attendance tab. Both devices need to be online.

**Reports.** Reports arrive a few at a time, so a long list takes a little while to fill in.

**Tablets.** A tablet running the app works like a second phone: same account, and "Back up attendance" turned on there too.

**Guest mode.** On Android, "Just join meetings" opens the Meetings tab with no account. A guest has no account, so nothing syncs, and none of your records are shown to a guest.

## If something's wrong

A record is missing on your other device. Check these, in order:

1. Both devices are signed in with the same account.
2. "Back up attendance" is on in Settings → "Cloud Backup" on both devices.
3. Both devices are online.
4. Wait a few minutes, then open the Attendance tab on the device that is missing the record.

Still missing? Contact support@recoverysky.app and mention which device is missing what, and the status line under "Back up attendance" on each.

## Questions people ask

**Q:** My favorites didn't come over to my new phone.
**A:** Favorites are not part of Cloud Backup. They stay on the phone where you tapped them. Only attendance records, the reports you have sent and your conversation with Sky move between phones. Heart your favorite meetings again on the new phone.

**Q:** Can I use RecoverySky on two phones?
**A:** Yes. Sign in with the same account on both, and turn on "Back up attendance" in Settings → "Cloud Backup" on both. Your attendance records and sent reports then move between them. This needs the Attendance subscription.

**Q:** I edited a meeting record on both phones. Which one counts?
**A:** The latest change wins. The record ends up as you last changed it, on whichever phone that was.
