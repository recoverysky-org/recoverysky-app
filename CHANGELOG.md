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
- **Every API request now starts a distributed trace.** The auth gate stamps
  a W3C `traceparent` header with a fresh random trace id on each request,
  and a new per-response debug line (`"API request"`, module `Api`) records
  the method, path, status, duration and that `traceId`. The API's OpenTelemetry
  instrumentation continues the id rather than minting its own, so the app's
  Loki line, the API's pino lines and the Tempo trace for one request all
  share it — the support recipe is in `docs/DIAGNOSTICS.md` "Tracing". The
  app still records no spans of its own (no tracing SDK, nothing extra on
  battery or the wire beyond one 55-byte header). Ids are random and carry no
  identity. Pure logic in `app/services/api/traceparentLogic.ts`, vitest-covered.
  Nothing shows in Tempo until the API's `API_OTEL_TRACE_EXPORTER` /
  `API_OTEL_TRACES_ENDPOINT` point at the ingress Alloy (stacks-side, see the
  same doc section).
- Language filter on Live and In-Person (Search already had one). A remembered
  language with no matches shows a "Show all languages" shortcut instead of an
  empty list.
- Live: "Live Now · Starts in 15m 30m 45m 60m" selector backed by the new
  `GET /schedules/at-next` endpoint: each minute chip lists the online
  meetings starting at one coming quarter-hour mark (15m = the next
  :00/:15/:30/:45, 30m/45m/60m = the marks after it), labelled with that time
  ("starting at 7:30p"). The app checks all four marks in the background and
  only shows chips that have meetings for your fellowship and language, so a
  chip never opens onto an empty list. Dev builds only until the flag flips.

### Fixed
- **The Home News card's idle state is no longer logged as a fault.** The API
  answers `204 No Content` when nothing is published, which is nearly every
  load, and `getNews` folded that into `bad-data` — so Home logged "News
  unavailable" with a fault kind on 144 of 145 loads in a 6h window (~450–500
  a day since 4.10.1-8). A 204 or empty payload is now its own `no-content`
  outcome (pure, vitest-covered `newsLogic.ts`) that Home does not log, and
  `bad-data` is reserved for a 2xx with content that isn't a news item, which
  now warns instead of hiding at debug. (RS-049)
- **Clean time no longer stays at 0 days if you kept the default recovery
  date.** The onboarding default ("today") was only saved when the date picker
  was touched. A user who accepted it had no date stored, so every launch
  re-read the date as the current day: the counter sat at 0 and the date moved
  forward each midnight. Onboarding now saves the accepted date, and installs
  already in this state are repaired on their next launch by backfilling the
  app's install date (the date they were shown and accepted); web falls back to
  today. The Firebase import now checks whether the user picked the date,
  rather than whether it equals today, so a backfilled date can still be
  replaced by the user's real clean date from the old app.
- **The `(Nd)` clean-days count no longer reads a day short.** It rounded a
  noon-to-noon difference down, so across a spring-forward DST change it lost a
  day for most of the year (US: Jan 1 → Sep 25 showed 266, not 267) and
  disagreed with the clean-time card. The Money Saved card had the same
  midnight freeze as the other Home cards and now advances too, and the
  recovery-date picker's Dec 31 limit follows the year instead of staying on
  the year the app was launched in.
- **Starting 90-in-90 in the evening no longer skips that night.** The start
  date and the certificate's completion date were saved as the UTC date, so a
  device behind UTC starting at 9pm got tomorrow's date. That evening's meeting
  didn't count, and Day 1 lasted two days.
- **A valid device token is no longer thrown away when a signed-in request
  goes out without a user token.** The server answers a request that carries
  no `Authorization` header with a plain 401, after it has already accepted
  the device token. The app read that plain 401 as "the device token was
  rejected", cleared it, and re-attested on the next request — on one iOS
  device this happened at every cold start for a day, because its keychain
  had lost the sign-in credentials while the app still remembered the user,
  so push-token registration fired with nothing to sign it. Two changes:
  push-token registration now waits until the app actually holds a session
  token, not just a remembered user id; and the rejection classifier
  recognises the server's "missing authorization header" body as the user
  lane and leaves the device token alone. 19 wasted re-attestations across 5
  devices in the week before the fix. RS-040.
- **Reloading the app no longer throws "Database not opened" errors from the
  screens still on display.** Every app reload closes the encrypted database
  first (a deliberate guard against a native teardown crash), but the
  JavaScript runtime keeps running for up to a second afterwards while the
  screens are still mounted. When the outage-recovery reload and a
  successful `/config` fetch landed in the same instant, the tree switched to
  the main tabs and the attendance badge queried a closed database; Sentry
  recorded it on three devices in two days across 4.8.0 and 4.10.1. The
  database provider now unmounts its screens the moment the connection is
  closed underneath it, so nothing can query it before the reload lands. The
  logger also flushes its pending batch before a reload, which is why those
  errors had never reached Loki. Sentry RECOVERYSKY-APP-1X.
- **Cold-start log lines are attributable to their user again.** The first
  ~35 lines of every launch (`App module loaded`, `getDeviceId()`, `Database
  opened`, `setTokens()`, …) are logged before `app.tsx` knows the device
  and user, then held until `/config` supplies the log key. They reached
  Loki with identity only as `user_id` / `device_id` (the OTLP Resource,
  stamped at flush time), so a `| userId="<hash>"` lookup silently missed
  them, roughly 750 lines an hour. The logger now fills in identity keys
  that had never been set when a line was logged, at flush time. A key
  set to empty (anonymous user, sign-out) is never filled in, so a
  signed-out line can't pick up the next sign-in. The Resource no longer
  carries `device.id` / `session.id` / `user.id`, so camelCase is the only
  spelling. RS-042.
- **A wrong-key database now offers "Reset local data" as intended.** The
  RS-024 fix classified open failures from the error's text, but the
  wrong-key code (`Error code 7: out of memory`) is on the Drizzle error's
  `cause`, not in its text, so every real occurrence was labelled `unknown`.
  For `unknown` the loading overlay offers only Retry, which can never
  unlock the file. Two devices were stuck behind that screen on 4.10.1-2
  to 4.10.1-4 until they reinstalled. The classifier now reads the whole
  cause chain, and the log line carries the root cause. RS-024.
- Choosing a fellowship in Search no longer changes the fellowship saved in
  Settings.

### Changed
- Meetings: the Live segment tab is now **Online** — with Starts In it also
  lists meetings that haven't begun, so "Live" no longer fit. The screen
  heading says what you're looking at: "Live Now", or "Starts in 30m" when a
  Starts In chip is selected. If the quarter hour turns over (or you come back
  to the app later) the selection moves to the soonest chip that still has
  meetings instead of dropping back to Live Now.
- **The "New Version Available" prompt no longer has a Cancel button.** A
  build that is behind the store is also cut off from every over-the-air
  update, so dismissing the prompt meant staying on that build for good;
  about 300 sessions a week on 4.8.0 were doing exactly that and still
  hitting problems fixed months ago. The prompt now offers only Update Now,
  which opens the store page. The app keeps running after the tap: nobody
  is locked out, and the prompt simply comes back on the next launch until
  the store update is installed. RS-035.
- **The ERROR log level now means a user felt something fail.** The app
  reserved ERROR for a handful of infrastructure faults and logged the
  failures users actually hit — a rejected report send, a forced sign-out, the
  maintenance banner going up, a sign-in error on screen, a profile save that
  never reached Auth0 — at WARN, so the Errors tile on the app-logs dashboard
  read 0 for the whole fleet and was right. Those five paths are ERROR now.
  In the other direction, the API transport layer no longer logs its own WARN
  for every failed request (it cannot know whether the user was waiting on
  it; the caller that can judge logs one line instead — that duplicate was
  about half of all WARN volume), and a handful of known-benign lines
  (report-body backfill 404s, push-token registration before sign-in, timer
  credit clamps, "already initialized" no-ops, analytics send failures) are
  INFO or DEBUG. Reminder create/update/delete and Settings → Delete All
  Reminders now record a server rejection at ERROR where before only the
  transport line existed — a rejected reminder never fires. The level policy
  is written down in `docs/DIAGNOSTICS.md` "Log levels". Nothing changes on
  screen; Loki volume is unchanged (production ships at `trace`). RS-039.
- Meetings: Fellowship and Language filters moved out of the individual Live /
  In-Person / Search segments into one bar directly below the segment tabs.
  Both are shared across the three segments and remembered across restarts;
  changing your fellowship in Settings still updates the bar. In-Person's
  Radius filter now has its own full-width row with Day and Time side by side
  beneath it, matching Search, so no value is squeezed into a third of the
  screen.

### Security
- **Push-token logs no longer carry part of the raw Auth0 sub.** Three
  push-registration log lines logged `userId` / `deviceId` as their first
  eight characters (`google-o...`, `apple|00...`). Those keys are the
  logger's own identity fields, so the truncated raw value replaced the
  hashed `userId` on the line: about 950 lines a day that couldn't be
  matched to a user, each carrying a fragment of the identity that
  `hashUserId` exists to keep out of Loki. The fields are gone, and the
  logger now removes `sessionId` / `appVersion` / `deviceId` / `userId` /
  `user_id` from per-call and child attributes, so only the context can set
  them. `traceId` stays an ordinary attribute. This has to land before
  RS-042's removal of the snake_case `user_id`. RS-043.

