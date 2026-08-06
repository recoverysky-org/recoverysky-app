# Changelog

All notable changes to RecoverySky Hybrid are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
for native releases plus an OTA counter for JS-only patches.

## Versioning

Each release entry uses one of two heading shapes:

- `[X.Y.Z]` — native release (matching `version` and `runtimeVersion` in `app.json`).
  Requires a new build installed via the App Store / Play Store / TestFlight.
- `[X.Y.Z-N]` — OTA release on top of the `X.Y.Z` native build, where `N` is the
  `update` counter in `package.json`. Reaches every user already on a matching
  `runtimeVersion`. Visible in Settings as `v{version}-{update}`.

Categories used: `Added` / `Changed` / `Fixed` / `Removed` / `Deprecated` / `Security` / `Docs` / `Build`.

---

## [Unreleased]

### Added

- **In-person meetings are now searchable.** The Meetings tab's Search segment
  gained a **Venue** filter (Online / In-Person) and, with it, in-person
  listings — which Search had been holding back while the In-Person segment was
  built. In-person results get the in-person row and popup (venue, address,
  directions, "I'm Here"), not the online one whose main action is a Zoom link
  they don't have. Choosing Online skips the in-person fetch entirely rather
  than fetching and discarding.

- **Radius filter on the Search segment**, offering exactly the same distances
  as the In-Person segment. It narrows the in-person half of the search via the
  nearby endpoint, and results carry a distance badge. It's greyed out when
  Venue is Online — online meetings have no place, so a distance can't include
  or exclude them.

  Location is never requested on arrival: opening the radius picker is what
  asks, since reaching for that control is the unambiguous "I care how far away
  these are" signal. Until the app knows where you are the radius can't
  actually narrow anything, so it shows dimmed and the picker says why, rather
  than displaying a distance it isn't enforcing. If location is refused or the
  fix times out, the search still returns the whole day rather than nothing.

- **Time filter on the Search segment**, sharing the In-Person segment's four
  buckets (Morning / Afternoon / Evening / Overnight) plus **Custom**, which
  reveals the existing Start/End hour pickers. Those pickers used to occupy a
  permanent row that most people never touched; they now appear only when
  asked for, which is what freed the space for the new filters.

- **Fellowship filter on the In-Person segment**, matching the one on the Live
  segment: pick AA / NA / whichever fellowships the build offers, without
  leaving the tab. Like Live's, it's a browse control — it filters what you're
  looking at now and deliberately does **not** change the fellowship saved in
  Settings, so the rest of the app is unaffected. Changing the preference in
  Settings still wins and resets the segment back to it. Unlike Live's, the
  choice is sent to the server (in-person meetings are fetched per fellowship
  rather than filtered locally), so switching refetches the list. Users who
  have never picked a fellowship now get a tappable prompt that opens this
  picker, replacing copy that sent them to Settings for a control that is now
  on the screen in front of them.

- **Time-of-day filter on the In-Person segment.** A selector alongside
  Fellowship, Day and Radius narrows the list to Morning (5am–noon), Afternoon
  (noon–5pm), Evening (5pm–10pm) or Overnight (10pm–5am), defaulting to "Any
  time". Boundaries follow recovery meeting culture rather than the plain
  calendar split — a 6am sunrise meeting belongs to Morning, and Overnight
  reaches across midnight to 4:59am so the small-hours meetings are findable as
  a group instead of being scattered. The bucket is applied client-side to the
  already-fetched day, so changing it is instant and issues no request, and it
  resets to "Any time" on each visit rather than persisting — a list silently
  narrowed by a tap from last week is worse than one extra tap. When the filter
  empties a day that does have meetings, the empty state says so and opens the
  time picker, instead of the old copy blaming the search radius and sending
  the user to widen a search that was never the problem.

- Subscribing from Settings now offers to turn on Cloud Backup. Previously a
  new subscriber saw a plain "Welcome to Premium!" confirmation and had to
  find the Cloud Backup toggle themselves — a section that only appears once
  they're subscribed, so most never did and their attendance history stayed
  device-only. The confirmation now asks directly, with **Back up attendance**
  turning it on (running the same initial backup as the toggle) and **Not
  now** leaving it off. Only shown when the attendance entitlement is live and
  backup is still off, so it never nags an existing backup user. Purchases
  that were interrupted by a premium gate elsewhere in the app are unaffected
  — those still return you straight to what you paid for rather than putting a
  dialog in front of it.

- In-person meeting data now loads into memory alongside online meetings: the
  live and daily schedule fetches pull both venue pools (`venueType=online` +
  `venueType=in_person`) and merge them, and deep-link meeting lookups fall
  back across pools. No visible change — existing screens keep showing online
  meetings only until the in-person UI ships (hold-back projection); this is
  the data foundation. One pool failing degrades gracefully to the other
  instead of blanking the list. The in-person pool is filtered client-side
  against a server that ignores `venueType` (the currently-deployed
  production API does; it silently strips the unknown param and returns the
  online set for both calls), so the hold-back holds even before the API's
  in-person support ships — but that API branch should still land in
  production before this OTA goes out, since until then the in-person fetch
  is pure overhead with no data behind it.
- **In-Person meetings** — the Meetings tab's new In-Person segment is now
  live. It finds face-to-face meetings near you, nearest first, with the
  distance shown on each row. Location is only requested the first time you
  open the segment, never at app start, and the search radius (10 / 25 / 50 /
  100 km, shown in miles on US devices) is remembered between launches. If
  location is unavailable — you declined it, the GPS couldn't get a fix, or
  the nearby search failed — the segment falls back to a plain browse-by-day
  list and shows a tappable strip explaining why, which either retries or
  takes you to the OS Settings page depending on the reason. A day picker
  browses any weekday.

  Tapping a meeting opens a detail sheet with venue name/address, an
  approximate-location caveat when the source flags its geocode as such, a
  "Get Directions" button (platform maps deep link, falls back to the Google
  Maps web URL if no app handles it), published contacts (tap to call or
  email), the same weekly schedule grid + reminder editor as the online
  popup, and an "I'm Here" button — shown whenever attendance tracking is
  enabled, independent of Cloud Backup — that logs attendance for the day
  with a guard against double-logging the same meeting.

  Your coordinates are used for the nearby search and nothing else: they are
  never written to storage, never logged, never attached to analytics, and
  scrubbed out of crash reports on both platforms (see the Security entry
  below). Translated into all nine app locales (best-effort for seven of them
  — see `docs/translation-review-2026-08-03.md` for the native-speaker review
  queue).

- **Screen-reader support for the weekly schedule grid, onboarding progress
  dots, and the Terms / Licenses screens.** First pass of an app-wide
  accessibility sweep over older surfaces that predate the standard in
  `CONTRIBUTING.md` — the newer In-Person work already met it.

  The schedule grid was the worst of them. Each cell announced only a bare time
  ("7:00p") because the day lived purely in the column position, which a screen
  reader can't see; whether a reminder was set — and whether it was on or off —
  was carried entirely by the gold or grey fill, which is invisible to
  VoiceOver and also fails as a colour-only signal for low-vision users. Cells
  now announce "Monday, 7:00p, reminder on", the continuous-meeting sentinel
  reads as "runs continuously, 24 hours" instead of the literal "24h" glyph,
  and the hint distinguishes creating a reminder from editing one. The empty
  spacer cells — five of every seven in a typical row — were leaving silent,
  unlabelled stops between real times and are now hidden from the
  accessibility tree on both platforms.

  The onboarding progress dots were 8pt circles with no label at all: they now
  announce "Step 3 of 7" with the selected state, and don't promise navigation
  when tapping the dot you're already on. The Terms and Licenses modals had a
  bare close glyph with no label, which left them with no exit a screen reader
  could find. Toast's tappable variant, the crash screen's heading, and the
  agent results header got labels and header roles as well.

  Adds a full set of weekday names plus grid and onboarding strings to all nine
  locales; the eight non-English ones are machine-assisted and join the
  native-speaker review queue. Arabic interpolates a Latin-digit clock time
  into RTL text and is flagged for a device check, the same caveat already
  noted for `{{distance}}`.

