# Support contacts: call your sponsor from Home and from My Day's crisis path

Status: implemented on root (plan docs/superpowers/plans/2026-11-06-support-contacts.md); device pass pending; ships in the next native release. Drafted 2026-11-06 from a brainstorm with Jenova.

The Daily Dash team was asked first (2026-11-06) and answered that the host app owns this: the
`@daily-dash/my-day` navigation contract says `openCrisisPath` "opens the host's crisis path:
meetings, support contacts, a crisis line. The host's own screen; My Day never names a number, a
URL or a screen for it", and their own support screen lives in their host app, not the package.

Ships as a **native release** (a new native module, a removed Info.plist key): bump `version` and
`runtimeVersion` together. Expected to be 4.13.0, after the 4.12.0 iOS submission is live. The
bump itself is a release-time step done the house way (`npm run minor`, then the manual
`runtimeVersion` and Android `versionCode` edits, as 4.12.0 did), not a task of the
implementation plan; the plan ends with a dev build verified on a real iPhone and a real Android
phone.

## Why

The one call that matters most in a hard moment is the sponsor's, and the app cannot make it
today. People without a formal sponsor have a support person instead. The call has to be one tap
from the Home tab with no number ever typed, and the My Day check-in's crisis card should land
somewhere that offers that call rather than only a meeting list.

## What the person gets

- **Up to three support contacts**, in the order they chose, each shown by **name and role
  only**. The first is the primary.
- **A Support card on the Home tab.** Until a contact exists it reads "Add your sponsor or
  support person" with a Choose button that opens the phone's own contact picker. Once one
  exists it shows the primary contact's role and name with **Call** and **Text** buttons.
  Tapping the card's title opens the Support screen.