### Build
- **The Sentry source-map upload no longer warns about a mismatched server
  URL.** The Sentry plugin entry in `app.json` spelled the server as
  `https://sentry.io/`; the organization auth token embeds it without the
  trailing slash, and sentry-cli compares the two literally, so every
  `npm run update` warned that it was ignoring the configured URL. Same host
  either way and every upload succeeded. The slash is gone. This is an
  upload-tool setting that never enters the binary, so no `runtimeVersion`
  bump; the generated `sentry.properties` files pick it up on the next
  prebuild and were corrected by hand meanwhile.

## [4.10.1-10] — 2026-09-25

### Fixed
- **The Home clean-time counter now advances on its own.** It froze at the day
  the app was last cold-started: the card memoized its breakdown on the
  recovery date alone and `cleanDays` was a cached computed reading
  `new Date()`, so neither ever re-ran while Home stayed mounted behind the
  other tabs. A phone that kept the app alive in the background could show the
  same count for days, milestones included. Both now read an observable local
  date that ticks at midnight and on foreground. The `(Nd)` suffix in the
  display name had the same freeze (plus a UTC off-by-one) and now reuses
  `cleanDays`. The Home recovery chart (its "today" edge) and the 90-in-90
  card ("Day N of 90") froze the same way and now follow the same clock. The
  90-in-90 day count also no longer drops a day for the rest of the challenge
  once it spans the spring-forward DST change.

## [4.10.1-6] — 2026-09-19

### Fixed
- **Being signed out because the session could not be renewed now says so.**
  When a stored session can never be refreshed again (a dead refresh token, or
  the DPoP key it is bound to gone from the Keychain), the app signs the user
  out. It did that silently: the Login screen appeared with no explanation, as
  if they had never signed in. The Login screen now shows a short notice that
  the session could not be restored on this device and asks them to sign in
  again. One new i18n key in nine locales (translations queued for review).
  RS-036.
- **Declining the Auth0 consent screen is no longer logged as an error.** A
  user who reached the consent screen and chose not to authorize got the same
  treatment as a cancelled tab everywhere except in the logs, where the
  decline arrived as "User did not authorize the request" at ERROR twice per
  tap. It is classified as the user's choice now, alongside a closed tab.
  RS-022.
- **Attendance cloud backup no longer stops for good behind one record the
  server cannot store.** The push sent the outbox in batches of up to 200 and,
  when the server answered a batch with a 5xx, backed off and sent the same
  batch again on the next tick — forever, because a 500 carries no per-record
  result and the client had no other way to find the bad row. One user has
  been stuck on exactly this since 2026-09-18: a single attendance record whose
  duration was 37 days (a timer left running since June, from before the
  no-staleness-cap change) overflowed the API's 32-bit `credit` column, and
  the 199 records behind it never reached the server. A 5xx now bisects the
  batch to the one offending record, quarantines it, and syncs the rest; a
  real outage still ends the tick after three requests with the usual backoff.
  Independently, an attended duration is now capped at 24 hours when a timer
  session is saved (both the external-Zoom and in-person timers) and again in
  the push payload, so a stale timer can never poison a batch again on any
  build. The user still trims the duration in the Attendance tab, as the
  timer modals already say. The 90 vitest cases behind this are in
  `attendanceSyncService.test.ts`, `syncLogic.test.ts` and the new
  `creditLogic.test.ts`; `docs/BACKUP.md` "Push" has the design. RS-034.

- **Cloud backup's first sync ticks no longer race the RevenueCat SDK on a
  cold start.** The sync gate asked RevenueCat for the attendance entitlement
  before the SDK had been configured, on launches where a stored access token
  had expired: the refresh landed, every sync trigger fired in the same
  second, and each one hit "There is no singleton instance" — five ERROR lines
  per launch on the one device fast enough to lose the race, and a first sync
  delayed until the next trigger. The gate now checks that the SDK is
  configured, the same way it already checks that the database is open, and
  skips the tick quietly; the later triggers run as before. RS-029.
- **A Play Integrity provider that failed to start is retried on the next
  attestation instead of failing for the rest of the process.** One Android
  device's Play Store could not be bound at launch (Play Integrity error -9),
  and because the provider was prepared exactly once per process, every later
  attestation in that session threw "provider not prepared" and the app ran
  without a device token until the next cold start. The prepare is now
  re-attempted lazily each time an attestation needs it; a Play Store that is
  still broken degrades the same way it did before. RS-015.
- **A nearby-meetings location refinement that misses its budget is no
  longer logged as a failure.** When the In-Person segment already holds a
  cached position, the list is rendered and sorted from it and the fresh
  fix only refines the distances — but its 5 s timeout logged the same WARN
  as "no position at all", so the tracker counted a working segment as a
  location failure and could not tell the two apart. The refinement miss is
  now an INFO line of its own; WARN means the segment really has nothing to
  show. RS-016.

## [4.10.1-5] — 2026-09-18

### Security
- **The report recipient's email address is no longer sent to diagnostic
  logs.** Six log lines on the attendance-report send path — three in the API
  client (`Sending attendance report`, `Report sent successfully`, and the
  `Report status received` line that fires on every delivery poll) and three in
  the send hook (initial, resend/replace, forward) — attached the recipient
  address as a structured field, so it reached Loki on every build from
  4.8.0-3 on, roughly 100 lines per 48 hours. Every other identifier the app
  logs is deliberately hashed; this was the only raw personal data left, and it
  belongs to a third party (a sponsor, court officer, or employer) who never
  agreed to our telemetry. The field is dropped rather than hashed: `reportId`
  is on every line already and resolves to the recipient through the encrypted
  report row, so support loses nothing. The send hook's lines now also carry
  `module="ReportSender"`; they used the bare root logger and were invisible to
  module-filtered searches, which is why the leak was undercounted.
  (`docs/DIAGNOSTICS.md` now lists what is never logged.)

### Fixed
- **Subscriptions bought right after signing in now belong to the signed-in
  account.** RevenueCat's identity was read from the auth store at render
  time in a component that doesn't re-render on auth changes, so after
  sign-in the SDK stayed identified as the *device* until something else
  happened to re-render — and a purchase made in that window posted to a
  device-id customer the user's account could never see. The RevenueCat
  export showed 286 such purchases, 81 with active subscriptions (paying
  users who saw the paywall on every launch until they thought to tap
  Restore). Identity is now a MobX reaction: RevenueCat is switched the
  instant `userId` is written, and the device id is never used as a RevenueCat
  identity at all (signed-out sessions run on RevenueCat's own anonymous id,
  which is merged into the account on sign-in). Store receipts are synced once
  per identity per install instead of once per install, so the 81 stranded
  subscriptions move to their owners' accounts on the next signed-in launch
  with no Restore tap. Decisions in the vitest-covered `rcIdentityLogic.ts`.
- **Every log line now carries the app version, session, device, and (signed
  in) hashed user id — not just lines from loggers created late.** A child
  logger took a snapshot of the root's context when it was created, and the
  root's `setContext` built a new object each time, so any module-scope logger
  (`const log = logger.child({ module })`, created at import) never saw the
  context `app.tsx` fills in afterwards. Measured on 2026-09-16: 12 % of lines
  (all of `App`, `deviceId`, `ErrorHandler`, `sentry`) had no version or
  session — so no fingerprint on those modules could ever be tied to a build —
  and only 45 % carried a user id, which left the support lookup in
  `docs/DIAGNOSTICS.md` blind to the API, auth, config, and SQLite-key layers.
  The context is now one object shared with every child and mutated in place
  (`logger.ts`, vitest-covered). RS-026.

### Fixed
- **A store that stops answering no longer freezes the subscription UI — it
  tells the user to restart their device.** On 2026-09-15 a subscribe attempt
  hung mid-purchase on a Pixel, and every launch afterwards, including two
  fresh reinstalls, hung at the first RevenueCat call that touched Google Play
  Billing (`syncPurchases()` on first launch). The promise never rejected, so
  Settings showed "..." indefinitely and Subscribe never opened. A device
  reboot cleared it: the wedge was the Play Store service, not app state.
  Every RevenueCat call that reaches the store (`syncPurchases`, the paywall's
  offerings fetch, `restorePurchases`) now has a 20 s ceiling. On timeout the
  Settings status row reads "Google Play not responding — restart device" (or
  the App Store wording on iOS), and a Subscribe or Restore tap that hits it
  gets an alert naming the store, asking for a restart, and asking the user to
  come back and confirm the subscription (Restore Purchases if it doesn't
  show) since a hung purchase may or may not have completed. The migration
  sync leaves its one-time flag unset on timeout so it retries next launch —
  no Google Play or App Store subscriber is skipped. Decisions in the
  vitest-covered `billingHealthLogic.ts`; five new i18n keys in nine locales
  (English placeholders outside `en`).

### Changed
- **The paywall always shows RevenueCat's current offering.** The code
  looked up a hardcoded offering id first (`premium-standard` in dev,
  `default` in production) and fell back to the current offering — but
  neither id has existed in the RevenueCat project for some time, so the
  fallback was the only path that ever ran, and the "Resolved offering …
  found: false" log line on every paywall was the evidence. The lookup is
  gone: `current` is the offering the dashboard, Experiments and Targeting
  control, so changing the paywall is now a dashboard change with no release.