- **In-person attendance is now location-verified and timed.** Tapping "I'm
  Here" checks where you are and only starts recording once you're actually at
  the meeting — if you're not there yet, it tells you how far you have to go.
  Attendance is then the real time you spent, ended by you, followed by the
  same topic and host prompt online meetings use. The saved record stores where
  your attendance was confirmed. Meetings we don't have a precise location for
  can't be verified and can't be logged; that source data is being corrected.

### Changed

- **Favourites and star ratings now order the In-Person and Search lists too**,
  the same way the Live segment has always ordered its own: favourites first
  (highest-rated first), then anything else you've rated or joined, then the
  rest. It layers over each list's existing order rather than replacing it, so
  within every group In-Person is still nearest-first and Search is still by
  start time. In-Person rows also gained the heart and star glyphs — they were
  the one meeting list not showing them, and without them a favourite sitting
  above a nearer meeting just looks like a broken distance sort.

  As on Live, the order is fixed when the list loads: tapping a heart lights it
  up immediately but doesn't move the row out from under your finger — it
  settles into its new position on the next refresh.

- **The Live segment is now titled "Live Online"** (was "Live Meetings"), in all
  nine locales. It has only ever listed online meetings, and standing next to an
  In-Person segment the old title read as "live meetings of any kind".

- **Search's Venue filter offers Online and In-Person only** — the "All" choice
  is gone, and Online is the default. A mixed list is the one result set where
  a row's most important fact (can I walk there, or do I open Zoom?) had to be
  carried by a small tag, and every other list in the app is single-venue. With
  it goes the per-row "Online" tag, which now restated the filter the user had
  just set. Defaulting to Online also means arriving on Search still asks for
  nothing: the in-person leg, and with it the location prompt, is skipped until
  you choose In-Person.

- **Recovery Dharma (RD) is a selectable fellowship again**, alongside AA, NA
  and CMA — in Settings, onboarding, and the Live / Search / In-Person meeting
  filters. Config-only change (`EXPO_PUBLIC_FELLOWSHIPS`); RD's display names,
  badge colour and clean-time wording were never removed, so nothing else
  needed restoring.

- **In-person meeting details now carry the same header as online ones.** The
  in-person sheet used to stop at time and duration; it now also shows how many
  times a week the group meets, its language, and its meeting-type tags, and it
  gained the favourite heart and 5-star rating. The rating gap was the pointed
  one: an in-person row already displayed hearts and stars, so a user could see
  a rating with nowhere to set it. A meeting shouldn't tell you less about
  itself because it happens to have an address.

- **Distance badges on in-person search results**, not just on the In-Person
  tab. Distance previously came only from the nearby endpoint, so it appeared
  in Search only while a radius was set — the same meeting showed a distance
  under one radius setting and none under another, with nothing on screen
  explaining the difference. It's now measured on-device from the venue's own
  coordinates, so it shows whenever the app knows where you are. That never
  triggers a new permission prompt: Search checks for a grant you've already
  given (usually on the In-Person tab) and stays quiet if there isn't one.
  Computing it locally also means these coordinates never leave the device.

- **One meeting card everywhere.** The Live, In-Person and Search lists had
  drifted into two different rows for the same thing — online meetings got a
  square fellowship badge on one line, in-person meetings a vertical accent bar
  and two. Search showing both venues at once made the mismatch visible in a
  single scroll. There is now a single card that adapts to the meeting it's
  given: the accent bar for everything, with the fellowship moved into a
  subtitle line beside the venue and city (which are simply absent for online
  meetings), and the language shown after the start time. Favourites, star
  ratings, reminder bells, the hybrid globe, the external-Zoom marker and the
  distance badge all survive — and favourites and ratings now show on
  in-person meetings, which the old in-person row couldn't display at all.
- **The Search filters are now a 2×3 grid** — Fellowship + Venue, Day + Time,
  Radius + Lang. Fellowship used to own a full-width row for a two-letter
  value. The Language cell's label is shortened to "Lang" in every locale
  because at half width the full word collided with native language names
  ("Português", "Українська").
- **The In-Person filters are now a 2×2 grid** — Fellowship and Radius on top,
  Day and Time below — rather than a row of two plus a full-width third.
  Four full-width rows would have pushed the first meeting off the fold on a
  small phone.