- **A Support screen** (an app-level modal, like Import and Terms) with, top to bottom: the
  contacts (each a row with role, name, Call and Text, plus an overflow with Move up, Change
  role and Remove), an **Add** row until there are three, **Find a live meeting now** (the
  Meetings tab's Online segment), and, when the device's region is the US or Canada, a
  **988 Suicide & Crisis Lifeline** row with Call and Text.
  CHANGED 2026-11-06 (final review I-1): the screen is a plain app-stack card, not a modal. A
  native iOS modal covers the root view, and `ToastProvider` renders in the root RN tree, so
  every toast the screen fired drew behind it.
- **My Day's crisis path opens the Support screen.** The check-in's crisis and support cards
  and the Support button already call `openCrisisPath`; it now lands here instead of Meetings →
  Online. "Find a live meeting now" on this screen keeps that destination one tap away.

Nothing automatic: no auto-dial, no "tried just now", no nudging toward the next contact. The
person knows who they just called and picks the next one themselves (Jenova, 2026-11-06).

## Decisions

**D1. Names only, never the number.** The app never renders a contact's number: not on the card,
the screen, an accessibility label, a toast, an alert, a log line, an analytics event, a Sentry
breadcrumb or an error message. The person should not be reminded that we hold it. The OS shows it
at dial time (iOS asks "Call +1 …?", Android opens the dialer filled in); that is the phone's
behaviour and accepted.

**D2. The phone's picker, through our own tiny native module, not `expo-contacts`.** Verified
2026-11-06:
- `expo-contacts` (SDK 54) documents `presentContactPickerAsync` as needing `READ_CONTACTS` on
  Android. Its Kotlin shows why: after the pick it re-queries `ContactsContract.Data` by contact
  id instead of reading the URI the picker returned. Its config plugin also writes
  `READ_CONTACTS` and `WRITE_CONTACTS` into our manifest. A recovery app asking for the whole
  address book is a trust hit on the Play listing, and a refused runtime prompt kills the
  feature.
- Android's own guidance: `ACTION_PICK` with `CommonDataKinds.Phone.CONTENT_TYPE` returns a URI
  the app may read "even if your app doesn't include the `READ_CONTACTS` permission".
- Apple: "The app using contact picker view does not need access to the user's contacts and the
  user will not be prompted for 'grant permission' access. The app has access only to the
  user's final selection."

So: a local Expo module under `modules/` (Expo Modules API, autolinked) exposing one function,
`pickPhoneContact(): Promise<{ name: string; number: string } | null>` (`null` on cancel).
Android: `ACTION_PICK` + `Phone.CONTENT_TYPE`, read `DISPLAY_NAME` and `NUMBER` from the
returned URI. iOS: `CNContactPickerViewController` with `displayedPropertyKeys` limited to phone
numbers and `predicateForSelectionOfProperty` on `phoneNumbers`, so the person taps the exact
number and the delegate receives one `CNContactProperty`. Both sides therefore pick one number,
which settles the "contact has three numbers" case in the OS's own UI. No manifest permissions,
no usage-description prompt, nothing new on the Play Data safety form.

The module's contract: `null` means the person cancelled, and nothing else does. Every other
failure rejects with a coded error: `no_picker` (Android could not resolve a picker activity),
`no_number` (the picked row carried no number or no readable name and number), `in_progress`
(a pick is already open). The app shows one toast for any of them, "Couldn't open the contacts
picker", and logs the code alone.

Web, and any platform where the module is absent: the Home Support card is not rendered at all
(its point is the contact), and the Support screen hides its contacts section but keeps the
live-meeting row and the crisis row. My Day is hidden on web, so its crisis path never fires
there; the screen stays registered regardless.

**D3. Up to three contacts with a role from a fixed set.** Roles: Sponsor, Support person,
Friend, Family (translatable, no free text). After a pick, a small sheet asks for the role,
defaulting to Sponsor for the first contact and Support person afterwards. Reordering is "Move
up" on the row's overflow, no drag. The primary is simply the first row.

Rules for the pick, all in one pure module: a number already in the list (compared after
stripping everything but digits and a leading `+`; the normalised form is internal and never
rendered) is refused with the toast "That contact is already in your list", so the same person
cannot fill two rows. A picked contact with an empty display name is kept and shown by its role
alone. Names render on one line and truncate; nothing is stored shortened. The number is stored
exactly as the OS returned it, because `tel:` accepts what the dialer accepts.
CHANGED 2026-11-06 (final review I-2): stored verbatim still, but cleaned on the way to the dialer
by `dialableNumber`: formatting goes, a pause, wait, `*` and `#` stay, an extension becomes one
pause, and a number it cannot read (vanity letters, a misplaced `+`) is refused at add time. Merging
those characters into the digits rang a longer, wrong number with no error.

**D4. Storage: SecureStore, and nowhere else.** One key, `support_contacts_v1`, holding a JSON
array of up to three `{ role, name, number }` (well under SecureStore's 2 KB limit). Never in an
MST snapshot or MMKV, never in SQLite, never in cloud backup or any API call, never in logs or
analytics. It is the device owner's data like everything else local: it **survives logout** and
is cleared by Settings → Delete User Data (its own step beside the existing SecureStore step),
by the database overlay's **Reset local data**, and by the dev purge. The overlay matters for the
same reason My Day's reset joined it (My Day spec §4.9): that Reset clears `ownerSub`, after
which a different account can sign in on the phone, and it must not find the previous owner's
sponsor on Home. As with My Day, the clear function is injected into `DatabaseProvider` from
`app.tsx` and runs beside `resetLocalDatabase()`, never inside it, so `app/db/` imports nothing
new.

The keychain outlives an uninstall on iOS, and the key would otherwise greet whoever installs
the app next on that phone. So the key is also cleared on a **fresh install**, detected the way
the app already tells one apart: no persisted root-store snapshot in MMKV at startup (MMKV is
deleted with the app, the keychain is not). A person who reinstalls picks their contacts again;
that is the cost, and it matches the non-goal below. Whatever holds the contacts in memory must
contribute nothing to `onSnapshot`.

CHANGED 2026-11-06 (final review I-3, M-6): a read that fails is "unknown", not "empty". Before
this, a locked keychain hydrated as no contacts, the card asked someone with a sponsor to add one,
and the next edit overwrote the real list for good. Now a failed read leaves the store un-hydrated,
the store refuses edits, the card and the screen's contacts hide (the screen keeps Find a live
meeting and the 988 row), and the read is retried when the app next comes to the foreground. A
fresh-install clear that fails leaves the previous installer's contacts unread and is retried the
same way.

**D5. The crisis line is keyed on the device region, US and Canada only.** The app's language
setting is a language, not a country, so the key is `getLocales()[0].regionCode` from
`expo-localization` (already a dependency; the In-Person map uses the same value). `US` and `CA`
show the 988 row with Call (`tel:988`) and Text (`sms:988`); any other region, or no region,
shows no crisis row. Adding regions later is a table change in a pure module.

**D6. The Support route lives in the signed-in branch of the app stack only.** It is registered
beside Import, Licenses and Terms, so a guest (who gets only the Meetings tab) can never reach
it, and no `isGuest` guard is needed. My Day's adapter navigates to `Support`; the My Day stack
lacks that route, so React Navigation bubbles it up through the tab navigator to the app stack,
the same trick `openCrisisPath` uses for `Meetings` today. This amends My Day spec D3
(`docs/superpowers/specs/2026-10-25-my-day-tab-design.md`); note it there.

The route is registered exactly where Import is: signed in and onboarding complete. Nothing
reaches it earlier, and it gets no exemption from the overlay gates (`VerifyEmailGate`,
`AnnouncementGate`): those are modals above the whole navigator, My Day is not reachable while a
mandatory one is up, and a skippable one has "Not now".

**D7. Calling and texting are `Linking.openURL` with `tel:` and `sms:`**, the way the In-Person
popup dials a venue. A failure (simulator, web, no phone app) shows a toast "Couldn't open the
phone app" and logs only a code. No `CALL_PHONE` permission; the extra OS tap is accepted.

**D8. Home card placement.** The Support card sits directly under the News card and above Clean
Time, because a crisis need outranks the dashboard (my call; move it if the Home tab reads
wrong). It is not one of the dismissible help cards. The existing "Need Help?" help card with its
"Get Support" link to the website stays as it is.

**D9. Analytics carry event names only**: `support_contact_added`, `support_contact_removed`,
`support_call`, `support_text`, `support_crisis_call`, `support_crisis_text`. No payload.

**D10. Clean up the stale iOS key.** `app.json` carries
`NSContactsUsageDescription: "Contacts access enables inviting friends to meetings"`, a leftover
from the old app. The picker never triggers that prompt, so the key is removed in this release.

## Privacy, in one place

A sponsor's name and number are among the most sensitive things this app will hold. D1, D2, D4
and D9 are the whole policy: picked through the OS, kept in the keychain, shown by name, never
transmitted, never logged. The manual's privacy answer for this feature is "the app keeps the
name and number on this phone only, never sends them anywhere, and never shows the number".

## Copy (English; the other eight locales ship English placeholders)

- Card: title "Support"; empty state "Add your sponsor or support person", button "Choose";
  set state shows "<Role> · <Name>", buttons "Call" and "Text".
- Screen: title "Support"; rows as above; "Add a support contact"; "Find a live meeting now";
  crisis row "988 Suicide & Crisis Lifeline" with "Call" and "Text"; overflow items "Move up",
  "Change role", "Remove"; remove confirmation "Remove <Name> from your support contacts?".
- Role sheet: "Who is this?" with Sponsor, Support person, Friend, Family.
- Toast: "Couldn't open the phone app".

## Also in this change

- `runtimeVersion` and `version` bump; CHANGELOG under Added (no tracker issue).
- i18n: every new key in all nine locale files, plus a `docs/translation-review-2026-08-03.md`
  entry.
- Manual: a new page under `docs/manual/home/` for the card and screen, a `map.md` line, and
  `questions.yml` entries ("call my sponsor", "is my sponsor's number private").
- Accessibility: every control carries labels built from role and name, never the number.
- Delete User Data, the database overlay's Reset, the fresh-install check and `devPurge` clear
  `support_contacts_v1`.
- My Day spec D3 amended; the adapter's crisis target changes; its tests follow.

## Non-goals

- No sync, backup or restore of contacts. A new phone, or a reinstall, means picking again.
- No reading of the address book, ever: no refresh of a changed number, no search by name.
- No in-app calling, messaging, or call logging. No record of when a contact was called.
- No crisis lines outside the US and Canada in v1.
- No Settings row; the Support screen owns add, reorder and remove.

## Left to the builder

- How the contacts are held in memory (an MST store with volatile state only, or a hook over a
  small module), as long as D4's "nothing reaches a snapshot" holds and the Home card and the
  screen re-render together.
- The exact layout of the card and the screen within the app's theme; the overflow control's
  form (action sheet or menu).
- The local module's name and the Kotlin/Swift details beyond D2; dev-build verification on a
  real iPhone and a real Android phone that no permission prompt appears and that cancel
  resolves `null`.
- Whether the role sheet is a bottom sheet or an alert with four buttons.

## Builder check (2026-11-06)

A fresh reviewer read the draft as a builder and asked seven questions. All were settled in the
text above without a product decision: the overlay Reset and the fresh-install clear (D4), the
web card and the module's error codes (D2), duplicates, empty and long names (D3), the gates
(D6), and the bump being a release-time step (Status).