## [4.10.1-4] — 2026-09-14

### Fixed
- **Signed-out and anonymous launches no longer send a doomed push-token
  registration.** The app registered its push token whenever it had *any*
  identity, and the fallback identity when nobody is signed in is the device
  id — but the server route only accepts a signed-in user, so every such
  launch (and every sign-out) produced one guaranteed 403, a rejection the
  API edge counts toward banning the address. Registration now waits for a
  real Auth0 sign-in (`pushRegistrationUserId`, vitest-covered).
- **A device with no usable attestation token no longer floods the API with
  401s.** Three pieces, all in the auth path. (1) When the request gate had
  neither a device JWT nor an API key — attestation degraded or backing off,
  or outage mode before a lane was chosen — it sent the request anyway, and
  production has no API-key fallback, so every `/config` poll, meetings mount
  and foreground was a guaranteed server 401; the edge's brute-force rule bans
  on six. The gate now answers that 401 locally without touching the network
  (call sites see the same `unauthorized` result). (2) A device JWT the server
  had stopped honouring (rotated secret, revocation) was re-sent until its own
  expiry, up to seven days, across relaunches. The server's code-less 401 for a
  refused device token is now recognised; the token is dropped from memory and
  SecureStore and the next request re-asserts through the existing
  single-flight refresher — no extra Apple/Play round trip unless the stored
  key is also refused. (3) The `/config`, live-meetings and nearby retry
  ladders retried every failure kind, tripling each rejection; they now retry
  transport failures only. Decisions are pure and vitest-covered
  (`deviceJwtRejected`, `noDeviceCredentialAdapter`, `shouldDropRejectedJwt`,
  `isRetryableProblem`).
- **Cloud Backup no longer gets the device's IP banned by the API edge.**
  The report-body backfill asks `GET /reports/:id` for every local report
  with no stored body, and answers 404 for reports the server never had a
  body for (Firebase imports). Those 404s are true answers, but the app only
  remembered them for the session, so every cold start re-asked the same
  ids — 25 of them in ~13 s — and CrowdSec's 404-probing rule banned the
  address for four hours, four times in one day, re-tripping on each
  relaunch. A not-found body is now persisted per account (MMKV) so each id
  is asked exactly once per install; a server-side update to that report
  re-arms it. The pass also stops after five not-founds and waits a minute
  before continuing, so a brand-new install with a long list of body-less
  reports stays under the edge's bucket, and fetches are paced at 1 s instead
  of 300 ms. Covered in the vitest suite for `attendanceSyncService`.

### Changed
- **Legacy per-meeting hearts and stars now go schedule-wide as lists load,
  with no network lookups.** The one-time favorites/ratings migration
  (`FavoritesMigrator` → `migrateFavorites`) asked the API for every loved or
  rated meeting's schedule on launch — one or two `GET /schedules/meeting/:mid`
  per favourite, a 404 for each meeting delisted upstream, unpaced, and
  re-run on every launch until it finished. Those distinct 404 paths feed the
  same edge probing rule as the report-body bug above, so a user with a
  dozen delisted favourites could be banned on cold start. Every schedule list
  the app fetches already carries each row's full sibling grid, so the same
  reconcile now runs on the payload as it arrives (`feedbackCache
  .reconcileSchedules` → pure `reconcileScheduleFeedback`): a mixed schedule
  is loved whole or set to its highest star the first time it is listed, and
  a favourite on a meeting that never appears in a list is never shown, so it
  needs nothing. The migrator, its service, and both MMKV done-flags
  (`favorites.scheduleMigration.v1` / `ratings.scheduleMigration.v1`, now
  orphaned and harmless) are removed.

## [4.10.1-3] — 2026-09-14

### Added
- **Restore Purchases now offers to turn on Cloud Backup.** Only the purchase
  paths ever showed the opt-in, so a subscriber restoring on a second device
  (from Settings or from the onboarding import screen) was never asked and the
  launch-time backup pass had already decided before the restore. Both restore
  handlers now show the same dialog after the success toast, skipped when
  backup is already on. The dialog moved into `useCloudBackupPrompt` and the
  enable step into `enableCloudBackup()` so the toggle, the prompt, and the
  backup pass share one implementation. Decision logic in the vitest-covered
  `cloudBackupPromptLogic.ts`.
- **RevenueCat customers now carry the user's email.** Every customer in the
  RevenueCat dashboard showed no email, so support could not find a subscriber
  by address. The app now forwards the signed-in Auth0 email as the `$email`
  subscriber attribute right after RevenueCat is configured and again after
  each sign-in identity switch. Existing users are backfilled the first time
  they launch after this ships; anonymous (device-id) customers get nothing.
  Decision logic in the vitest-covered `emailAttributeLogic.ts`. A server-side
  backfill for users who never relaunch is deferred until the Auth0 Management
  API is reachable again.
- **One-off cloud-backup pass on the next cold start.** Cloud Backup is a
  per-device toggle, and the only prompt to turn it on fired on the device
  where the subscription was bought — so a subscriber's second device, or
  anyone who tapped "Not now" at purchase time, was never asked again and
  their attendance sat unbacked-up. On the next launch, a signed-in user with
  the attendance entitlement is now asked once (never again) to turn backup on
  if it is off, and gets a full backup run automatically if it is already on.
  The full run re-enqueues the entire local history, which also repairs any
  earlier initial backup that died mid-flight (offline, outage) and was never
  retried. Offline or maintenance at launch defers the pass to the next launch
  rather than burning it. `BackupPassRunner` + the vitest-covered
  `backupPassLogic.ts`; bump `BACKUP_PASS_ID` to run another pass later.

### Fixed
- **Live tab refills itself when a cold-start outage ends, and no longer
  empties when a refresh fails mid-session.** Two halves of one UX hole in
  the Live meetings feed (`MeetingContext`). (1) The auto-refresh watched
  `maintenanceMode` alone, but the cold-start outage path (`/status/ready`
  precheck failed → full-screen MaintenanceScreen) never sets that flag, so
  when the outage cleared nothing refetched and Live showed "no meetings"
  until a manual pull. Production masked it because outage recovery reloads
  the whole app; `Updates.reloadAsync` throws in dev builds, which is where
  it surfaced. The refresh now fires on the recovery edge of *either* flag,
  and the fetch is skipped (not retried for ~47 s) while either is up.
  (2) A failed `getLiveSchedules` used to clear the list, so the first
  quarter-hour poll that timed out as the API slid into maintenance wiped a
  list the user was looking at. The last successful list is now kept; the
  next successful refresh replaces it. Pure decisions in
  `connectivityLogic.ts` (`isLiveRefreshBlocked`, `isServiceRecoveryEdge`),
  vitest-covered.
- **Persisted sign-in record no longer exceeds SecureStore's 2048-byte
  limit.** The `auth_credentials_v1` record stored the Auth0 ID token beside
  the access and refresh tokens; the ID token alone is ~1.3 KB of profile
  claims and signature, so every login and every token refresh tripped
  expo-secure-store's size warning. Nothing ever read the persisted ID token
  (the SQLite key claim is taken from the fresh SDK token at login), so it is
  no longer written. Matters now because Expo has said the next SDK will reject
  oversized values instead of warning, which would have broken instant sign-in
  restore on cold start. The secure-storage wrapper now logs each write's key
  and byte size (never the value) and warns at the ceiling.
- **Cloud backup no longer re-fetches report bodies the server has never had.**
  A report imported from Firebase during onboarding (or created against another
  environment) has no row in the API, so `GET /reports/:id` returns 404 forever.
  The body backfill treated that as "retry next pass", and a pass runs on every
  foreground — so a device with a dozen such reports made a dozen requests,
  logged a dozen warnings, and sent a dozen analytics events every time the app
  came to the front. `not-found` is now remembered for the session and skipped,
  mirroring the report-delivery poller's 2026-09-13 fix. Transient failures
  still retry.

### Changed
- **Cold-start API precheck now hits `GET /status/ready`.** The probe that
  decides between normal startup and the outage screen (and the 15-second
  recovery poll on that screen) used the full `/status` health report; the
  readiness route is the same database-plus-TREX gate with a few-byte body.
  The probe also now requires the `{ "status": "ready" }` payload instead of
  accepting any 2xx, so a captive portal answering 200 no longer reads as a
  healthy API and sends the user into attestation against nothing.
- **`api_error` analytics now fires only for 5xx responses.** It used to fire for
  every classified problem, so expected misses (the 404s above), auth rejections,
  and offline timeouts dominated the metric and cost an analytics request each.
  Network and client-side failures are still logged; they just aren't counted as
  API errors.
- **Umami's success log line no longer dumps the response body** (a ~400-byte
  cache-token blob per event) into the dev log.
- **Backup copy now says the data is encrypted** — on the device, in transit,
  and at rest in the cloud — in the post-purchase prompt, the new cold-start
  prompt, and the Settings Cloud Backup hint. Nine locales; non-English text is
  best-effort and queued in `docs/translation-review-2026-08-03.md`.

## [4.10.1-2] — 2026-09-14