- The In-Person radius selector is now labelled "Radius" (was "Search
  Distance", then briefly "Distance"), in all nine locales, and its value shows
  a bare distance like "25 mi" instead of "Within 25 mi". At half width the
  label and the longer value collided and rendered as "RadiusWith…" — hiding
  the number, which is the only part that matters. Screen readers still get the
  full "Within 25 mi" phrasing.
- Meetings tab: Listings segment renamed Search, and a third In-Person
  segment sits between Live and Search (see Added). The Search rename covers
  all nine app locales for naming consistency (translations pending
  native-speaker review).
- The Listings API client no longer sends the `includeExternal` query param on
  `/schedules/live` or `/schedules/daily`. External is the only mode now (the
  in-app Zoom SDK was removed in 4.5.0), so the server returns external meetings
  by default; the flag and its `options` plumbing were removed as dead code.

- The in-person and online attendance timers now share one implementation, so
  a fix to either reaches both.

### Build

- Bumped `@recoverysky-org/common` `^2.2.0` → `^2.2.1` (version-only bump in
  the linked common lib; no schema or code change).
- Bumped `@recoverysky-org/common` `^2.2.1` → `^2.4.1` (adds the PostGIS-backed
  geo search models behind the new `/schedules/nearby` route).
- Jest no longer reports "No tests found" when run from inside a git worktree.
  The `.claude/worktrees` ignore pattern was an unanchored regex matched against
  each file's absolute path, so from a worktree — whose own path contains
  `/.claude/` — it excluded the entire suite and exited green having run nothing.
  Anchoring it to `<rootDir>` keeps the double-discovery guard working from the
  main checkout while letting the suite run inside a worktree.

### Fixed

- **Leaving the app's current tab while an attendance timer was running lost
  the whole meeting.** Switching tabs — or, far more likely, tapping a meeting
  reminder notification, which navigates on your behalf — tore down the screen
  holding the timer and stopped the clock, with no way back to it short of
  restarting the app. If you simply pocketed the phone, the session expired
  after six hours and the attendance was gone. The app now refuses to navigate
  away while a timer is running, and the tabs grey out to show why. Saving or
  cancelling releases it, as before. This applies to both the in-person and
  the online timer.

- **Android: "Enable location to see meetings near you" came back on every app
  restart, even with location already allowed — and tapping it always worked.**
  The permission was never the problem. The app asked Android for a brand-new
  position and gave up after ten seconds, which a cold phone indoors regularly
  misses; the first attempt warmed up the hardware, so the tap that followed
  succeeded and looked like the fix. It now starts from the position Android
  already has (no wait, no hardware wakeup) and only asks for a fresh one to
  refine it, so a granted user is located immediately on launch. The banner
  also tells the truth when a fix genuinely fails: it says the location
  couldn't be obtained and offers a retry, instead of telling someone to switch
  on a setting they already switched on.

- **No location meant a worldwide list of in-person meetings.** Both the
  In-Person segment and the Search tab quietly fell back to every in-person
  meeting on the server for that day — rooms on other continents, presented as
  results, with nothing but a dimmed radius control to hint at why. In-Person
  now shows an empty state naming the real problem, with a tap that fixes it,
  and Search leaves in-person results out (online results are unaffected —
  those genuinely don't depend on where you are) with the Radius cell reading
  "Location off" rather than a distance it isn't applying.

- **Search: the Radius filter could get permanently stuck.** Opening the radius
  picker only asked for location if the app had never asked before, so a user
  whose fix had merely timed out found the picker did nothing at all — the only
  way out was to re-select the distance they already had. Opening the picker
  now retries whenever there's no usable position.

- **Subscribing from the Attendance tab left you sitting on Settings.** Tapping
  Subscribe on Attendance sends you to the Settings subscription section with a
  note about where to return afterwards, but Settings only ever read that note
  the very first time it opened — and since the Attendance tab has to be turned
  on in Settings before it appears, Settings had essentially always been opened
  already. The note was saved and never looked at, so a completed purchase
  showed a generic success alert and stranded you on Settings instead of taking
  you back. Every return-here-after-you-buy trip now works no matter how many
  times you've visited Settings, including the meeting-popup returns fixed
  below.
- **Buying premium from a meeting's reminder gate dropped you in the wrong
  place and never reopened the meeting.** Tapping a schedule cell without a
  subscription sends you to the paywall with a note about where to return.
  That note had no way to name a segment, so it always meant "Live" — an
  in-person meeting sent you back to the Live segment, which deliberately
  discards in-person meetings, leaving nothing on screen and no reminder
  created, immediately after paying. Separately, the meeting itself was passed
  by a route parameter the popup had stopped reading, so even from Live the
  segment came back but the popup never did. Both paths now reopen the right
  popup on the right segment, so the reminder you paid to create is one tap
  away. Notes saved by an older build still work.
- In-person meeting rows drew their left accent bar in the meeting's
  fellowship color, so a screen of NA meetings was a column of green stripes
  fighting the app's theme color. The bar now uses your theme color; the
  fellowship is still shown in the meeting's detail sheet.
- In-person meeting popups showed no street address, ever. The address line
  read `formattedAddress`, a field the live data confirms is populated on
  none of the 55,617 active in-person meetings across every source — not a
  server bug, upstream just never fills it in. The popup now composes an
  address from the street/city/state/postal fields (which are populated on
  92–99% of meetings) and falls back to `formattedAddress` verbatim if it's
  ever non-empty. Also fixes the "Get Directions" fallback link for venues
  without coordinates, which had the same dead-field problem.
- `npm run compile` failed with `Cannot find module 'expo-file-system'` in three
  files (`db/provider.ts`, `journalExportService.ts`, `ninetyCertificateService.ts`).
  The `expo` 54.0.34→54.0.35 bump nested `expo-file-system` under
  `node_modules/expo/` and it was never a declared dependency, so TypeScript
  couldn't resolve it from the project root. (Metro still resolved the nested copy
  at runtime, so shipped builds were unaffected — this was typecheck/CI only.)
  Declared `expo-file-system` as a direct dependency to force top-level hoisting.

### Security

- **Hardened the crash-report URL scrubber so it no longer depends on which
  `URL` polyfill the runtime installs.** It previously parsed each URL, mutated
  the parsed params, and re-serialized. That was correct in the shipped app —
  Expo SDK 54's runtime installs a spec-compliant `URL` — but it would have
  silently become a no-op under React Native's own polyfill, whose
  `toString()` appends mutated params to the original string instead of
  replacing them. A privacy guarantee should not rest on which of two layered
  polyfills happens to win. Rewritten with plain string splitting, moved to
  `app/utils/scrubQuery.ts`, and covered by unit tests that assert the secret
  is *absent* rather than that a `[Filtered]` marker is present. No user data
  was exposed by this path; it is defence in depth.
- **iOS crash reports could carry the user's precise coordinates.** On iOS the
  Sentry SDK watches network requests natively and records each one as a
  breadcrumb, keeping the request's query string in a separate field from the
  URL. The app's existing scrubber only cleaned the URL, and only through a
  hook that the native breadcrumb never passes through — so after a user
  opened the In-Person segment, the `lat`/`lon` of their nearby search rode
  along with the next error report Sentry uploaded, for ordinary JavaScript
  errors and not just crashes. Coordinates (and every other sensitive query
  key: Zoom passcodes, tokens, OAuth codes) are now filtered out of the
  breadcrumb list at send time, which is the one point every breadcrumb —
  native or JavaScript — has to pass. Android was not affected.
- iOS builds no longer declare the two "Always" location purpose strings.
  `expo-location` injects `NSLocationAlwaysAndWhenInUseUsageDescription` and
  `NSLocationAlwaysUsageDescription` by default, so the binary was asking App
  Review to approve background location access the app never requests and has
  no code path for. Only the When-In-Use string ships now, matching both the
  app's actual behavior and its stated privacy policy.

---

## [4.7.0] — 2026-07-13

Native store release. Cuts a fresh native build so production config is sourced
canonically from the EAS `production` environment; resets the OTA counter to 0.

### Build

- Aligned `expo`, `expo-font`, `expo-localization`, and `expo-updates` to the
  patch versions SDK 54 expects (via `expo install --fix`). These were a patch
  behind, which failed the `expo doctor` "packages match versions required by
  installed Expo SDK" check and aborted the EAS production build during setup.
- Added `babel-preset-expo` as an explicit devDependency. The `expo` patch bump
  above changed its required range (`~54.0.10` → `~54.0.11`), and npm's
  incremental install un-hoisted it into `node_modules/expo/node_modules/`,
  leaving no top-level copy. The root `babel.config.js` resolves the preset from
  the project root, so the Metro bundle then failed with `Cannot find module
  'babel-preset-expo'` during the EAS build. Declaring it directly forces
  top-level hoisting. Future maintainers: keep this in sync when bumping `expo`.
- Switched every `eas`-invoking npm script (`build:*`, `submit:*`, `release:*`)
  from bare `eas` to `npx eas`, so they no longer hard-require a globally
  installed `eas-cli` (npx uses the global one if present, otherwise fetches it).
  `eas-cli` is intentionally **not** a project dependency: `expo doctor` fails
  the build on its "legacy global CLI installed locally" check if it is, and that
  check can't be disabled. The `eas-cli` version is governed by `eas.json`'s
  `cli.version` field, per Expo's intended model.
- OTA releases now resolve `EXPO_PUBLIC_*` config from EAS server-side
  Environment Variables (the `production` environment) instead of whatever was
  in the developer's local `.env`. Previously `eas update` inlined config from
  `.env` at bundle time and ignored `eas.json` entirely (that only applies to
  `eas build`), so a stray dev value in `.env` could — and did — ship a
  production OTA pointing at a developer's local API. `release:ota` now passes
  `--environment production` (server values win over `.env`) and `--clear-cache`
  (prevents Metro from re-inlining a stale cached value after `.env` changes).
  The Sentry source-map upload in `bump-update.sh` pulls `SENTRY_AUTH_TOKEN`
  from the same server environment via `eas env:exec`. Net effect: one source
  of truth for production config across both builds and OTAs; `.env` is now
  local-dev-only.
- Added `npm run check:env` (`scripts/check-env-sync.js`): reports whether a
  local `.env` matches `eas.json`'s production config (missing / mismatched /
  extra `EXPO_PUBLIC_*` keys), exit 1 on drift. A sanity/CI aid, not a release
  gate — surfaced that `EXPO_PUBLIC_AUTH0_CLIENT_ID` exists only in `.env` and
  is absent from both `eas.json` and the EAS production environment.
