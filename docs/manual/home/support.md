---
title: Support
area: home
screen: Home → "Support"
platforms: [ios, android]
aliases: [sponsor, "call my sponsor", "support person", "988", "crisis line", "support contacts"]
---
<!-- sources: app/components/SupportCard.tsx, app/components/SupportCardContainer.tsx, app/components/SupportContactRow.tsx, app/hooks/useRemoveSupportContact.ts, app/screens/SupportScreen.tsx, app/services/support/supportLoader.ts, app/i18n/en.ts, app/screens/SettingsScreen.tsx, docs/superpowers/specs/2026-11-06-support-contacts-design.md -->
"Support" is a card on the Home tab that puts your sponsor and the other people in your recovery one tap from a call or a text. You choose the people from your phone's own contacts, as many as you like. It is free, on iPhone and Android, and it does not appear on the web.

## How to add your sponsor or support person

You're on the Home tab, at the "Support" card. Until you add someone, it explains what the card is for: save the person in your phone's Contacts first, then add them here. The person has to be in your phone's Contacts already, because RecoverySky adds people only through the phone's own contact picker.

1. Tap the + button at the top right of the card. Your phone's contact picker opens.
2. Pick the person, then tap the phone number you want to use.
3. A sheet asks "Who is this?". Tap "Sponsor", "Support person", "Friend" or "Family".

The card then lists that person by role and name, with a call button and a text button. Tap + again to add more people; there is no limit. The Support screen's "Add a support contact" adds people the same way.

## How to remove someone

On the Home tab's "Support" card, tap the pencil button at the top right. A trash button appears next to each person, and "Done" replaces the + and pencil buttons. Tap the trash button next to a person: it asks "Remove {name} from your support contacts?" before it deletes anyone. Tap "Done" when you're finished.

On the Support screen, a person's row has a button for more options, with "Move up" (one place higher, which also moves them up on the Home card), "Change role" and "Remove". "Remove" asks the same question first.

## Calling or texting

On the Home tab's card or on the Support screen, tap the call button or the text button next to a person. RecoverySky opens your phone's own calling or messaging app with their number ready, so you press the phone's own button to place the call or send the text.

The Support screen also has:
- Your contacts, each with a call button, a text button and a button for more options.
- "Find a live meeting now", which opens Meetings → "Online" so you can join a meeting that is running right now.
- "988 Suicide & Crisis Lifeline", with a call button and a text button. This row shows only when your phone's region setting is the US or Canada.

In My Day, the "Get support now" button on the card that says "You don't have to get through this alone" opens this same Support screen.

## Good to know

**Only names are shown.** The card and the Support screen show a role and a name, never their phone number. The only number shown is the 988 line. Once you tap to call or text, your phone's own calling or messaging screen shows the number. A contact saved without a name on your phone shows only the role, such as "Sponsor".

**Where the number lives.** Each number is kept in your phone's secure storage. RecoverySky never sends it to its servers or anywhere else, and it is not part of "Back up attendance" in Cloud Backup. A full backup of the phone itself, or moving to a new phone from that backup, can bring it along with the phone's other data. The contacts stay on this phone when you sign out. They are removed by Settings → "Account" → "Delete User Data", and by deleting the app and installing it again on the same phone.

**RecoverySky never reads your contact list.** It only receives the one person and number you pick in the phone's picker, so it asks for no contacts permission.

**Who sees it.** Home and the Support screen need your account, so a guest does not have them.

## If something's wrong

- **"Couldn't open the contacts picker"**: the picker could not open, or the person you picked has no phone number the app can read. Check that your phone's Contacts app opens and that the contact has a number, then tap + on the card again.
- **"That contact is already in your list"**: that phone number is already in your support contacts. Pick a different person or number.
- **"Couldn't open the phone app"**: your phone has no calling or messaging app that can take the number, as on some tablets. Dial the number from another phone or app.
- **The card is missing**: it is hidden on the web, and on a phone that has not yet been updated to a version with Support.
- **The card or your contacts are missing just after your phone starts up**: the card and the contacts on the Support screen stay hidden until the phone has been unlocked, because they can't be read before then. Unlock the phone and come back to RecoverySky.

Contact support@recoverysky.app and mention that you're using the Support card, what you tapped and which message you saw.

## Questions people ask

**Q:** How do I call my sponsor from the app?
**A:** Save your sponsor in your phone's Contacts first. Then, on the Home tab, tap + on the "Support" card, pick your sponsor and tap their number, and answer "Who is this?" with "Sponsor". After that, the call button next to their name opens your phone's calling app.

**Q:** Is my sponsor's phone number private?
**A:** Yes. RecoverySky never sends the number to its servers or anywhere else, and the app never reads your contact list. The card only shows a name. The number is kept on your phone, so a full backup of the phone itself can carry it to a new phone along with the phone's other data.

**Q:** Where is the crisis line?
**A:** Tap the "Support" title on Home to open the Support screen. In the US and Canada, it has a "988 Suicide & Crisis Lifeline" row with a call button and a text button.