### Changed
- **Database open failures are logged once per attempt with a
  classification** (`kind`, `attempt`, `hadConnection`, `encryptedFileBytes`,
  `retryInMs`) and the first line of the error, instead of the full multi-line
  migration SQL on every one of hundreds of retries. `earlyOpen` logs the same
  shape at WARN and closes the singleton connection when it fails, so
  `DatabaseProvider` opens a fresh one instead of inheriting a latched codec
  error.
- **Attendance timer recovery no longer discards old sessions.** The
  cold-start resumer (`TimerSessionResumer`) used to silently throw away a
  persisted timer older than 6 hours, and the navigation lock's MMKV seed
  mirrored the same cap. Loki showed real users relaunching with timers that
  had been running 8 hours to 6 days, mostly on the same recurring meeting,
  and losing that attendance with no recovery path. Both caps are gone: the
  timer now always restores with its true elapsed time, and the user Saves
  and trims the duration in the Attendance tab. Both timer modals (external
  Zoom and in-person) now carry a standing note that attendance time can be
  corrected by editing the record in Attendance.

### Fixed
- **Encrypted database no longer bricks an install when its key goes missing,
  and the provider no longer hammers a broken database.** (RS-024.) Seven iOS
  devices in a week hit `Error code 7: out of memory` on the first statement
  after `PRAGMA key`; that message is SQLCipher's wrong-key signature, not a
  memory problem. Two things were wrong. `DatabaseProvider` had `status` in its
  open callback's deps, so every failure re-fired the mount effect instantly —
  ~29 attempts a second on the same poisoned connection, 320 ERROR lines per
  device, and a user stuck on the loading overlay with no way out but deleting
  the app. And the key service treated "no key in SecureStore" as "first
  launch" and minted a fresh key even when an encrypted database was already on
  disk, which can never open that file and overwrites the slot the real key
  could have come back to. Now: the key step refuses to generate over an
  existing encrypted file; the open runs once per mount, releases the
  connection on failure, backs off (1 s / 5 s / 30 s / 60 s) for transient
  causes, retries when the app comes to the foreground, and stops for a wrong
  or missing key; and the overlay shows what went wrong with a Retry button
  plus a confirmed **Reset local data** action for the unrecoverable case.
  Decisions live in the vitest-covered `app/db/dbOpenLogic.ts`.
- **Delete User Data no longer leaves the app unable to start.** It cleared
  the SQLCipher key but left the encrypted database file, so the next cold
  start had no key for a file that still existed (two of the seven RS-024
  devices, both needed a reinstall). It now deletes the database and its key
  together and restarts the app — which also makes it actually delete
  attendance rows, as the name promises.
- **Background launches while the phone is locked no longer spin forever.**
  SecureStore returns `User interaction is not allowed` (errSecInteractionNotAllowed)
  when a silent push wakes the app before the device is unlocked; one process
  retried that for 14 hours. It is now classified as transient, backed off,
  and retried on the next foreground transition.