- Declared `EXPO_PUBLIC_AUTH0_CLIENT_ID` in `eas.json` (`base.env`) and the EAS
  `production` environment. It was previously supplied only by the build
  machine's local `.env`; prod Auth0 login worked solely because Expo's bundler
  backfills `EXPO_PUBLIC_*` keys missing from `eas.json` out of `.env` during
  `eas build --local`. A fresh clone / different machine would have built a prod
  app with an empty clientId and broken login. Now sourced canonically.

---

## [4.5.0-11] – [4.5.0-13] — 2026-07-13 (OTA)

No user-visible changes. Three republishes of the same JS that shipped in
[4.5.0-10] — `git diff v4.5.0-10 v4.5.0-13` is empty outside the `update`
counter in `package.json`. Recorded so the counter sequence visible in Settings
has no unexplained gaps.

---

## [4.5.0-10] — 2026-07-13 (OTA)

### Added
- **Attendance cloud backup & multi-device sync.** Attendance records now back up
  to the server and stay in step across a user's devices. Opt in from
  Settings → Cloud Backup (default OFF, gated on the `recoverysky-attendance`
  entitlement). Turning it on runs a full backup of the existing local history —
  minutes for a long history — with a live status line reporting progress, the
  last sync time, and offline/error states. Turning it off is **pause-only**:
  nothing is deleted locally or on the server, and re-enabling picks up where it
  left off.

  Local edits are captured in a durable SQLite outbox before being pushed, so an
  app kill or a flaky network mid-sync loses nothing. Edits made offline queue up
  and drain on the next foreground. A second device pulls down a **complete**
  copy, report bodies included, so opening an old report never needs the network.

  Reports remain server-generated and pull-only — the app never pushes one.

  The full design, and the account-switch safety rules that govern the outbox,
  are documented in `docs/BACKUP.md`. Read that before touching
  `app/services/sync/`: the server stamps each pushed record with the
  authenticated uid, so pushing a queued record while the wrong user is signed in
  would silently move one person's attendance into another's account.

- **One-time announcement popup.** New features can now be announced to users
  with a single blocking dialog that appears once and never again. First use:
  the Cloud Backup & multi-device sync launch — subscribers get an "Open Cloud
  Backup" shortcut into Settings; everyone else sees the announcement text.
  Fresh installs are seeded "caught up" at onboarding so they get no backlog of
  past announcements.

### Removed
- **Home: the "RecoverySky is the next generation of AA/NA Live!" card.** It
  announced the AA/NA Live → RecoverySky rename, which is stale news by now and
  means nothing to anyone who never used the old app.
- **Home: the Logout link in the title bar.** A dev-era shortcut that sat beside
  the "Home" heading. Logout still lives in Settings, where it belongs.

### Changed
- **Home "Getting Started" cards moved to the bottom of the tab.** They used to
  sit directly under the header, above everything else — nine cards deep, which
  pushed the clean-time counter, recovery chart, money saved and 90-in-90 well
  below the fold on a fresh install. The dashboard now leads with the user's own
  recovery data and the help cards trail it as the onboarding chrome they are.
  The cards are kept, and remain dismissible, so they vanish entirely once read.
- **Rating-prompt pipeline instrumented with `rating[diag]` diagnostic logging.**
  Every stage of the rating flow now logs at INFO (was DEBUG or silent): the
  engine's startup snapshot (carried-over event count, `reviewEnabled`,
  thresholds), each counted meeting event, the timer-save decision to fire or
  skip `meetingEvents.completed` (with credit ms), the popup-close →
  present-after-close scheduling in `SchedulePopup`, and — most importantly — a
  complete decision snapshot in `maybePresentRatingPrompt` with every gate input
  and an explicit SKIP/SHOWING verdict. Added to diagnose "the prompt never
  shows" reports from the field: one log line now answers which gate blocked it.

### Fixed
- **Cloud sync threw "Database not opened" on every launch.** The sync service is
  wired from the app's store-setup path, which runs before the SQLite database
  provider mounts and opens the database — so the cold-start catch-up pull raced
  the DB and failed for any user with backup enabled. The availability gate now
  refuses every sync tick until the database is open, and the cold-start pull was
  moved to a `SyncResumer` that fires once the database reports ready. Covers all
  triggers (launch, screen focus, app resume), so none can touch the database
  before it exists.
- **Cloud backup crashed on every write with "crypto.getRandomValues() does not
  exist."** Hermes ships no global `crypto`, and the sync outbox generates a UUID
  for each queued mutation, so no attendance change could ever be enqueued for
  backup. Every other local write escaped this because it supplies its own id and
  never reaches the UUID generator. `globalThis.crypto` is now polyfilled from
  `expo-crypto` at app entry. Deliberately not `react-native-get-random-values`:
  that is a native module, which would force a `runtimeVersion` bump and a store
  release, whereas `expo-crypto` is already linked and keeps this shippable over
  the air.
- **Recovery date defaulted to *tomorrow* for users behind UTC.** The onboarding
  and Settings recovery-date pickers seeded their default from
  `new Date().toISOString()`, which serializes in UTC — so in the evening a
  device behind UTC (e.g. US Eastern) showed the next calendar day. The default
  now uses the device-local date via a new `todayLocalISODate()` helper, applied
  to the ProfileStore default, the profile reset, and the Firebase-import
  "still at default?" check.

### Build
- **`@recoverysky-org/common` bumped ^1.19.1 → ^1.20.2** — the schema/repository
  groundwork for attendance cloud backup & multi-device sync (see the sync
  design docs committed alongside). Brings `updated`/`deleted` columns on
  `attendances`/`attendance_reports` (applied on next launch via the existing
  Drizzle `useMigrations` path — JS-only, no `runtimeVersion` bump needed),
  `upsertMany` last-write-wins upserts, cursor-based `findChangedSince`, plus
  two upstream fixes: deterministic pagination on tied `updated` timestamps
  (silent-data-loss risk at page boundaries) and an `updated` sentinel change
  `0` → `1` so pre-existing rows are visible to strict `updated > since` sync
  pulls. This landed as dependency groundwork ahead of the sync client; both
  ship together in this release.
- **`npm run update` now runs a preflight before it publishes.** `bump-update.sh`
  runs `npm run compile` and the Vitest suite first and aborts the whole release
  if either fails — an OTA reaches users the moment it publishes, with no store
  review in between, so a type error or a red test must not be able to ride out
  over the air.

---

## [4.5.0-9] — 2026-06-29 (OTA)

### Fixed
- **External-Zoom attendance timer could hang open on Save.** The rating engine
  subscribes to meeting-completion events with a *synchronous* handler; if it
  threw, the error propagated into `saveTimerAttendance`'s critical path and
  aborted the Save flow before the timer modal closed — leaving it stuck until
  the user tapped Cancel (the attendance was already saved underneath). Meeting
  and attendance event listeners are now isolated so a subscriber error can never
  break the save, the rating counter never throws, and the timer's Save handler
  always closes the modal as a final safeguard. (Supersedes the partial v4.5.0-8
  attempt.)
- **Rating prompt fully decoupled from the timer.** The soft-ask now presents
  only after the meeting popup has completely closed — never from inside the
  timer Save flow — so it can't appear over a dismissing modal or interfere with
  saving attendance.

## [4.5.0-8] — 2026-06-29 (OTA)

### Changed
- **Rating prompt now reaches engaged new users on day one.** Dropped the 3-day
  "days since install" requirement from the rating warm-up, making it purely
  interaction-based: a user who attends 5 meetings is eligible no matter how
  recently they installed (`MIN_EVENTS=5`, `MIN_DAYS=0`). Still gated behind the
  `REVIEW_ENABLED` switch.

### Fixed
- **Rating prompt no longer freezes the attendance timer on Save.** After saving
  an external-Zoom attendance timer, the new "Enjoying RecoverySky?" dialog was
  presented while the timer modal was still dismissing — a state iOS blocks,
  freezing the screen until the user tapped to flush it. The prompt now waits for
  the modal-dismiss animation to finish before appearing (`runAfterInteractions`).

### Build
- **OTA Sentry source-map upload fixed in `bump-update.sh`.** The upload step was
  missing the `dist` directory argument and silently failed on every OTA; JS
  stack traces in Sentry now decode to `file:line` automatically.

## [4.5.0-7] — 2026-06-29 (OTA)

### Changed
- **App-rating prompts rebuilt as a dedicated rating engine.** Replaced the old
  review service with an isolated, unit-tested module (`app/services/rating/`)
  using a two-stage soft-ask: an "Enjoying RecoverySky?" Yes/No dialog gates the
  OS rating prompt, and users who tap "Not really" are diverted to support instead
  of a 1-star review. Re-asks are now version-gated for happy users and put on an
  exponential backoff for unhappy ones.

### Fixed
- **Rating prompts could silently reach nobody.** Two long-standing bugs are gone:
  the prompt fired only at an exact meeting count (a single skipped count stranded
  the user forever), and the usage counter only incremented while review prompts
  were enabled — so turning the feature on started everyone from zero. The counter
  now increments unconditionally, and toggling the feature off→on is a supported
  way to trigger a fresh prompt wave for eligible users.

## [4.5.0-6] — 2026-06-14 (OTA)

### Changed
- **Long-attendance heads-up dialog: dismiss button relabeled "Cancel" → "OK".**
  The notice shown after a saved external-Zoom session exceeds ~2h fires *after*
  the attendance is already saved, so "Cancel" was misleading (nothing to cancel)
  — and on iOS the cancel-styled button is positioned at the bottom, so it read as
  the confusing third option. It now reads "OK" to acknowledge and close; behavior
  (back-button / outside-tap dismiss) is unchanged.

### Fixed
- **System-UI theming no longer reports a fatal error during foreground resume.**
  `setBackgroundColorAsync` (expo-system-ui) was a floating, un-caught promise
  that rejected with "The current activity is no longer available" when the theme
  re-applied on a `background → active` transition before the Android Activity had
  reattached. The rejection surfaced in Sentry as a fatal Error; it's now swallowed
  (the background color re-applies on the next theme pass anyway). User-invisible —
  crash-feed hygiene only.

## [4.5.0-5] — 2026-06-03 (OTA)

### Added
- **Crystal Meth Anonymous (CMA) as a selectable recovery fellowship.** CMA now
  appears in the fellowship pickers (Onboarding, Settings) and meeting filters
  (Live, Listings) alongside AA and NA, and counts "clean time" like NA on the
  recovery dashboard. CMA was already supported in the data layer (enum, colors,
  Firebase import) — this surfaces it in the UI.

### Changed
- **Fellowship selection is now driven by the `EXPO_PUBLIC_FELLOWSHIPS` env var**
  (single source of truth in `app/utils/fellowships.ts`) instead of four
  separate hardcoded `[AA, NA, RD]` lists across Onboarding, Settings, Live, and
  Listings. The active set is currently `AA, NA, CMA`. Recovery Dharma (RD) is no
  longer offered in the pickers; existing users who already selected RD keep
  their stored fellowship and clean-time display, they just can't re-pick it.

## [4.5.0-4] — 2026-05-28 (OTA)

### Fixed
- **Native crash (`EXC_BAD_ACCESS`) when saving/skipping a meeting topic.** On
  the post-attendance topic prompt, tapping Save or Skip while the keyboard was
  still up could crash inside react-native-reanimated's shadow-tree commit
  (`cloneShadowTreeWithNewPropsRecursive` → `folly::dynamic::hash` on freed
  memory). The keyboard-controller `KeyboardAvoidingView` (reanimated-driven)
  was committing layout updates on the same frame the panel's slide-out tween
  and React reconcile were mutating the same subtree. The topic panel now
  dismisses the keyboard and waits for it to settle before sliding out, so the
  animations no longer commit concurrently. (OTA mitigation; the durable fix is
  a reanimated/keyboard-controller upgrade in the next native build.)

## [4.5.0-3] — 2026-05-28 (OTA)

### Fixed
- **Slow cold start / Background ANR on flaky networks.** The startup
  `/status` precheck (which gates init before attestation) inherited the API
  client's 10s default timeout, so on an unreachable-then-recovering network
  each retry blocked for the full 10s — stretching cold start to 25–47s.
  Users backgrounded the app mid-init, and the deferred heavy native work
  (Play Integrity attestation, config fetch, store hydration) then collided
  with the backgrounding transition under memory pressure, tripping a
  Background ANR. `getPublicStatus()` now uses a 2.5s per-request timeout so
  the precheck fails fast and routes to `MaintenanceScreen` quickly. The
  global 10s timeout is unchanged — heavier endpoints (reports, `/config`,
  CMS content, Firebase import) still get the headroom they need.
- **App-launch hang ("App Hanging for at least 2000 ms") on iOS 18.** The
  keyboard library's `KeyboardProvider` preloads the keyboard on mount by
  driving a hidden text field to first-responder at cold start. On iOS 18
  with Apple Intelligence, that synchronously loaded the Writing Tools /
  GenerativeModels framework on the main thread while the keyboard updated
  its input traits, blocking the UI past the watchdog threshold. Disabled
  the preload (`preload={false}`); the only cost is a marginal warm-up on
  the very first text-field focus.

## [4.5.0-2] — 2026-05-21 (OTA)

### Changed
- **Log `appVersion` now includes the OTA counter** (e.g. `4.5.0-1` instead
  of `4.5.0`). The logger context's `appVersion` — emitted on every record
  and as the OTel `service.version` resource attribute — now appends
  `package.json`'s `update` field to the native `version`, matching the
  `v{version}-{update}` string in Settings and Sentry's `release`+`dist`
  pair. Two users on the same 4.5.0 native shell can be on different OTA
  bundles; logs now say which one.
- **Umami analytics delivery failures further downgraded WARN → DEBUG.**
  Building on the ERROR → WARN change in 4.5.0-1, the fetch-rejection branch
  now logs at DEBUG so a dropped analytics request (network blip, endpoint
  down) stays out of the error/warning dashboards entirely. (The
  non-OK-HTTP-response branch stays WARN — a 4xx/5xx from the analytics
  server is reachable-but-rejecting, which is more signal than a dropped
  connection.)