- **Report delivery polling no longer runs forever against reports it can
  never see.** A Loki sweep found one 4.10.1 device signed in with its Google
  identity polling six reports created under the user's email identity: 710
  failed status calls in three days, 44 of them 429s. The server answers an
  ownership mismatch with 404 (deliberately indistinguishable from "no such
  id"), and the poller had no terminal condition except a delivered or
  errored 200, so every cold start re-armed the whole backlog from the
  10-second fast phase and blew the rate limit. The cold-start resume now
  skips reports owned by a different identity and reports older than seven
  days, re-runs when the signed-in identity changes (cancelling the previous
  identity's polls), measures its cadence from the report's real age instead
  of restarting the fast phase, backs off to the 15-minute interval after any
  API problem, and stops on `not-found`. Nothing is persisted on stop: the
  affected rows stay "Pending" in the Reports list, which is the honest state
  from that device. Pure decisions in `reportPollingLogic.ts`
  (vitest-covered).
- **Login screen explains "browser closed" and network failures instead of
  showing raw SDK text.** On Android, relaunching the app from the launcher
  icon while the Auth0 sign-in tab is open makes react-native-auth0 reject
  with "The browser window was closed by a new instance of the application"
  (its `onNewIntent` path; the singleTask MainActivity also pops the tab off
  the task). A plain retry always works, but the sentence read like a broken
  app. Loki showed one real user on 4.8.0 hitting it three times and giving
  up, plus the Play pre-launch crawler on 4.10.1. The wrapper now maps that
  error and the SDK's network failures ("Network error" / "Failed to execute
  the network request", the larger real-user bucket on 4.7–4.8) to actionable
  i18n copy; every other error still shows the SDK message. Pure classifier in
  `authErrorLogic.ts` (vitest-covered); new `loginScreen` keys in all nine
  locales.

### Build

- **Routine dependency refresh (JS-only, OTA-safe).** React Navigation
  `native` 7.3.18 / `bottom-tabs` 7.18.18 / `native-stack` 7.18.10, MobX
  6.16.1, mobx-state-tree 7.4.0, zod 4.6.2, date-fns 4.4.0, Vercel AI SDK
  6.0.282 (+ `@ai-sdk/react` 3.0.285), `@revenuecat/purchases-js` 1.60.1
  (web only), `@ungap/structured-clone` 1.4.0, and `@recoverysky-org/common`
  2.9.0 (server-side attestation model only — the app's SQLite migration set
  is unchanged). Dev tooling: Babel 7.29.7, jest-expo 54.0.18 (what
  `expo install --check` asked for), babel-preset-expo 54.0.12, ts-jest,
  tsx, dependency-cruiser, eslint-plugin-prettier, Reactotron,
  testing-library. No native module moved, so `runtimeVersion`
  stays put. The new React Navigation types surfaced that
  `navigationRef.getRootState()` can be undefined; the Android back-button
  handler in `navigationUtilities.ts` now treats that as "not ready" instead
  of assuming a state. Deliberately skipped: `reanimated-color-picker` 4.3
  (declares a peer of exactly Expo 56), prettier 3.9 (formatting churn),
  Vitest 4.1.11 (npm 10.9 crashes in Arborist — `Cannot read properties of
  null (reading 'edgesOut')` — resolving its optional jsdom→canvas peer
  chain, and npm 12 hoists `@vitest/mocker` away from its nested `vite` so
  every test run dies at startup; revisit after an npm fix), and
  every native-module bump (`expo` 54.0.37, `expo-file-system`,
  `expo-updates`, `react-native-auth0`, MapLibre) — those ride the next store
  build with a `runtimeVersion` bump.

- **Play Store submission uses a dedicated service account.** `eas submit
  --platform android` had been authenticating with the Firebase Admin SDK
  default service account stored on Expo's servers, which has no Play Console
  standing, so every submission failed with "missing the necessary
  permissions". A purpose-made `eas-play-submit` account (GCP project
  `meetingmakerapp`, invited in Play Console with app-level release rights) is
  now read locally from `credentials/android/play-submit-service-key.json` via
  `submit.production.android.serviceAccountKeyPath` in `eas.json`. The key file
  is git-ignored; a fresh clone needs it dropped in place before submitting.

## [4.10.1] — 2026-09-10

### Build

- **Native store release for a JS-only change.** Nothing native moved between
  4.10.0 and 4.10.1; `runtimeVersion` is bumped to `4.10.1` only so the OTA
  series stays aligned with the store build, per the convention in CLAUDE.md.
  Android `versionCode` is `41001000`.

### Fixed

- **A stale sign-in could silently break report sending.** A refresh token from
  a login made without the API audience (every TestFlight build from 3.12.1
  through 4.1.6 shipped that way) renews into an opaque Auth0 token the API can
  never accept. The app stored it like a real one, so meeting lists worked but
  every report send and push-token registration answered 401 and the user only
  saw "Failed to send report". The app now checks the shape of every access
  token where one enters the store (cold-start hydration, the Auth0 SDK sync,
  the request-gate refresher) and, when the API rejects a bearer with one of
  its new `token_malformed` / `token_claims` / `token_signature` codes, signs
  the user out through the existing forced-logout path so the next login mints
  a proper token. Expired tokens, the API's `token_invalid` code, and its 503
  `auth_unavailable` never trigger this. The report toast on a 401 now reads
  "Please sign in again to send this report" (new `attendanceScreen:sendFailed*` keys, English
  placeholder in the other eight locales).

## [4.10.0] — 2026-09-09

### Build

- **Version 4.9.0 was tagged but never shipped.** `npm run minor` cut the
  `v4.9.0` tag with `android.versionCode` still at `40800000` (the value Play
  already had from 4.8.0) and `runtimeVersion` still `4.8.0`, so the Android
  AAB was rejected and the OTA series would have pointed at the old runtime.
  Rather than rewrite the pushed tag, this release moves straight to 4.10.0
  with `versionCode 41000000` and `runtimeVersion 4.10.0` set **before** the
  bump script runs, as `docs/PRODUCTION_CHECKLIST.md` steps 4–6 prescribe.

### Changed

- **Live tab no longer fetches in-person meetings on every refresh.** The
  quarter-hour live refresh used to pull both venue pools from
  `/schedules/live` even though nothing rendered the in-person half (the
  In-Person segment loads its own nearby data on demand). That fetch was
  ~1.4 MB per refresh and failed on schedule: the API's schedule cache expires
  at the same :00/:15/:30/:45 marks the app refreshes on, and the uncached
  in-person pipeline outlasted the 10 s client timeout, logging a
  `getLiveSchedules(in_person) failed` error every quarter-hour (a red toast in
  dev builds). MeetingContext now fetches the online pool only.
- **Live refresh is jittered off the quarter-hour mark.** Every install used to
  re-fetch live meetings at exactly :00/:15/:30/:45, the same second the API's
  schedule cache expires, so the whole fleet arrived while the server was
  rebuilding and the slowest requests timed out. Each refresh now lands a random
  5–90 s after the mark; the Live list is at most a minute and a half staler
  than before, and the boundary stops being a thundering herd.
- **Device verification no longer blocks the app on temporary failures.** A server
  blip, timeout, or Apple/Play hiccup at launch now opens the app on local data
  with a calm "Connecting to RecoverySky…" banner while verification retries in the
  background. Only an unsupported device or an outright server refusal still shows
  an alert, and that alert no longer tells anyone to reinstall (attendance is local
  and a reinstall destroys it). Motivated by the 2026-09-08 `/attest` outage.
- **Launch is faster.** The device credential is persisted for its seven-day life,
  so most cold starts skip verification entirely; when it does expire, iOS
  re-verifies with a cheap App Attest assertion instead of generating a new
  Secure Enclave key (which Apple rate-limits). Requires API 1.6.0.
- **Meeting lists sort by device-local start time from midnight, AM first.**
  The Search segment (and the In-Person "start" order) had led with the
  afternoon and evening rows since 2026-08-12, so a list read noon → 11:59pm
  → 12:00am → 11:59am and looked out of order at the seam. It now reads
  12:00am → 11:59pm. Under "Any" day, rows group by device-local weekday
  rolling forward from today, then by that same clock within each day;
  favourites still float to the top of both. Which calendar day a meeting
  belongs to is the API's concern, not the app's.
- **The Search box now sits below the filter grid**, above the meeting count,
  and scrolls with the header instead of staying pinned above the segment's
  filters. It keeps keyboard focus while you type.
- **Meetings → Search no longer fetches at app launch.** The segment's schedule
  request now waits until the user first opens Search (the same latch In-Person
  has always used) instead of firing on every cold start — and again on every
  fellowship or day change — for a tab that may never be opened. Once opened,
  behavior is unchanged: filter changes and pull-to-refresh refetch as before.

### Added

- **Star ratings are now schedule-wide, like favorites.** Rating a meeting in
  either meeting popup sets that star on every meeting in its schedule, so a
  Monday five-star also shows on Tuesday and Thursday. Clearing the stars clears
  the whole schedule too. Existing per-meeting ratings are upgraded once at
  startup by the same one-time pass that upgraded favorites (its own done-flag,
  retried on a later launch if the API or a write fails); where a schedule
  already held mixed ratings, the highest one wins. Join counts stay
  per-meeting.
- **Distance / Start sort pill on the Meetings → In-Person list.** A second
  segmented control, styled like the List / Map one, switches the nearby list
  between nearest-first (the default) and
  start-time order — pm-first on a single day, day-by-day from today under
  "Any" day, favourites still on top in both. The choice persists across
  launches. Hidden on the map (no order to apply) and in the day-browse
  fallback (no distances to sort by). The List / Map pill moved down from the
  title row to sit beside it on one controls row under the filter grid, so the
  two read as one family and the title row matches Live and Search. Both
  share their chrome via `SegmentedPill`.
- **Free-text search on the Meetings → Search segment.** A search box now
  sits above the filter grid and matches every word you type against a
  meeting's name, description, fellowship, venue, city, region, location
  notes, tags and type codes (accent- and case-insensitive, all words must
  match). It works entirely on the already-fetched results — there is no new
  API call and no server search endpoint, so it is scoped to the selected
  day, venue and fellowship like every other filter here — and combines with
  the existing day / venue / language / radius / time filters. Pure
  predicates live in `filterLogic.ts` (vitest-covered). Live and In-Person
  are unchanged.

### Fixed

- **Hearts and stars now respond on the tap.** Favoriting or rating a meeting
  used to wait for every sibling in the schedule to be written to the database,
  one round trip at a time, while all three Meetings lists re-rendered between
  each write — a visibly delayed, sluggish icon. The popup now shows the new
  value immediately and the writes finish in the background; a write that fails
  still reverts on screen.
- **Stars and the heart are easier to hit.** Each was tappable only on its
  20–26 pt glyph, well under the 44 pt platform minimum, so taps often landed
  between stars and did nothing. Both meeting popups now give every star and the
  heart a 44 pt touch target, with a slightly larger star glyph to match, and
  the heart + stars sit on their own line above the Join / Get Directions
  button instead of squeezed beside it.
- Verification retries no longer regenerate the Apple key on every attempt; only
  the network exchange retries, on a longer 2/5/10/20 s ladder.
- A first launch that could not verify the device no longer lands on the
  maintenance screen and restart itself in a loop. Verification failing while
  the service itself is healthy left the app unable to load its server config on
  a fresh install, which looked like an outage; the recovery poll then found the
  service healthy and reloaded, forever, regenerating an Apple key each time.
  Such a launch now opens on the "Connecting to RecoverySky…" banner and reloads
  exactly once, when verification recovers.
- A rate-limited or expired verification attempt is no longer reported to the
  user as "Verification Rejected". Only an actual refusal of the app on the
  device (401/403) shows that alert; everything else retries behind the banner.
- **In-Person no longer falls back to downloading the whole country's day
  when nearby search fails.** When `/schedules/nearby` failed after its one
  retry, the segment quietly re-requested every in-person meeting for the
  selected day (~28 MB) to show an unsorted list. That single request was
  what kept OOM-killing the API: a brownout slowed nearby past the app's
  timeout, the fallback fired, the container died, its restart browned out
  nearby for the next user, and around it went — one user paging through days
  fired it five times in 12 seconds. The fallback is gone. A failed nearby
  search now shows the existing "Couldn't load nearby results — tap to retry"
  banner and a matching tappable empty state; both retry the nearby search
  only. (`useNearbySchedules`, `InPersonScreen`)
- **"I'm Here" could sit on "Checking…" forever until the app was killed.** The
  GPS presence check's location-permission request was its one unbounded
  await, and iOS never answers it when Location Services are off system-wide
  (no dialog is shown, so the OS callback never fires), when a second requester
  overwrites the pending one, or after a reload mid-prompt. The request now
  shares the same timeout guard as the GPS fix and reports the ordinary
  "couldn't get your location" alert instead of a dead button.
- **Meetings → Search now reloads when maintenance ends.** Its fetch was
  skipped during server maintenance but never retried when the banner cleared,
  so a user who opened Search mid-maintenance stayed on an empty list until they
  changed a filter or pulled to refresh. In-Person already handled this; Search
  now observes the maintenance flag the same way.

### Removed

- The "Search" heading at the top of the Meetings → Search segment. The new
  search box sits directly above the filter grid, so the word appeared twice a
  few dp apart; the box is now the segment's visual title.

### Security

- Diagnostic logs (OTLP → Loki) now carry a per-user identifier on every
  record so support can find a signed-in user's logs, but only as a
  **truncated SHA-512 hash** of the Auth0 sub — never the raw value. The two
  sign-in log lines that previously shipped the raw sub (which embeds the
  identity provider and its account id) are hashed the same way, so the
  unhashed sub no longer reaches Loki at all. Anonymous users are unchanged
  (`deviceId` already identifies them). Sentry and Umami still receive the raw
  identifier, as before, because their UIs group by it. Lookup recipe and the
  full identifier table are in `docs/DIAGNOSTICS.md`. The privacy policy
  (outside this repo) should list a diagnostic identifier and Loki retention.

### Changed

- Favoriting a meeting now favorites its whole schedule. Tapping the heart in
  either meeting popup sets the loved state on every meeting in that schedule
  (a Monday favorite now also favorites the Tuesday, Wednesday, … occurrences),
  and un-favoriting clears them all the same way. Previously only the single
  tapped occurrence was marked, so the rest of the week's occurrences of the
  same meeting sorted as if the user had never touched them. A schedule left
  mixed by old per-meeting favorites converges to the tapped meeting's new
  state on the next tap. Ratings and join counts remain per-meeting.
- Existing favorites are upgraded once, automatically: on first launch after
  this update the app looks up each currently-loved meeting's schedule from
  the API and favorites every meeting in it, so pre-existing hearts behave
  like new ones without re-tapping. The pass is retried on the next launch if
  the device is offline or the API is unreachable (guarded by a persistent
  once-only flag that is set only after a fully successful run); favorites on
  meetings that no longer exist upstream are left as-is and don't block it.
- Cold start no longer gates on a live `/config` fetch after first launch: the
  raw payload is cached in the encrypted SQLite database (`config_caches`) and
  refreshed in the background. Fixes the false-positive "The system is offline"
  full screen for users on slow or flaky networks at launch, and removes up to
  ~14s of retry stall from startup. Launching during server maintenance with a
  warm cache now shows the maintenance banner instead of the full-screen
  takeover (full screen remains for true first launches). Spec:
  `docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md`.
- The cold-start `/status` precheck now escalates its per-attempt timeout
  (2.5s → 4s → 6s) instead of retrying four times at a flat 2.5s. A network
  that needed 3–5s to answer used to fail every attempt identically and show a
  healthy user the "The system is offline" screen; the ladder gives slow
  connections a real chance while keeping the worst-case outage-detection
  budget slightly tighter than before (~15.5s vs ~17s).

### Added

- **"Any" day option on the In-Person and Search day selectors.** Finding a
  meeting in a sparse area used to mean opening the day picker seven times and
  reading seven lists. Picking "Any" searches the whole week at once, and each
  result row gains a weekday beside its start time so the list stays readable.
  In-Person offers it unconditionally — every one of its queries is already
  bounded by the search radius, which is what keeps the result set sane. Search
  offers it only for In-Person venues: an online day is ~500 meetings, so seven
  days would bury the feature's own audience in noise. On an Online search the
  option stays visible but greyed with the reason, rather than disappearing —
  the users it exists for are the least likely to go hunting for a hidden
  control. Switching a Search from In-Person to Online while "Any" is selected
  snaps the day back to today.

  Under "Any" the Search list groups by weekday starting from today and rolling
  forward, then keeps its usual pm-first ordering within each day; In-Person
  stays nearest-first, since proximity is that segment's promise and the day is
  a label there rather than the axis. The 24/7 marathon meetings get no weekday
  badge — they run continuously, so there is no day to name.

  Requires the API's `iso_dow=0` ("all seven days") support on
  `/schedules/daily` and `/schedules/nearby`; until that ships, choosing "Any"
  returns whatever the server makes of the sentinel.
- Device network detection (NetInfo → NetworkStore): the app now knows when
  the device itself is offline. Activates the previously-inert offline
  consumers — cloud-backup sync pauses while offline, the In-Person map
  toggle disables, Settings shows its offline state.
- "Device Offline" variants of the maintenance UX: the cold-start outage
  screen and the sticky top banner now say "you're offline — check your
  connection" when the device has no network, reserving the maintenance
  copy for when the device is online but the RecoverySky API isn't
  answering.

### Fixed

- **Recovery Dharma is selectable again.** RD was added back to the fellowship
  list on 2026-08-04, but only in `.env` and `eas.json` — not in the EAS
  server-side `production` environment, which is the only place `eas update`
  reads `EXPO_PUBLIC_*` values from. Every OTA published since then shipped an
  app with RD missing from all five fellowship pickers (Settings, onboarding,
  Live, Search, In-Person), while the 4.8.0 store binary — built from the same
  commit, but from `eas.json` — had it. Anyone who installed 4.8.0 and then
  took the 4.8.0-1 OTA watched RD disappear. The server variable is corrected
  and this release re-publishes the bundle with it; no new build is needed.
- **In-Person shows a loading indicator when you change the day, radius or
  fellowship.** Changing a filter over an already-loaded list refetched
  silently: the old rows and the old "N meetings" count stayed on screen with
  nothing moving until the new results replaced them, so a slow reload looked
  like the tap did nothing. The header's count now swaps to a small spinner
  for the duration of the reload, in both list and map view (map view had no
  indicator at all, and neither did web). Pull-to-refresh keeps its own native
  spinner and is unchanged. The header was extracted to `InPersonListHeader`
  (jest-covered) to make this testable.
- Users without connectivity (subway, airplane mode, dead zones) no longer
  see the "Maintenance in progress" banner: config-poll failures while the
  device is offline are no longer treated as evidence of service
  maintenance, and polling pauses entirely until the connection returns
  (with an immediate resync on reconnect).

### Build

- `@recoverysky-org/common` 2.7.1 → 2.8.0 (adds the `config_caches` table).

- **`npm run check:env` now checks the config source that OTAs actually read.**
  It compared `.env` against `eas.json` — the two sources `eas update` ignores —
  and so reported "IN SYNC" for nine days while the values reaching users were
  wrong (see above). It now also diffs `eas.json` against the EAS server-side
  environment named by the build profile's `environment` field, reporting
  mismatched, missing and extra keys. Sensitive/secret variables are listed as
  not comparable rather than false-flagged, since their values can't be read.
  If EAS can't be reached at all (offline, logged out) it exits non-zero instead
  of implying a clean result. `--no-eas` skips the new half, `--eas-only` runs
  only it.

- **`npm run update` blocks on that check before publishing.** The OTA preflight
  (type-check, unit tests) gained a config gate running
  `check-env-sync.js --eas-only`, so a stale EAS variable stops the release
  instead of silently shipping. Like the rest of the preflight it runs before
  the counter bump, so a failure leaves `package.json`, the tag and the remote
  untouched. `--eas-only` is deliberate: the `.env`-vs-`eas.json` half reports
  expected drift on any dev machine pointed at localhost, and a gate that always
  fails is a gate everyone learns to skip.
- ⚠️ NATIVE RELEASE REQUIRED: adds `@react-native-community/netinfo`
  (native module). Bump `runtimeVersion` with the next native version bump;
  this must not ship as an OTA on the current runtime. Dev clients must be
  rebuilt.

## [4.8.0-1] — 2026-08-13 (OTA)

### Added

- **Sending a report or generating a 90-in-90 certificate without a name now
  asks for one.** Both documents print your short name, and with the field no
  longer pre-filled it's possible to reach them without having set it. Instead
  of producing a nameless PDF, either action now offers a trip to
  Settings → Attendance. The gate covers all four report operations — first
  send, resend, replace, and forward — because a resend of a nameless report is
  just as wrong as the first one. It does not bounce you back automatically
  afterwards; set the name and return when you're ready. Users who still have
  the old "Anon M." default are not prompted: that name has always been on
  their reports and nothing about it changed.

- **Existing users get a one-time popup announcing in-person meetings.** The
  In-Person segment shipped without ever being pointed at, so anyone who already
  had the app had no reason to look for it — the announcement explains the list
  and map views, directions, and "I'm Here", with a button that opens the segment
  directly. It appears once, on the next launch or app resume, and never again
  after either button is pressed. Fresh installs are deliberately excluded:
  `completeOnboarding()` marks every bundled announcement as seen, so nobody is
  told a feature is "new" that shipped with their install.

### Changed

- **The profile is gone from onboarding and Settings.** Everything the old
  Profile surfaces collected — pronouns, "Show Recovery Date", "Show Recovery
  Days", the generated Display Name — existed to build the name we handed the
  bundled Zoom SDK. We join through the installed Zoom app now, which won't
  reliably take a display name, so the settings were collecting preferences
  that changed nothing a user could see. They are hidden rather than deleted:
  profile returns with the community features, and anyone who already set
  pronouns or a display option keeps that value.

  Onboarding is **six steps instead of seven** — the "Tell us about yourself"
  screen merged into "Your Recovery", which took over its title. Short Name is
  the one field that survived the cull, because attendance reports and the
  90-in-90 certificate print it, so it sits at the top of that merged screen.

  In Settings, Short Name **moved to the Attendance section**, above ID Number,
  with a line of hint text explaining that it appears on reports and
  certificates. That is the only place it can be edited now. Nothing about
  joining a meeting changed: the app still passes what it can to Zoom exactly
  as before.

  **Attendance also moved up to sit directly under Recovery**, so the two
  sections about your own recovery record read as one block instead of being
  separated by App Settings. Cloud Backup stayed where it was, under
  Subscription — it's gated on the entitlement you buy there.

- **Short Name starts empty instead of "Anon M."** The old default looked like
  a name the user had already chosen, so most people walked past it in
  onboarding and it ended up printed on their attendance reports. The field now
  starts blank and shows its placeholder ("e.g., Jane D."), which makes it read
  as something to fill in. Existing users keep whatever name they already have,
  including "Anon M." if they never changed it, and the Firebase importer still
  recognizes both an empty name and the old default as "not set yet" so it can
  fill in the name from the old app.

- **Spanish: the Settings tab is now "Ajustes", was "Perfil".** Every other
  language called that tab some form of "Settings"; Spanish called it
  "Profile", which was already confusing and became simply wrong once the
  Profile section was hidden. The screen's own heading and the seven other
  places that pointed users at it were saying "Configuración", so the Spanish
  app was using two different names for one screen and neither matched the tab
  — all of them now say Ajustes. Text that refers to the **device's** settings
  (opening iOS/Android settings to re-enable notifications or location) still
  says "Configuración", because that genuinely is somewhere else.

## [4.8.0] — 2026-08-12

### Added

- **In-person meetings now count your visits, the same way online meetings
  count your joins.** Tapping "I'm Here" and passing the GPS presence check
  records a visit, and the in-person popup shows the same "N joins · X ago"
  line the online popup has always had — so a returning user can see whether
  they've been to this room before, and when. Visits are recorded on a verified
  presence, not on the tap itself, so an out-of-range or location-denied
  attempt doesn't inflate the count. As with online meetings, a meeting you've
  visited also sorts above ones you've never touched.

- **Meeting lists now rank the meetings you actually attend higher.** Across
  Live, In-Person and Search, meetings you've been to more often sort above
  ones you've been to less, once favourites and star ratings have had their
  say. Previously attendance only decided whether a meeting counted as
  "touched" at all, so a room visited twice could sit below one visited once
  purely because it was nearer or started sooner. Ratings still outrank
  attendance — an explicit five stars beats simply turning up — and meetings
  you've never interacted with keep their nearest-first / soonest-first order.

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

- In-Person segment map view: a list/map toggle on the Meetings tab renders
  nearby results as a clustered MapLibre map — pins colored by fellowship,
  deliberately-approximate venues shown as translucent areas instead of
  precise pins, and your own position as the native blue dot. Tapping a pin
  opens the same meeting popup as the list. The map opens framed on your
  search area as soon as your location is known — including on the common
  path where you reopen the app straight into map view and the fix arrives a
  moment after the map does — and it stops drawing and stops using location
  the moment you leave the In-Person segment, rather than running unseen for
  the rest of the session. If the map itself fails to load (flaky network, a
  provider hiccup) it drops you to the list for that session only, without
  quietly discarding your saved preference for the map. Requires the server
  to provide MapTiler style URLs via /config (absent = feature hidden);
  native release only (new native dependency — runtimeVersion bump required).

- **Settings now has a Permissions section** with a Location switch. Recovery
  Sky asks before using your location and you can turn it off again at any
  time — previously the only way to stop the app using your position was your
  device's own settings, with nothing in the app to tell you it was on.

- **The In-Person map is findable now.** The switch between the meeting list and
  the map was a single unlabeled icon sharing a row with an equally-sized
  settings gear, so it read as decoration and people never learned the map
  existed. It is now a labelled two-part switch showing **List** and **Map**
  side by side with the current view filled in — the word "Map" is on screen
  before you touch anything, which is the whole difference between a feature
  you can reach and one you can find.

  The segment title also carries a count of how many meetings your filters
  actually return, so it's clear whether the map is worth opening, and an empty
  screen reads as "nothing matches" rather than "still loading" (the count is
  hidden while results are on their way).

- **The settings shortcut is gone from all three Meetings segments.** It sat at
  the end of every title row and went to the same place as the Settings tab a
  thumb-width below it. Removing it frees the one slot on those screens where a
  control specific to that segment can live — which is where the new list/map
  switch went.

- **The "I'm Here" GPS check now reports why it failed.** Only the successful
  case was ever recorded, so the four ways a presence check can fail —
  out of range, missing venue coordinates, permission refused, no GPS fix — were
  invisible, which meant there was no way to tell whether the feature was working
  or how the 150 m radius was performing in the real world. No position, distance,
  or venue is included in what is recorded.

### Changed

- **New splash screen.** The launch image now reads "find your recovery"
  instead of "find your pink cloud" — the old tagline is in-programme slang
  that lands as confusing (or as a drug reference) to anyone outside the
  rooms, which is the wrong first impression for a store listing's first
  screenshot. The wordmark also sits lower so it clears the sky rather than
  crowding the top edge. The file was re-exported at a third of its previous
  size, trimming the app download.

- **Editing an attendance record's duration is now a drag, not 60 taps.** The
  duration editor had a single ±1-minute stepper, so correcting a record that
  ran an hour long meant tapping sixty times. It now has a slider across the
  whole legal range with the ± buttons kept for landing an exact minute. The
  editor still only lets you reduce a recorded duration, never inflate it, and
  the slider is fully operable with VoiceOver and TalkBack.

- **Settings → Subscription puts Restore Purchases above the Upgrade button.**
  The plain text rows (Expires, Manage Subscription, Restore Purchases) now sit
  together and the glowing Upgrade call-to-action closes the section, instead of
  the button splitting the rows in half.

- **MapLibre's native log stream no longer goes to the console.** The map
  emits one record per failed tile request, and MapLibre routes those to
  `console.error`, so a slow connection stacked dozens of LogBox overlays
  ("Failed to load source maptiler_planet_v4: The request timed out") over the
  app and buried real errors. Those failures are transient and self-healing;
  the signal that a map is genuinely broken is `onDidFailLoadingMap`, which
  the In-Person map already handles by falling back to the list. Records now
  go to the development console only, and nowhere at all in production. They
  deliberately do not go through the app logger: in development that ships
  every record to OTLP over the network, and since the records are themselves
  network failures, it amplified the very problem it was reporting.

- **The In-Person map's cluster and venue counts now request the same fonts as
  the basemap.** The count labels carried no `text-font`, so MapLibre fell
  back to the style-spec default (Open Sans / Arial Unicode MS) — a font stack
  MapTiler's Streets basemap never uses — and downloaded a whole second set of
  glyphs nothing else on the map needed. When those requests failed, cluster
  pins rendered with no number in them.

- **The wide `__DEV__` presence radius is now opt-in**, so a development build
  can finally be pointed at the production radius. Previously `__DEV__` builds
  fell back to a hardcoded 10 km whenever the server omitted
  `DEV_PRESENCE_RADIUS_M`, which meant serving only `PRESENCE_RADIUS_M` was
  silently ignored and the real gate could not be exercised outside a
  TestFlight build — "get within 6.2 mi" was the fallback talking, not the
  config. The dev radius now applies only when `__DEV__` **and** the server
  actually sent one; otherwise both dev and production enforce
  `PRESENCE_RADIUS_M`. No change to shipped builds, where `__DEV__` is false
  and the dev field was never read.

- **Logging an in-person meeting now confirms in the same place an online one
  does** — a green "Attendance saved" banner across the top of the meeting's
  own popup, instead of a toast floating over the Meetings screen behind it.
  The toast read as an app-level notice rather than confirmation of the meeting
  you just logged, and the two paths disagreeing made the newer one look
  unfinished. Tapping the banner opens the new attendance record, as it already
  did online.

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

- **The In-Person tab now asks for location up front** instead of quietly
  falling back to a plain day list when it can't get a fix. Until location is
  on, the tab explains what it needs and offers to turn it on rather than
  showing a list that silently lacks distances and nearest-first ordering.

- **Push notifications now require a subscription.** They exist to deliver
  meeting reminders, which have always been a premium feature, so the two now
  match. Your current on/off setting carries over untouched — but without a
  subscription the Settings row now opens the subscription options instead of
  toggling, so if you have push switched on and want it off, use your device's
  notification settings for Recovery Sky.

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
- `__DEV__` builds now use the server's `DEV_PRESENCE_RADIUS_M` for the
  in-person presence check (falling back to 10 km until /config resolves).
  `/config` was already returning the field; the app ignored it. A simulator
  reports a fixed location that is never within the real radius of a real
  venue, so every "I'm Here" tap failed out-of-range and nothing past the GPS
  gate — timer, save, topic panel — could be exercised locally. Selection is a
  `ConfigStore.effectivePresenceRadiusM` view gated on `__DEV__`, which is
  false in TestFlight and store builds, so production still uses
  `PRESENCE_RADIUS_M`.
- Bumped `@recoverysky-org/common` `^2.4.1` → `^2.5.0` — incidental to
  installing `@maplibre/maplibre-react-native` for the In-Person map view;
  `npm install` re-resolved the `^2.4.1` caret range to the newest matching
  minor at the same time. No schema or code change in this repo depends on it.

- **Android now targets API 36 (Android 16), satisfying Google Play's Aug 30,
  2026 deadline.** Play requires every app's target API level to stay within one
  year of the latest Android release; ours was still on 35 and would have been
  blocked from further updates. `compileSdkVersion` was already 36, so this is
  the `targetSdkVersion` flag catching up to Expo SDK 54's own default.

  The one API 36 behavior change that would have been user-visible is Android's
  new "adaptive apps" rule: on any display 600dp or wider — tablets, unfolded
  foldables, Chromebooks — the platform stops honoring an app's orientation and
  resizability restrictions entirely. Left alone, every tablet user would have
  been dropped into landscape and freeform-resizable windows that no screen in
  this app has ever been designed or tested for. A new config plugin
  (`plugins/withRestrictedResizability.ts`) declares Google's sanctioned opt-out
  property so tablet users keep the portrait-locked app they have today, with no
  behavior change for anyone.

  Verified on hardware rather than assumed: a Pixel 7 running Android 17 was
  forced to a 617dp width (`wm density 280`, above the 600dp threshold) and
  rotated to landscape. The app stayed portrait and was letterboxed, which is
  the intended outcome. Note this held on an API 37 *device* — the opt-out is
  keyed to the app's target SDK (36), not the OS it runs on, so it expires when
  we target 37, not when users get Android 17.

  Edge-to-edge (the other headline API 36 change) needed no work — it has been
  enabled since `react-native-edge-to-edge` was adopted. Predictive back stays
  off via the existing `enableOnBackInvokedCallback="false"`, which remains a
  supported opt-out at 36.

  ⚠️ **The resizability opt-out expires.** Google states the property has no
  effect once an app targets API 37, which Play's rolling one-year rule makes
  mandatory around Aug 2027. Real adaptive-layout support is queued in
  `TODO.md`; this change buys the time to do it properly rather than during a
  release.

### Fixed

- **Every remaining black-slab button now follows the theme in light mode.** The
  "Heads up" dialog shown when joining an online meeting had a black Continue
  button, and the same hardcoded black sat behind the Save buttons on the
  meeting-topic prompt and both attendance timers, the In-Person popup's
  Directions button and fellowship badge, and the Sky Agent's send button and
  message bubbles. All of them now use a theme colour picked for the surface
  behind them, so nothing reads as an unstyled dark block on a pale screen. The
  orange borders and glow are unchanged.

- **Settings' big call-to-action buttons no longer show a black slab in light
  mode.** Upgrade to Premium / Login to Subscribe, Rate RecoverySky, Support and
  Check for Updates all shared a hardcoded black background, so on a light
  theme they read as an unstyled dark block dropped onto a pale screen. They now
  use the theme's elevated-surface colour — white in light mode, near-black in
  dark — keeping the orange border and glow in both.

- **The live-meeting popup and the Attendance tab's Send Report button follow
  the theme too.** The popup's Join Meeting button and fellowship badge, and the
  Send Report button on the Reports tab (and in the resend modal), all carried
  the same hardcoded black background, so in light mode they read as dark blocks
  on an otherwise pale surface. Same fix as the Settings buttons; the fellowship
  colour on the badge and the orange border and glow throughout are unchanged.

- **Subscribing now always offers to turn on cloud backup, however you got to
  the paywall.** The offer only ever appeared for someone who walked to the
  Settings tab by hand and tapped Subscribe there. Every in-app route to the
  paywall — the Attendance tab's Subscribe button, the live-meeting popup, the
  in-person popup — asks to be returned to where it interrupted you afterwards,
  and that return trip deliberately skipped the prompt so as not to put a dialog
  in front of what you'd just paid for. In practice that meant almost nobody was
  ever asked, and attendance history that could have been backed up wasn't.
  Subscribers are now asked before being handed back to what they were doing.
  Buyers the offer doesn't apply to — no attendance entitlement, or backup
  already on — still go straight through with no extra tap.

- **Subscribing from the locked Notifications row now confirms the purchase.**
  That gate ignored the outcome of the paywall entirely, so buying from it fell
  silently back to Settings with no confirmation and no cloud-backup offer. It
  now behaves like the Subscribe button.

- **Settings no longer shows Location switched on after you've turned it off in
  your phone's settings.** The app read the OS permission when you flipped the
  switch and then never re-checked it, so revoking location outside the app left
  a switch claiming a permission that was gone — and turning it off and back on
  was the only way to correct it. The app now re-reads the permission whenever it
  returns to the foreground and turns the switch off if the grant has gone. The
  reverse is deliberately not automatic: granting location to the app in your
  phone's settings does not silently switch the feature on, because that's a
  separate choice the app asks you for directly.

- **Granting location from the In-Person tab's prompt now works without leaving
  the tab.** If you tapped through to your phone's settings, allowed location,
  and came back, the tab kept showing the "enable location" state until you
  switched to another segment and returned — the check only ran when the segment
  changed, which coming back from the phone's settings doesn't do. It now runs
  when the app returns to the foreground too.

- **Turning Location off in Settings no longer immediately asks you to turn it
  back on.** Switching Settings → Permissions → Location off could pop a "use
  your location?" dialog on top of the switch you'd just turned off, which is a
  fair definition of annoying. The Meetings tab stays loaded in the background,
  and if the In-Person segment was the last one you looked at, its arrival check
  was treating your turning the switch off as a reason to run — so it asked. That
  check now runs when you actually arrive at the In-Person segment, which is when
  the question makes sense. A choice made in Settings is left alone.

- **Tapping a reminder for an in-person meeting now opens that meeting.**
  It used to open nothing at all. Reminder pushes carry a segment now (the
  server derives it from the meeting's venue), so an in-person reminder lands
  on the In-Person segment and opens the meeting's popup — with the address,
  the Get Directions button and "I'm Here" one tap away, which is the whole
  point of a reminder that fires while you're deciding whether to leave the
  house. Previously the tap dropped the user on the Live segment, which
  deliberately shows no in-person meetings, so the popup never opened. The
  meeting is fetched by id when it isn't already on screen, so this works on a
  cold start, before location permission resolves, and for a venue outside the
  radius the In-Person list is currently browsing — a reminder is for a meeting
  you chose, not one that happens to be nearby right now. Reminders for online
  meetings are unchanged, as are pushes from older server builds that send no
  segment.

- **A failed token refresh no longer retries on every single request.** The
  proactive token freshness gate recorded nothing when a refresh failed, so
  during any backend hiccup every outgoing request started a fresh attempt.
  On the device lane that meant up to 16 Apple App Attest key generations a
  minute from the config poll alone — against Apple's rate limit, which could
  leave a throttled device unable to pass attestation at its next cold start
  (the fatal "Device Verification Failed" alert). On the user lane it meant a
  session with a revoked refresh token hammered Auth0 with a renewal per
  request, forever. Both lanes now back off after failures (escalating to a
  15-minute hold), going out with the stale token in the meantime — a clean
  401 instead of load — and reset the moment a refresh succeeds.

- **Returning after the access token expired flashed the Login screen and
  leaned on the Auth0 SDK's own session restore to recover.** Cold start
  skipped hydrating stored credentials entirely when the access token was
  expired — dropping the still-valid refresh token with it, so the token
  freshness gate (which treats a token-less store as "never signed in") never
  attempted the renewal it was built for. Expired credentials are now hydrated
  too; the first API call refreshes them and signs the user back in without
  waiting on the SDK.

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
- Signed-in users silently lost API access once their Auth0 access token
  expired — meetings, reports and cloud backup would quietly stop working
  until the app was force-quit and reopened. Both the access token and the
  device attestation token are now refreshed proactively before each API
  call. If the session cannot be renewed at all (revoked or expired sign-in),
  the app returns to the sign-in screen — but never while an attendance timer
  is running, so an in-progress meeting is never lost to it.

- **Settings could show Location switched ON for a permission the app no longer
  held.** Choosing "Allow Once" (iOS) or "Only this time" (Android) grants
  location for a single session, and neither platform tells an app the grant is
  temporary — it reports the same status as "While Using the App". The app
  recorded that as durable consent, and the one place that ever undid it ran
  only when the app returned from the background. A one-time grant usually dies
  with the *process* instead, which produces no such moment, so the switch could
  keep claiming a permission that was gone. It now reconciles whenever the user
  opens Settings, and at the two points where the system has just refused
  location, so the switch tells the truth.

  Position was never at risk: every part of the app that reads location asks the
  system again first, so the stale switch could not have produced a location fix
  it wasn't allowed to take. The visible symptoms were the misleading switch and
  the In-Person tab opening onto an empty map instead of falling back to the
  meeting list.

  Deliberately **not** fixed by checking location at startup: nothing in this app
  may touch the location system before it is running and the user has navigated,
  and a cosmetic fix is no reason to become the exception.

- **Search no longer offers an in-person search it can't run.** With Settings →
  Permissions → Location off, picking the In-Person venue on the Meetings tab's
  Search segment returned an empty list explained only by a dimmed "Location
  off" radius cell — the In-Person segment, driven by the same toggle, has said
  so plainly in a banner since 4.8.0. The venue picker now drops the In-Person
  option while location is off (snapping an in-person search already on screen
  back to Online, since the toggle can be flipped from Settings while the
  Meetings tab stays mounted), and the same amber banner appears above the
  results. Tapping it runs the in-app location gate, which is the only thing
  that can turn the toggle back on.

- **The legal agreements no longer come up blank at login.** The CMS behind the
  disclaimer and the EULA occasionally fails a single document while serving
  its neighbour normally — a user tapping Sign In could land on an agreement
  screen with an empty EULA tab, no error, no way to retry, and an Accept
  button that still worked. Content fetches now ride out a transient upstream
  failure automatically, and if both documents still can't be shown the modal
  says so and offers a Try Again that reloads the pair together.

- **Accept is now blocked until both agreements are actually on screen.**
  Acceptance is recorded once and never asked again, so consenting to a
  document the app failed to display was a consent we had no business
  recording. The button greys out until the disclaimer and the EULA have both
  loaded.

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

### Removed

- **The login screen's "This is the updated AA/NA Live app" notice is gone.** It
  told migrating users to sign in with their old AA/NA Live credentials and
  pointed at support. That rename is far enough behind us that the banner now
  just crowds the sign-in screen for people who never used the old app — the
  same reason the matching Home screen card was retired.

---

- **The leftover Ignite template welcome screen.** `WelcomeScreen` was never
  registered on any navigator and nothing imported it — a dead "Your app,
  almost ready for launch!" screen carried since the template was scaffolded.
  Removed along with everything it was keeping alive: the `Welcome` entry in
  `AppStackParamList`, the `welcomeScreen` block in all nine locale files, and
  the Ignite lightning-bolt logo plus the welcome face image (`logo`,
  `welcome-face`, and their `@2x`/`@3x` variants). `config.base.ts`'s
  `exitRoutes` pointed exclusively at that phantom route, so it never matched a
  live screen; it is now empty, which is behavior-identical — the Android back
  handler already fell through to the system default on a non-match.

- **The unused `EmptyState` component.** Another piece of Ignite boilerplate
  with zero references anywhere in the app — every empty-state UI the app
  actually ships was hand-rolled in its own screen instead. Removed with its
  `emptyStateComponent` block in all nine locale files ("So empty... so sad")
  and the `sad-face` image it was the only consumer of (plus `@2x`/`@3x`).

- **`zoom-signup-example.png`**, orphaned since the bundled Zoom SDK and its
  `ZoomSetupScreen` / `ZoomLoginScreen` came out in 4.5.0.

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