- **"Invalid news response format" WARN downgraded to DEBUG.** `GET /news`
  returns an empty 200 when no announcement is active (outside its
  `start`/`end` window). The client already handles this correctly —
  `HomeScreen` just clears the banner — but the API layer logged a WARN on
  every home load with nothing scheduled, producing recurring dashboard
  noise. The empty/idle case now logs at DEBUG.

## [4.5.0-1] — 2026-05-21 (OTA)

First OTA on top of the 4.5.0 native build — all entries below are JS-only
and reach every user already running `runtimeVersion` 4.5.0.

### Fixed
- **Crash during OTA-update reload** (`EXC_BAD_ACCESS` in `.cxx_destruct` →
  `SharedObjectRegistry.clear` → `jsi::WeakObject::~WeakObject`). When the
  user accepted an OTA update, `Updates.reloadAsync()` tore down the Hermes
  runtime while the expo-sqlite database handle (a JSI `SharedObject`) was
  still open; expo-modules-core then ran that object's C++ destructor against
  the already-invalidated runtime and dereferenced a null pointer. Now all
  reload sites route through a `reloadApp()` helper that closes the database
  before reloading, and the database is opened without the unused
  `enableChangeListener` flag (which registered a second JSI callback object
  with no consumer).

### Changed
- **OTLP logger emits `deviceId`/`sessionId` as canonical OTel Resource
  attributes.** Previously the per-LogRecord `attributes` carried
  `deviceId` / `sessionId` / `appVersion`, but the OTel→Loki bridge in
  Alloy (and downstream `otelcol.exporter.loki`) preferentially promotes
  **Resource attributes** with canonical semantic-convention names
  (`device.id`, `session.id`, `service.version`). With the old naming
  the bridge had nothing to promote, and dashboards/queries that
  expected those Loki labels / structured metadata to exist saw only an
  opaque log body. `LoggerImpl.flush()` now passes the current
  `LoggerContext` to `sendToOtlp()`, which emits the three fields under
  their canonical names on `resourceLogs[0].resource.attributes` while
  keeping the camelCase copies on each LogRecord's `attributes` for
  backward compatibility during the migration window. Side note: the
  bug report described this as "deviceId baked into a stringified body"
  — that wasn't literally the case (the body always carried the raw
  message), but the symptom was the same from a Loki query
  perspective: no promoted labels to filter on.
- **Sentry `dist` is now the OTA counter, not the update UUID.** Builds were
  tagged with `dist: Updates.updateId` — an opaque hash that's also `null`
  for embedded (non-OTA) launches, so a freshly-installed build had no
  distinguishable `dist` at all. Now `dist` is the `update` field from
  `package.json` (the OTA counter, reset to `"0"` on each native bump), so
  Sentry reads builds as a human-readable `release`+`dist` pair like
  `4.5.0-0` / `4.5.0-1`, always populated, matching the `v{version}-{update}`
  string shown in Settings. `release` is unchanged (the native
  `runtimeVersion`).
- **Umami analytics delivery failures downgraded ERROR → WARN.** A failed
  analytics POST to Umami (network blip, endpoint down) was logged at ERROR,
  which inflated the error rate and surfaced as a Sentry `captureMessage`
  event for a non-critical background telemetry miss. The fetch-rejection
  branch now logs at WARN — matching the non-OK-HTTP-response branch — so
  both Umami failure modes are the same severity. (Further downgraded to
  DEBUG in 4.5.0-2.)

## [4.5.0] — 2026-05-17

### Removed
- **Bundled Zoom Meeting SDK.** Production users were hitting a fatal
  Android startup crash —
  `UnsatisfiedLinkError: dlopen failed: library "libzReflection.so" not
  found` at `com.zipow.cmmlib.AppContext.<clinit>` — *before* any JS ran.
  The SDK's native module is instantiated by Android's auto-generated
  `PackageList` during React Native bridge setup, which class-loads
  `us.zoom.sdk.*` and triggers the missing `.so` regardless of the
  `useExternalZoom` JS gate. Since meeting joins have routed through
  the installed Zoom app for some time, the SDK was dead weight that
  was now actively crashing the app. Removed:
  - `@zoom/meetingsdk-react-native` and the unused `@zoom/meetingsdk`
    npm packages
  - The `ZoomMeetingProvider` SDK context, `ZoomLoginScreen`,
    `ZoomSetupScreen`, `useZoomAuth` OAuth/ZAK flow, encrypted-SQLite
    `zoomAuthRepo`, and `services/zak.ts` ZAK refresher
  - `profileStore.useExternalZoom` and `profileStore.zoomConnected`
    (external is the only mode now), plus the disabled Advanced-section
    toggle in Settings
  - `ConfigStore` `zoomSdkKey` / `zoomSdkSecret` / `zakApiKey` fields
    and the corresponding `/config` payload keys
  - All `i18n` `zoomLoginScreen` / `zoomSetupScreen` blocks plus
    orphaned Zoom-account settings strings (9 locales)
  - Native artifacts: `android/libs/mobilertc.aar`,
    `zoom-sdk-android-6.7.5.37500.zip`,
    `patches/@zoom+meetingsdk-react-native+6.7.2.patch`,
    `scripts/patch-zoom-android.sh`
  - `ios/Podfile` `ZoomMeetingSDK` pin and `ZOOM_PRODUCTION` env logic
  - Zoom / Zipow / WebRTC / reactnativezoom ProGuard rules from
    `app.json`
  - `EXPO_PUBLIC_ZOOM_*` and `EXPO_PUBLIC_ZAK_*` env vars from
    `eas.json` and `.env`

  Meeting joins, the external-Zoom timer-modal attendance flow, and the
  review-prompt tally (the timer save fires
  `meetingEvents.completed("external-zoom-timer")` so the review system
  still counts these as meetings) are unchanged. The `zoom_auth` SQLite
  table created by `@recoverysky-org/common`'s migrations is now
  intentionally orphaned — leaving it as an unused empty table is
  zero-risk and avoids forking the common schema. `android/` shrank
  from ~2.7 GB (with the AAR + minified Zoom transitive deps) to
  ~436 KB at the regenerated prebuild stage.
- **Personal Attendance onboarding screen.** The attendance explanation +
  enable toggle is no longer part of the onboarding wizard (now 7 screens,
  down from 8). `profileStore.attendanceEnabled` still gates the Attendance
  tab in `MainNavigator`; users opt in from Settings instead. Removed the
  screen, its route, and the navigator entry outright — there's no longer a
  "skip" path because the step doesn't exist.

### Changed
- **Anonymous login hidden on the login screen.** The "Continue Anonymously"
  button is commented out — the anonymous-user experience doesn't meet the
  bar we want for new installs. All handler/state plumbing
  (`handleAnonymousPress`, `loginAnonymously`, the `"anonymous"` branches in
  `proceedWithLogin`) is intentionally retained so re-enabling is a one-block
  uncomment when paired with a clear upgrade path.

### Fixed
- **Theme color picker crash.** Picking a color or moving the hue slider in
  Settings → App Settings → Theme Color → custom picker crashed the app with
  a C++ `Object is not a function` exception thrown from the worklet thread.
  `reanimated-color-picker`'s `onComplete`/`onChange` props are worklet-only
  (the lib calls them inside the gesture worklet without `runOnJS`); we were
  passing a regular React `useCallback`. Switched to `onCompleteJS`, which
  the lib auto-wraps with `runOnJS`.

### Build
- **expo-dev-client family excluded from production AABs.** Google Play
  Console flagged two warnings against the 4.5.0 AAB that both traced
  to dev-client leaking into production: a deprecated edge-to-edge API
  warning rooted in `DevLauncherExpoActivityConfigurator.setColor`
  (calls `Window.setStatusBarColor()`), and an Android-16 large-screen
  resizability warning rooted in `GmsBarcodeScanningDelegateActivity`
  (a hardcoded-PORTRAIT activity that ships via
  `expo-dev-launcher`'s transitive `play-services-code-scanner` /
  `mlkit:barcode-scanning` dependencies). Both classes are unreachable
  at runtime in production (the dev-launcher activity never runs in a
  production binary) but Play's static bytecode analysis flags them
  regardless. R8 doesn't strip them because dev-launcher carries
  reflection-friendly `@DoNotStrip` annotations. Fixed by adding an
  `eas-build-pre-install` lifecycle hook (`scripts/eas-pre-install.js`)
  that mutates `package.json` inside the EAS build environment only to
  add `expo-dev-client` / `expo-dev-launcher` / `expo-dev-menu` to
  `expo.autolinking.exclude` when `EAS_BUILD_PROFILE === "production"`.
  Dev / preview / local builds are no-ops — the dev menu, QR-scan flow,
  network inspector all keep working. The third edge-to-edge warning
  source (React Native core's `StatusBarModule` and
  `react-native-edge-to-edge@1.6.2`'s intentional deprecated-API
  bridging) remains as expected; it resolves naturally on a future
  Expo SDK upgrade.
- **Android versionCode now managed locally.** Switched
  `eas.json` `appVersionSource` from `remote` to `local` and dropped
  `autoIncrement` from the production profile. EAS's remote counter had
  drifted far below the legacy native app's published versionCode
  (30784999), so EAS-built AABs came out as versionCode 54 — rejected by
  Play. Worse, `autoIncrement` + the project's flat (non-`expo`-wrapped)
  `app.json` made EAS inject a bogus nested `expo.android.versionCode` key,
  producing a malformed `AndroidManifest.xml` and a manifest-merger crash.
  `app.json` `android.versionCode` is now the single source of truth, set to
  `40000000` and bumped by hand per native release (alongside `version` /
  `runtimeVersion`).
- **Android Zoom AAR resolution.** Fresh `npx expo prebuild` + Android build
  failed with `Could not find :mobilertc:.` even though
  `android/libs/mobilertc.aar` and the root `allprojects.repositories.flatDir`
  were in place — under Gradle 8.x + Expo/RN root plugins, the inherited
  flatDir doesn't reach the `:zoom_meetingsdk-react-native` subproject. The
  patch now declares `flatDir` directly inside that subproject's own
  `repositories {}` block so the local AAR resolves regardless of inheritance
  quirks.

## [4.4.0] — 2026-05-11

### Added
- **Sentry crash + error reporting.** Native crashes (NSExceptions, JNI,
  OOM kills, EXC_BAD_ACCESS), uncaught JS errors, and unhandled promise
  rejections now flow into Sentry with breadcrumbs and source-map-decoded
  stack traces. The OTLP logger is bridged so `logger.info/.warn/.debug`
  emit Sentry breadcrumbs and `logger.error/.fatal` emit Sentry events —
  no per-call-site changes required. PII scrubber strips `?pwd=` (Zoom
  passcodes), `?token=`, `?code=`, etc. from URLs and `Authorization` /
  `X-Device-Token` / `X-API-Key` from request headers before send. User
  context is the opaque `userIdentifier` only (no email/name). OTLP
  remains the canonical operational log sink; Sentry is the crash/error
  event store.
- **Social tab (Community).** New tab that hosts the Replyke-powered
  RecoverySky community SPA in an in-app WebView. Native shell owns Auth0;
  the WebView receives a pre-signed Replyke JWT, never an Auth0 token.
  *Currently hidden for this release (`socialTabVisible = false` in
  MainNavigator) pending SPA-side fixes; re-enable by restoring
  `__DEV__ || isPremium`.*
- **OnboardingZoom screen** between Recovery and Theme in the onboarding
  wizard (now 8 screens, was 7). Tells the user RecoverySky uses Zoom
  Workplace for live meetings and provides a platform-aware install
  button (App Store on iOS, Play Store on Android). Informational only —
  no install detection / gating; the existing meeting-join paths handle
  missing-Zoom errors downstream. New i18n keys (`zoomTitle`,
  `zoomSubtitle`, `zoomBenefitFree`, `zoomBenefitRequired`,
  `zoomBenefitAlready`, `installZoom`) added to all 9 locales — Spanish
  / German / French / Portuguese / Russian / Ukrainian / Thai / Arabic
  translations are first-pass and should be reviewed by native
  speakers.
- **On-demand Replyke JWT refresh** for the Social WebView. The web side
  can now request a fresh signed token mid-session via a
  `replyke_token_request` postMessage; the shell mints via
  `/api/replyke/sign-token` and broadcasts the new token through the
  existing `replyke_token` channel. Coalesces concurrent mints. Avoids
  401s on long-lived sessions when the original 5-minute JWT expires.
- **App-context injection** for the Social WebView: shortName, theme
  color, and light/dark mode are pushed alongside the JWT so the SPA
  matches the host app's appearance and personalizes posts.

### Changed
- **`runtimeVersion` bumped 4.2.0 → 4.4.0** to align with `version` and
  to invalidate the OTA channel for users on the prior native build. The
  Sentry SDK is a new native dependency; OTAs targeting 4.4.0 will only
  reach users running the next native release. Native release first,
  then OTAs.
- **Social tab bar label**: "Social" → "Community" across all 9 locales
  (en/es/de/fr/pt/th updated; ru/uk/ar already meant "Community"). Route
  name, screen file, and config field are unchanged.
- **Social WebView mounts in `incognito` mode** so every cold app start
  fetches a fresh web bundle from origin. Preempts service-worker
  stickiness and stale-HTML caching. The SPA is session-less by design,
  so the data-store wipe has no functional cost.
- **Social WebView layout-drift defenses**: `bounces={false}`,
  `overScrollMode="never"`, `directionalLockEnabled` belt-and-suspenders
  on top of the SPA's CSS overflow rules. Prevents residual rubber-band
  overscroll (iOS) and horizontal scroll-spill (Android).
- **Cold-start ZoomSetup gate disabled.** Returning and new users no
  longer hit the in-app Zoom OAuth/ZAK connection screen at first
  launch. Meeting joins now flow through the external Zoom app, which
  doesn't require our linked account to function. Hardcoded
  `needsZoomSetup = false` in `AppNavigator`; the `ZoomSetupScreen` and
  `ZoomLogin` modal remain registered so the gate can be re-enabled
  cleanly later if the in-app SDK path returns.
- **Zoom Account section removed from Settings.** Now-vestigial UI for
  connect / disconnect / edit-profile / connected-status was deleted.
  `useZoomAuth().disconnect` is still wired into the account-deletion
  and sign-out flows for cleanliness, just no longer user-facing.

### Removed
- **"Skip for now" buttons removed** from 6 onboarding screens
  (Privacy, Theme, OSS, Attendance, Profile, Recovery). Users now
  proceed through the wizard step-by-step without an early-exit
  shortcut. The `OnboardingImport` "Skip" button (different translation
  key, different semantics — skips the data import step rather than the
  whole flow) is preserved.

### Fixed
- **External Zoom attendance no longer lost when the OS kills the app
  mid-meeting.** Previously, when Android/iOS terminated the
  backgrounded RN process while the user was in Zoom (memory pressure
  is the usual trigger), the next cold start fired a destructive
  `Alert.alert` with only "Save" or "Discard" options. Customers who
  switched back to the app just to verify recording would tap Save —
  committing partial credit and clearing the persisted session — and
  then any time spent back in Zoom afterward got zero credit because
  the timer was gone. Multiple confirmed reports of customers losing
  full meetings' worth of attendance this way. The recovery surface is
  now non-destructive: `TimerSessionResumer` populates a recovery
  channel (`services/zoom/timerRecovery`) and a new app-root
  `TimerRecoveryGate` remounts `ExternalZoomTimerModal` pre-seeded with
  the persisted session. The modal's existing resume path adopts the
  persisted `startedAt`, shows the correct wall-clock elapsed, and does
  NOT re-launch Zoom (the user just came from it). The user can keep
  attending, return after the meeting actually ends, and Save with the
  full duration. 6-hour staleness cap silently discards sessions
  obviously older than any real meeting. Saved sessions longer than
  2 hours now show a heads-up pointing the user to the Attendance tab
  to trim the duration down — catches the "fell-asleep-with-the-
  timer-on" case before they're stuck with a 6-hour meeting in their
  archive. The alert offers three options: Cancel, "Don't Show Again"
  (persisted suppression), and "Go to Attendance" (deep-links to the
  active-session list via the root navigation ref).
- **External Zoom launch hardened against fire-and-forget crashes.**
  `SchedulePopup` and `ExternalZoomTimerModal` previously called
  `Linking.openURL` without `.catch` on multiple paths; an unhandled
  rejection from a malformed URL or a no-handler-found case could
  terminate release builds with strict-mode promise tracking. All
  external-Zoom launch sites now have explicit `.catch` handlers and
  defensive string guards.
- **iOS modal-stack collision** when transitioning from the first-time
  external-Zoom education modal to the timer modal or to the system
  "Open in Zoom?" sheet. The Education-modal "Continue" handler now
  defers the next action via `InteractionManager.runAfterInteractions`
  so the dismiss animation completes before another modal mounts.

### Build
- `scripts/bump-update.sh` invokes `sentry-expo-upload-sourcemaps` after
  each successful OTA publish so the new bundle's stack traces decode
  to file:line frames in Sentry. Native EAS builds already handle this
  automatically via the `@sentry/react-native/expo` config plugin.
  Non-fatal: missing `SENTRY_AUTH_TOKEN` is warned, not failed.

---

## [4.3.2-7] — 2026-04-18 (OTA)

### Added
- `app_foregrounded` Umami event (with `backgrounded_ms` payload) on every
  active resume, regardless of OTA recheck threshold.

### Changed
- Foreground OTA recheck threshold reduced from 30 min to 5 min so coffee-break
  background windows still trigger a recheck.
- Diagnostic logging added at every step of the AppState handler (install,
  every transition, backgrounding, both recheck-fired and recheck-skipped paths).

### Docs
- Promoted `app_foregrounded` from "Future Events" to active "Group 1: Session"
  in `EVENTS.md` with the actual data shape.

## [4.3.2-5..6] — 2026-04-18 (OTA)

### Added
- Editable recovery date on the dashboard `CleanTimeCard`: tappable "since"
  row at the top of the card opens the same iOS-inline / Android-modal date
  picker used in Settings.

### Changed
- `OnboardingRecovery` iOS date picker now matches Settings: OK button at the
  top-right header (was at the bottom), uses the i18n `common:ok` key.

### Build
- New `scripts/bump-update.sh` plus `npm run update` script: bumps the OTA
  counter, commits as `🔖 ota: vX.Y.Z-N`, tags, pushes, and publishes via
  `eas update --branch production --auto` in one shot.

## [4.3.2] — 2026-04-18

### Added
- `release:ota` npm script (`eas update --branch production --auto`) for
  one-shot OTA publishing.
- Foreground OTA recheck via `AppState` listener in `app.tsx`, gated on a
  background-duration threshold to avoid spamming `expo-updates` on quick
  tab switches. Pairs with a module-level `promptInFlight` lock in
  `checkForUpdates.ts` that prevents stacked Alert prompts when the user
  task-switches with a prompt already on screen.

### Fixed
- External Zoom timer modal backdrop is now a non-dismissible `View`; closing
  is only possible via the explicit Cancel / Save buttons. Hardware back still
  routes through the confirm-above-threshold flow.

### Docs
- `externalZoomEducation.body` now uses `\n\n` to render as two paragraphs in
  all 9 locales.

## [4.3.1] — 2026-04-18

### Fixed
- **External Zoom attendance timer hardened (the visible "timer resets to
  00:00 when returning from Zoom" bug).**
  - `SchedulePopup` was inlining the modal's `meeting` prop as a fresh object
    literal on every observer re-render; the modal's effect depended on the
    object, so MobX notifications (e.g. AppState change when Zoom hands focus
    back) tore down and restarted the timer. Memoized the payload in
    `SchedulePopup` and switched the modal's effect to depend on stable
    primitives (id/url/name).
  - Persisted active session to MMKV so a process kill mid-meeting doesn't
    silently lose the attendance. Modal adopts an existing persisted session
    on mount (without re-launching Zoom). New `TimerSessionResumer` runs on
    DB ready and prompts the user to Save or Discard any stale session above
    the credit threshold.
  - `handleSave` uses a synchronous `useRef` lock to prevent same-tick
    double-tap from creating two attendance records.
  - `saveTimerAttendance` retries `markProcessed` up to 3 times at
    500/1500/4500 ms before giving up — a transient DB stall no longer leaves
    orphan rows.
  - Cancel above the credit threshold shows a three-button Alert (Keep
    Running / Save / Discard) so a stray backdrop tap doesn't throw away an
    hour of attendance.

### Added
- Attendance row "edit" pencil in the New tab opens `AttendanceEditModal`
  (stepper, capped at original duration, 1-min floor) — Archive rows are
  unaffected.
- Report PDF export from the Reports viewer modal: `download-outline` button
  pipes `selectedReport.html` through `expo-print` and `expo-sharing` so users
  can Save to Files (iOS) or pick a share target (Android).
- First-time external-Zoom education popup (`ExternalZoomEducationModal`),
  gated on a versioned MMKV flag (`external-zoom-education-seen-v1`).

## [4.3.0] — 2026-04-15

### Changed
- **Settings → Use External Zoom** is now hard-coded `true` for all users and
  the Settings switch is disabled. ProfileStore default flipped, snapshot
  hydration overrides any persisted `false`, and the setter is a no-op guard.
- Premium-gated tabs (Agent, Social) are hidden regardless of subscription,
  pending content readiness.

### Fixed
- Settings → "Rate RecoverySky" no longer silently no-ops when the
  `reviewEnabled` server flag is false; the manual tap always surfaces the
  native review sheet (subject to web/availability gates and Apple's
  365-day quota).

## [4.2.0] — 2026-04-10

### Added
- `runtimeVersion` is now manually managed in `app.json` (decoupled from
  Expo SDK auto-derivation). Display in Settings shows `v{version}-{update}`.
- Store-version check before OTA: if `Application.nativeApplicationVersion <
  configStore.latestVersion`, prompt the user to update from the store before
  the `expo-updates` patch flow runs.
- VoiceOver coverage extended across home cards, agent, schedule popup, and
  attendance reports; i18n hint keys added for accessibility strings.
- Social tab (Replyke WebView), un-hidden Agent tab.
- Auth0 debounced sync of `shortName` to the user's Auth0 profile.

### Build
- `expo-insights` downgraded to the SDK 54-compatible version.
