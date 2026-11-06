# TODO — Next Native Build Release

Items queued for the **next native build** (each requires a fresh
`npm run build:ios:* / build:android:*` + a `runtimeVersion` bump in
`app.json` — they cannot be shipped via OTA). Grouped by priority.

> Context: surfaced during the 2026-06-13 Android ANR investigation
> (4.5.0-5). See project memory `anr-nativepollonce-background-noise.md`
> for the full evidence trail.
>
> **Reading the "Observed on" tags:** these are reload-/teardown-path native
> crashes, so the version that matters is the native `runtimeVersion` (`4.5.0`),
> NOT the OTA counter (`-4`, `-5`). A stale OTA tag (e.g. `4.5.0-4`) does **not**
> mean the bug is resolved — it just identifies the bundle the user was on when
> the native code crashed. The faulty native code is identical across every
> `4.5.0` OTA, so **exposure persists on every OTA reload until the next native
> build.** Don't close these because the OTA counter moved on.

---

## ☀️ My Day follow-ons (Daily Dash) — not in the first build

Queued 2026-11-04, when the premium My Day tab was built on `feat/my-day-tab`.
Spec: `docs/superpowers/specs/2026-10-25-my-day-tab-design.md` (§6 the Sky
hand-off, §8 the open items). Plan:
`docs/superpowers/plans/2026-11-04-my-day-tab.md`. CLAUDE.md "My Day (Daily
Dash)" says what shipped.

**The Sky hand-off (spec §6).** Waits on My Day's `sky` capability (Sky
moments design §7, Daily Dash plan 2) and the agent's moment addenda (that
design's §4, agent plan 1), both unbuilt. Then `MyDayHost` passes
`capabilities.sky` and every moment routes to the Sky Agent tab. What
`AgentScreen` needs, in order:

- [ ] **The `daily-dash/1` guide, a `conversation_id` and the `moment`** on the
      chat body for conversations My Day opens. Today it sends neither guide
      nor id and keeps history in encrypted SQLite, while the agent holds
      those conversations' history (Sky chat design D8). So a second history
      model sits beside `ConversationStore` or replaces it: that design's
      decision.
- [ ] **The approval card** (`skyCardLogic` + `SkyCard`,
      `addToolApprovalResponse`, `sendAutomaticallyWhen:
      lastAssistantMessageIsCompleteWithApprovalResponses`). Without it a
      Daily Dash write tool stalls at `approval-requested` with nothing to tap.
- [ ] **The `crisis-resources` part drawn as a card.** `AgentScreen` renders
      only text and tool parts today.
- [ ] **Decide whether `bubble` moments open a sheet here or map to the tab.**
      The moments table is the API's; the mapping is the host's.
- [ ] **The two agent configuration items (spec §5.5)**, any time before the
      hand-off: this app's client id stays in the agent's `DD_APP_CLIENT_IDS`
      (its CLAUDE.md marks it for removal), and `daily-dash/1`'s stripping of
      the RecoverySky manual tools is wrong when the host is this app.

**The rest:**

- [ ] **`reminders`, once the client registers a push token.** The client has
      no `registerPushToken` today, so the Daily Dash API cannot reach this
      app's push token and "Remind me later" would promise nothing. When the
      client grows it, wire our Expo push token through and pass the
      `reminders` capability.
- [ ] **Daily Dash tokens on sign-out (spec §8, §4.4).** Our logout leaves the
      Daily Dash session record, tokens, database and key on the phone (D8).
      If the tokens should go on sign-out, the Daily Dash client first adds a
      sign-out reason that keeps the file (the `sky_sign_in` path under a
      host's name); only then may logout call it, and
      `dailyDashPolicy.test.ts` must learn the new call. Nothing is deleted
      either way.
- [ ] **Relinked identities (spec §8, §4.4).** A relink (`relinkOwner`) gives
      the owner a new sub, and the Daily Dash platform treats it as a new
      account: the driver's `releaseDevice()` hands the device to it, and the
      person's earlier My Day data stays with the old platform account. Flag
      to the Daily Dash team (ADR 0015 makes the Auth0 subject the identity
      unless the platform links subs). No change here.
- [ ] **Photo weight (spec §8, §4.6).** The 13 bundled JPEGs in
      `assets/images/my-day/` total about 1.4 MB. Measure first paint on a
      low-end Android in the device checklist (plan Task 16) and decide
      whether to downsample.
- [ ] **Web.** The tab is hidden on web (`decideMyDayTabVisible`). Lifting it
      needs COEP/COOP headers on our web hosting for expo-sqlite's OPFS worker,
      and `wasm` in Metro's `assetExts`.
- [ ] **`npm run vendor:update`: check the shared `ts-rust-result` pin.**
      DONE 2026-11-04: the script's prune keeps every tarball `package.json`
      still names (`tarballsToKeep`), so it no longer deletes the Daily Dash
      tarballs. Left: check the shared `@jenova-marie/ts-rust-result` override
      against the Daily Dash packages' exact pin, so a common bump that moves
      it fails loudly instead of forcing a new version on sdk and client.
- [ ] **My Day: a failed release holds the loading screen.** After a
      `wrongAccount`, a refused or failed `releaseDevice()` leaves "Getting My
      Day ready…" up until the next reconnect or foreground edge. Map it to
      `connectFailed` and give Try again an edge (final review M3).
- [ ] **My Day: prefix the client's Umami events.** The client's
      `signed_in`, `signed_out` and `account_restored` reach Umami beside the
      app's own names; wrap `track` to prefix them `dd_` (final review M4).
- [ ] **My Day: draw the photo behind the gate.** The gate's blocking screens
      paint a flat background, so the tab flips to the photo and glass when
      ready (final review M5).

---

## ⏳ Adaptive layouts for large screens (HARD DEADLINE ~Aug 2027)

Queued 2026-08-10, when `targetSdkVersion` went 35 → 36 to meet Play's
Aug 30, 2026 API-36 deadline.

Android 16 (API 36) ignores `android:screenOrientation`,
`android:resizableActivity`, `android:minAspectRatio` / `maxAspectRatio`, and
runtime `setRequestedOrientation()` on any display measuring `sw600dp` or
larger. We currently suppress that with Google's temporary opt-out property,
declared by `plugins/withRestrictedResizability.ts`.

**That property has no effect once we target API 37.** Play's rolling
"within one year of the latest release" rule means targeting 37 becomes
mandatory around **Aug 2027**. At that point tablets, unfolded foldables, and
Chromebooks get landscape and freeform-resizable windows whether we are ready
or not — there is no further escape hatch. We have confirmed tablet users, and
`plugins/withUsesFeatures.ts` exists specifically to keep the app visible to
cellular-less tablets and Chromebooks, so this is not a population we can
write off.

Starting position: there is **no** responsive logic anywhere in `app/` today —
no `useWindowDimensions` consumers, no breakpoint helpers, no tablet branches.
`app.json` sets `"orientation": "portrait"` and every screen assumes it.

- [ ] **Spec the adaptive work before writing any of it.** This is a
      design problem (what does a 1024dp-wide Meetings tab even look like?),
      not a config change. Produce a spec in `docs/superpowers/specs/` the way
      the in-person map and permissions-section work was specced.
- [ ] **Audit every screen at ≥600dp width.** Highest risk by inspection:
      `SchedulePopup` and `InPersonPopup` (modal sizing), `InPersonMapView`
      (GL surface + camera fit), `AttendanceScreen` (Reports tab tables), the
      onboarding flow (fixed vertical rhythm), and the paywall.
- [ ] **Decide the breakpoint strategy** — a shared hook + theme tokens, so
      screens don't each invent their own `width > 600` check.
- [ ] **Verify rotation mid-flow doesn't lose state**, especially the
      attendance timer (`useAttendanceTimer`) and the in-person presence check.
      `MainActivity` already declares `configChanges` for `orientation` /
      `screenSize` / `screenLayout`, so the activity is not recreated — but
      that has never actually been exercised, because the portrait lock meant
      the config change never fired.
- [ ] **Delete `plugins/withRestrictedResizability.ts`** once the above lands.
      Do not attempt to carry it forward to target 37 — it is inert there.

---

## 🧱 Next native build (4.11.0): native dependency refresh (needs runtimeVersion bump)

Queued 2026-09-12. Spec: `docs/superpowers/specs/2026-09-12-next-native-build-design.md`
(read it first — it carries the per-package rationale, composition notes, and the
manual checklist for both platforms). One store build, one `npm run minor`,
`runtimeVersion` → `4.11.0`, `versionCode` → `41100000` by hand.

Everything JS-only from the same 2026-09-12 review already shipped on
`chore/deps-2026-09-12` (commit `7c76118`); this list is what it left behind.

**§A — `react-native-auth0` 5.6.0 → 5.11.1**
- [x] **Bump `react-native-auth0` to 5.11.1.** DONE 2026-10-06 on `release/4.11.0`. Four minors behind; 5.11.1 lists
      unspecified "security fixes" and moves Auth0.Android 3.15 → 3.21 and
      Auth0.swift 2.19 → 2.25. Config plugin is byte-identical across the range, so
      prebuild output should not change — diff the generated manifest anyway.
- [x] **Wire `resumeSession()` into `useAuth0Wrapper` cold start.** DONE 2026-10-06
      (once per process via a module-scoped flag — the hook has five mount sites). Recovers an
      Android login the OS killed mid-Custom-Tab (Samsung/Xiaomi, mail-app switch for
      a verification code). One effect, no new store plumbing — the existing `user`
      sync effect does the rest. Android-only in effect; safe to call everywhere.
- [x] **Confirm the Auth0 tenant does not set IPSIE `session_expiry`.** CHECKED 2026-10-06
      via the prod Management API: no session-lifetime overrides on the tenant, and the app
      client's refresh tokens are non-expiring / non-rotating. No mapping added. 5.11.0 adds a
      `SESSION_EXPIRED` credentials error; our refresher treats unknown codes as
      transient, so if the tenant ever sets it, map it to `permanent` in
      `tokenFreshnessLogic.ts` (with a vitest case). Not speculatively.

**§B — Expo SDK 54 patch alignment** (`npx expo install --check` has asked since 2026-09-12)
- [x] **`expo` 54.0.36 → 54.0.37.** Android `expo-fetch` first-chunk ordering race
      (Sky agent stream + OTLP logger both go through `expo/fetch`); faster `TextDecoder`.
- [x] **`expo-updates` 29.0.19 → 29.0.20.** Rejects update assets whose key or
      extension carries a path separator — OTA-path hardening. After the store build is
      live, publish a trivial OTA first to prove the new client still takes our bundles.
- [x] **`expo-file-system` 19.0.23 → 19.0.24.** Alignment only; its one fix (iOS
      `copyAsync` on edited `ph://` assets) is a path we never use.
- [x] Use `npx expo install <pkg>@~x.y.z` so the tilde ranges land the way Expo
      expects; `npx expo install --check` must come back clean afterwards.

**§C — `@maplibre/maplibre-react-native` 11.3.6 → 11.3.10**
- [x] **Bump to 11.3.10.** Android: two map ANR deadlocks + camera NPE (11.3.8).
      iOS: heap corruption in style-image loading (11.3.9), `GeoJSONSource` recycling
      (11.3.10), NaN edge insets on a zero-sized map view (11.3.8). All lifecycle bugs
      on exactly the mount/unmount path the In-Person map's list/map toggle exercises.
      No JS API change; `InPersonMapView.web.tsx` stub still required.
- [x] Recheck the privacy invariant after the bump: `NativeUserLocation` for the puck,
      never `UserLocation`; `getSearchCenter` is still the only `coordsRef` reader.
      CHECKED 2026-10-06: puck is `NativeUserLocation`; raw coordinates live only in
      `useDeviceLocation`'s ref (the ref moved there from `useNearbySchedules`).

**§D — `withAuth0LaunchTrampoline` config plugin (RS-005)** — added 2026-09-15
- [x] **Write `plugins/withAuth0LaunchTrampoline.ts`** and register it in `app.config.ts`.
      DONE 2026-09-19 on branch `feat/auth0-launch-trampoline` (merge with the 4.11.0
      build, not before — it is a native-shape change and root's `runtimeVersion` is
      still 4.10.1). Manifest half verified against the last generated manifest with
      `npx tsx plugins/withAuth0LaunchTrampoline.check.ts`; the Kotlin half and the
      device checklist below still need `prebuild:clean` + a device build.
      Writes `LaunchActivity.kt` (`isTaskRoot()` → start `MainActivity` with the launch
      intent's action/data/extras forwarded, else just `finish()`) and moves the
      `MAIN`/`LAUNCHER` intent-filter from `.MainActivity` to `.LaunchActivity`
      (splash theme, `exported="true"`). Full design + the expo-notifications audit in
      spec §D. Root cause: `A0Auth0Module.onNewIntent` rejects the pending login on
      *any* new intent to the `singleTask` `MainActivity`; a launcher tap mid-Custom-Tab
      is that intent.
- [x] **Why this stopped being a non-goal:** passwordless email sign-in sends every
      user to their mail app for a code; the ones who come back via the app icon
      hit this every time. Has to be in the binary before passwordless ships as
      an OTA on top of it.
- [x] `prebuild:clean` and diff the manifest: exactly one `LAUNCHER` filter, on
      `.LaunchActivity`; `.MainActivity` keeps `VIEW exp+recoverysky-app`;
      `RedirectActivity` unchanged. DONE 2026-10-06, exactly that diff.
- [x] Device checks in the spec's "§D — trampoline" list — especially the two push-tap
      cases (cold: extras forwarded; backgrounded: nothing above `MainActivity` cleared).
      PASSED 2026-10-06 on a Pixel 7 (4.11.0 debug): icon tap mid-sign-in keeps the tab;
      process killed mid-sign-in + icon tap + finish → signed in; warm and cold push taps
      route via NotificationForwarderActivity → LaunchActivity (dev-menu "Test push").
- [x] Issues MCP: RS-005 is `fix-proposed`; move to `fix-committed` with
      `fix_release app 4.11.0` when the plugin merges. DONE 2026-10-06. Separately (recoverysky-loki repo):
      re-point the RS-005 fingerprint to `module="useAuth0Wrapper"` — the `LoginScreen`
      one has been blind since 4.10.1-1 because it logs the friendly copy.

**Gate**
- [x] Run the spec's manual checklist on **both** platforms before `release:*`.
      PASSED 2026-10-06 on Android (Pixel 7) and iOS (iPhone SE 3).
      Nothing in CI exercises auth, OTA download, or the map.

_Not in scope (see spec): ~~the `LaunchActivity` trampoline~~ (moved into §D above on
2026-09-15). Not here: `@sentry/react-native` 8 (see
"Background-ANR hygiene" below — native, so it belongs in this build or the next,
never an OTA), React Native 0.87, Expo SDK 57, and the other majors — each is its
own upgrade project._

---

## 🔴 Real crashes (chase these first)

A genuine crash with app frames in the stack — unlike the ANR, worth
fixing. Seen in Play Console → Android vitals on 4.5.0, low volume today
(1 user / 1 event) but real.

- [ ] **JSI `SharedObject` teardown crash during OTA reload** — `expo-modules-core`.
      Two faces of the same bug:
      - Android: `libexpo-modules-core.so` `__shared_ptr_emplace<facebook::jsi::Object>::__on_zero_shared()` → SIGSEGV.
      - iOS: `-[EXJavaScriptWeakObject .cxx_destruct]` → `jsi::WeakObject::~WeakObject` →
        `jsi::Pointer::~Pointer` (jsi.h:591) dereferences a null pointer → EXC_BAD_ACCESS,
        inside `SharedObjectRegistry.clear`.
      **Confirmed trigger: the OTA-update reload** (breadcrumbs: "OTA update fetched,
      prompting reload" → DB close → AppStack/Provider unmount → crash as Expo wipes
      its JSI object registry). Already partly mitigated in `provider.ts` (no
      `enableChangeListener`) and commit `32e2465` (close SQLite SharedObject before
      OTA reload), but still firing — the registry wipe races provider teardown.
      **Fix lever: upgrade Expo SDK / `expo-modules-core`** (NOT React Native — this is
      Expo's JSI layer, so the RN bump below won't cover it). Audit any remaining JSI
      SharedObjects (native module instances) torn down during the reload.
      _Observed on: iOS `4.5.0-4`, Android `4.5.0` (counter 0). Both stale OTAs —
      but the native teardown is unchanged in `4.5.0-5`, so it recurs on the next
      reload. Exposure persists until the native bump._

- [ ] **Upgrade React Native (currently 0.81.5).** Several rare, native-only
      crashes we've decided not to fix individually are RN-core bugs an upgrade
      should sweep up:
      - `ReactModalHostView.dismiss` → `IllegalArgumentException` (Android Modal
        dismissed after the OS killed the activity; RN's `dismiss()` is missing
        the nil-window guard its sibling `updateProperties` already has).
        Can't patch-package — app links the **prebuilt** `react-android` AAR, so
        `.kt` source patches don't compile in. _Observed on: `4.5.0-5` (current)._
      - `RCTNetworking prioritizedHandlers` → `NSInvalidArgumentException`
        (iOS: a nil URL-request handler during an **OTA-reload** bridge teardown
        race; newer RN filters nils out of the handler array).
        _Observed on: `4.5.0` (counter 0, stale) — but native, so it recurs on
        every reload until the bump._
      Watch the second one during OTA rollouts — it's on the update path. Verify
      both are fixed in the target RN version's changelog before relying on the
      upgrade to close them.

---

## 🟡 Background-ANR hygiene (optional, bundle — do NOT cut a build just for this)

The 4.5.0 "Background ANR" is **environmental / Sentry-SDK instrumentation,
not our code** (idle-Looper "No focused window" + Sentry
`UserInteractionIntegration.onActivityPaused` lazy class-init during onPause).
Aggregate user-perceived ANR rate is 0.19% — under Google's 0.47% bad-behavior
threshold and trending down (−0.10%), though +0.15% above peer median. These
items only shave that peer gap; none are user-facing. _Observed on: `4.5.0-5`
(current) + a Background ANR on `4.5.0`; Sentry SDK lives in the native binary,
so this is `runtimeVersion`-level regardless of OTA counter._

- [ ] **Bump `@sentry/react-native`** (currently `7.2.0`). `UserInteractionIntegration`
      / `onPause` ANRs are a known upstream class with SDK-side fixes — scan
      their changelog when bundling. (Native dep change → `runtimeVersion` bump.)

- [ ] **OR disable native UI-tap breadcrumbs** to remove the exact frame from the
      backgrounding path. Add to `AndroidManifest.xml` meta-data:
      `io.sentry.breadcrumbs.user-interaction = false`. Low cost — these
      breadcrumbs are largely redundant with the `bridgeLoggerToSentry` logger
      bridge in `app/services/crashReporting/sentry.ts`. (Note: the JS
      `enableUserInteractionTracing` option is already default-false and does
      NOT remove the native integration.)

- [ ] **No code fix for the ANR itself.** Mute/triage the idle-Looper /
      "No focused window" / `UserInteractionIntegration` ANRs in Sentry so they
      stop inflating the fatal count and masking real foreground hangs.

---

## 🔵 In-Person UI: deferred items (JS-only — NOT runtimeVersion-gated)

Unlike everything above, these do not require a native build; they're listed
here for visibility rather than to queue for the next `runtimeVersion` bump.
Both owner-ruled (Jenova, 2026-08-03) during the In-Person UI branch's
documentation pass.

- [x] **Premium-gate `returnTo` round-trip is broken for in-person meetings.**
      ~~`InPersonPopup` sends `returnTo: "Meetings:meetingId:<id>"` (copied
      verbatim from `SchedulePopup`, per the plan) → `SettingsScreen.navigateReturn()`
      hardcodes `segment: "live"` → `MeetingsScreen` force-routes to Live
      whenever a `meetingId` route param is present → `LiveScreen` deliberately
      drops in-person records (commit `16344c5`).~~ **FIXED 2026-08-03** — the
      defer ruling was reversed the same day. Option (b) from the analysis,
      full restoration: the grammar gained a segment-carrying form
      (`Meetings:<segment>:meetingId:<id>`), parsing moved to the pure,
      vitest-covered `app/utils/returnToLogic.ts`, and popup restoration now
      goes through the module-level pending-meeting store — which grew a
      `"live" | "inperson"` target so LiveContent and InPersonContent, both
      mounted at once, can't race for the same id.
      Fixing it surfaced a second, pre-existing bug on the **live** path:
      `navigateReturn` passed `meetingId` as a route param, but `LiveContent`
      stopped reading that prop when deep links moved to the pending store —
      so a purchase from `SchedulePopup` restored the segment and never the
      popup. Both paths are fixed. Original analysis:
      `.superpowers/sdd/2026-08-03-in-person-ui/task-10-report.md` → "Question 2".
      **Device verification (2026-08-03):** the in-person path is confirmed
      working on Android hardware — a real paywall purchase from `InPersonPopup`
      returns to the In-Person segment with the popup reopened. Still
      unverified: (a) the **live** path on any device — that's the
      pre-existing bug above, the one existing users hit, and it has to be
      exercised from an online meeting's reminder gate in `SchedulePopup`;
      (b) **iOS**, on either path. The change is JS-only so iOS is expected to
      behave identically, but "expected" isn't "checked".

- [ ] **Open question, not a bug: why is `formattedAddress` 0% populated for
      in-person meetings?** `meeting.d.ts`'s `street` field JSDoc says "For
      TSML there are no address components at all — only `formatted_address`
      — so this is parsed, best-effort." If TSML's source data genuinely is a
      formatted address and `street`/`city`/`state`/`postalCode` are parsed
      out of it, then 0-of-55,617 population suggests ingest parses the
      original into components and discards the composed string. This
      reasoning comes from the shared model's JSDoc, not from reading their
      ingest code — the docs may be stale. Ask the API team. Note: BMLT
      publishes address components natively, so composing an address
      client-side there really is synthesis and correctly belongs in
      `composeAddress()` (`app/utils/nearbyLogic.ts`) rather than upstream.

- [ ] **Translation review queue is a release blocker.** 421 machine-assisted
      strings across eight non-English locales (es/ar/de/fr/pt/ru/th/uk) await
      a native-speaker pass before this ships. Full list, with the per-namespace
      breakdown: `docs/translation-review-2026-08-03.md` — treat that document
      as authoritative and do not restate its total here again.
      WAIVED FOR 4.8.0 (2026-08-09): the 4.8.0 native release shipped these as
      machine-assisted text by explicit decision. The waiver covers 4.8.0 only
      and does NOT clear this item — it stays open. Locale files are JS, so a
      reviewed batch can ship as an OTA on top of 4.8.0 with no native build.
      UPDATED 2026-08-05: this read "133 strings across seven locales
      (ar/de/fr/pt/ru/th/uk) — 70 in `inPersonPopup`, 63 in `inPersonScreen`",
      which was correct on 2026-08-03 and then drifted as four more namespaces
      landed (location-failure copy, `liveScreen`, and `presence` +
      `inPersonTimer`, the last 96 strings being the GPS in-person attendance
      work). It also omitted `es`. A duplicated count in a second file is what
      went stale; the pointer above is the fix.
      Structure is already machine-verified (identical key sets across all
      nine locales, every interpolation placeholder present); what's missing
      is a semantics/register check. Flag for the reviewer: Arabic embeds
      `{{distance}}` inside RTL text with Latin numerals and needs checking
      on device. Also tracked in `docs/PRODUCTION_CHECKLIST.md`.

- [ ] **A failed `markProcessed` leaves an orphaned created-but-unprocessed
      attendance row.** Every attendance writer does `create` first and
      `markProcessed` after, so if all four `markProcessed` attempts fail the
      function returns `{ ok: false }` while the created row survives — stuck in
      the state the retry comment calls "orphaned" and "can't see or recover".
      This is a house pattern, not one path's bug: it holds for
      `saveTimerAttendance` (`app/services/zoom/externalAttendance.ts`) and for
      `saveInPersonTimerAttendance` (`app/services/inPerson/timerAttendance.ts`)
      alike, so any fix should cover both. Likely fix is a resumer that
      re-drives `markProcessed` on orphans at launch.

      REWRITTEN 2026-08-05: the original item was filed against
      `saveInPersonAttendance` (`app/services/inPerson/attendance.ts`) and its
      `hasLoggedToday` same-day guard, both deleted when GPS-verified timed
      attendance replaced single-tap logging. The *reported-as-success*
      half of this bug died with them — there is no same-day guard left to
      short-circuit into `{ ok: true, alreadyLogged: true }`, and the
      `inperson_attendance_logged` event that could over-count is gone too
      (see the separate note below about its missing successor). The orphan
      risk described above is what survived, and it was never in-person
      specific. Left open deliberately: the item is smaller than it was, not
      done.

- [ ] **No analytics event marks a *saved* in-person attendance.**
      `inperson_attendance_logged` fired on a successful single-tap write and
      was removed 2026-08-05 with that flow. Its replacement,
      `inperson_attendance_started` (`app/components/InPersonPopup.tsx:402`),
      fires when the timer opens — so any funnel keyed on the old event reads
      zero from that date, and nothing distinguishes "opened the timer" from
      "actually saved a record." Deliberate for now: it matches the online
      precedent, where `SchedulePopup` fires `meeting_joined` at launch and
      likewise has no saved-attendance event. Worth fixing for both venues at
      once rather than adding a one-sided in-person event. Payload must stay
      empty either way — distance and accuracy must never ride along with an
      analytics event.

- [ ] **Stale doc comment in `app/db/meetingEvents.ts:16`.** The `MeetingEvent.reason`
      field's JSDoc says `/** Zoom end reason (e.g. "selfLeave", "endedByHost") */`.
      Neither string is emitted anywhere in the current codebase — the in-app
      Zoom SDK that produced them was removed in 4.5.0. The only two reason
      strings fired today are `"external-zoom-timer"`
      (`app/services/zoom/externalAttendance.ts`) and `"in-person"`
      (`app/services/inPerson/timerAttendance.ts:165` — added on this branch,
      moved there 2026-08-05 from the deleted `inPerson/attendance.ts`). Small,
      code-only fix (update the comment to name the current emitters) —
      left untouched here because this pass is docs-only and that file is
      source code, not a doc.

---

## ♿ App-wide accessibility sweep (JS-only — NOT runtimeVersion-gated)

VoiceOver / TalkBack support is a first-class concern in this repo — the
standard lives in `CONTRIBUTING.md` §Accessibility (`accessibilityRole`,
translated `accessibilityLabel`, `accessibilityHint` for non-obvious
actions, `accessibilityState` where it changes, `accessibilityActions`
over hidden buttons for multi-action rows). Coverage today is real but
uneven — 386 a11y props across 48 of 84 non-test `.tsx` files — so the
sweep is about closing the remaining holes, not starting from zero.

**Note for whoever picks this up:** the In-Person work is *not* the gap.
`InPersonScreen.tsx` (12), `InPersonScheduleRow.tsx` (9), and
`InPersonPopup.tsx` (7) all carry a11y props; the design plan
(`docs/superpowers/plans/2026-08-03-in-person-ui.md`) specified
`accessibilityViewIsModal` / `accessibilityRole="radio"` /
`accessibilityState` up front. The uncovered files are older surfaces.

- [x] **Audit files with interactive elements and zero a11y props.**
      **DONE 2026-08-04.** Covered in the first sweep pass:
      - `app/components/ScheduleGrid.tsx` — the worst of them, and now the only
        one with test coverage (`ScheduleGrid.test.tsx`). Cells compose
        "Monday, 7:00p, reminder on" from new `accessibility:` keys, the 24h
        sentinel is spelled out, hints distinguish create-vs-edit, and the
        empty spacers (5 of every 7 in a typical row) are hidden on both
        platforms. That test mocks `react-i18next` against the real `en`
        catalogue rather than using setup.ts's key-echo stub — see the header
        comment there before copying the pattern.
      - `app/screens/onboarding/ProgressDots.tsx` — tablist/tab with
        "Step N of 7" and selected state.
      - `app/screens/TermsScreen.tsx`, `app/screens/LicensesScreen.tsx` —
        labelled close button + header role.
      - `app/components/Toast.tsx` — the tappable variant is labelled. It
        already had `accessibilityLiveRegion` **and**
        `announceForAccessibility`; the original grep missed them because the
        pattern only looked for `Label|Role|Hint|State|accessible=`. Widen the
        pattern before trusting a future audit's file list.
      - `app/screens/ErrorScreen/ErrorDetails.tsx`,
        `app/components/agent/MeetingResultsCard.tsx` — header roles,
        decorative icons hidden.

      Confirmed *not* gaps despite scoring 0 — `HomeScreen`, `MeetingsScreen`,
      `ScheduleScreen`, `NewsCard`, `CollapsedResultBadge`,
      `ToolResultRenderer` have no touchables of their own; they compose
      children that are already labelled. Don't "fix" those. `app.tsx`'s two
      `onPress` hits are `Alert.alert` button configs, not components.

      Deliberately skipped as unreachable code, not as accepted debt:
      `app/screens/DevScreen.tsx` has **zero references anywhere in the app** —
      Ignite-era boilerplate. Give it a11y props if anything ever routes to it;
      better still, delete it.
      UPDATED 2026-08-09: this list used to name three files. `WelcomeScreen.tsx`
      and `EmptyState.tsx` were both deleted rather than given a11y props, along
      with their i18n blocks and images; `DevScreen.tsx` is what's left.

- [ ] **Not a11y, found during the sweep: `MeetingResultsCard.tsx` has a
      hardcoded English string.** `` `Showing ${n} of ${m} meetings` `` at the
      `hasMore` branch bypasses i18n entirely, so it stays English in all nine
      locales — and a screen reader in Spanish reads it in English. Left alone
      because the Agent tab is hard-disabled (`agentTabVisible = false` in
      `MainNavigator.tsx`), so it isn't user-reachable; fix it whenever that
      tab is turned on, along with a proper `agentScreen:` key.

- [ ] **Second pass: quality, not just presence.** Only 15
      `accessibilityHint`s exist app-wide against 173 labels, and several
      covered files score 1–2 (`Header.tsx`, `MaintenanceBanner.tsx`, the
      three `Toggle/` primitives). Check that labels are translated (`tx`
      keys, not hardcoded English), that `accessibilityState` tracks
      `disabled`/`selected`/`busy` where it changes, and that the
      maintenance banner announces itself.

- [ ] **Verify on device, both platforms.** VoiceOver (iOS) and TalkBack
      (Android). Add the check to `docs/PRODUCTION_CHECKLIST.md` if it
      isn't there. Any new i18n keys are a nine-file change (see
      CLAUDE.md §Internationalization). **Nothing from the 2026-08-04 pass has
      been heard on a real screen reader yet** — it's verified by `tsc`, eslint,
      and 8 jest assertions, which prove the props are present and correctly
      composed but say nothing about how VoiceOver actually reads them. The
      grid's per-cell labels are the ones to listen to first: seven columns of
      "Monday, 7:00p" may be correct and still be exhausting to swipe through,
      which only a device pass will tell you.

- [ ] **Translation review: 20 new `accessibility:` keys × 8 locales.** Added
      2026-08-04 (7 weekday names + grid/onboarding strings). Machine-assisted,
      structurally verified by `npm run compile` (the `Translations` type makes
      a missing key a hard error) but not semantically reviewed. Append to the
      existing queue in `docs/translation-review-2026-08-03.md`. Arabic
      `scheduleCell` interpolates a Latin-digit clock time into RTL text —
      same bidi caveat already flagged for `{{distance}}`, needs a device check.

---

## 🔑 Token freshness gate: deferred items (JS-only — NOT runtimeVersion-gated)

Follow-ups from the 2026-08-07 proactive JWT refresh work. None block that
change; all were surfaced by review and deliberately left out of its scope.
Design + manual checklist: `docs/superpowers/specs/2026-08-06-jwt-refresh-design.md`.

- [ ] **Manual verification on a production-profile physical device.** This is
      the one genuinely outstanding item, and nothing automated can substitute
      for it. `tokenFreshness.ts` and `installAuthGate` have no coverage by
      design (they import `@/`, which vitest can't resolve), and — more
      importantly — the whole `X-API-Key` fallback lane makes simulators
      structurally blind to device-credential bugs: `.env` supplies
      `EXPO_PUBLIC_AUTH_KEY` locally, but it is absent from `eas.json`, so
      production has no fallback at all. Confirm `/config` succeeds at cold
      start and that `log.warn("Request going out with no device credential")`
      never appears in Loki. Work the 8-item checklist in the design spec at
      the same time.

- [ ] **Outage-mode escape hatch leaves the device lane undecided.** The 60 s
      `/config` poll keeps running during outage, and `ConfigStore.fetchConfig`
      clears `outageMode` on any success with maintenance off. If `/config`
      ever succeeds while `/status` is still failing, outage clears *without*
      the recovery reload, `initializeDeviceAuthorization` never runs, and the
      device refresher returns null for the rest of the session. Needs a
      half-up server plus a credential `/config` accepts, so it is effectively
      dev-only — and it is **not** new: pre-gate, outage mode likewise never
      called `setApiKeyAuth()`. Cleanest fix is to decide the lane before the
      outage early-return rather than after.

- [ ] **`useAuth0Wrapper.ts` can still blank a stored refresh token.** Lines
      ~112 and ~129 pass `credentials.refreshToken ?? undefined` into
      `setTokens()` / `saveAuthCredentials()`, so a response that doesn't
      rotate a refresh token clears our copy — the same bug fixed in
      `tokenFreshness.ts` on 2026-08-07, on the SDK-sync path. Lower impact
      (that path reads the SDK's own stored credentials, which normally carry
      the token) but it makes `canRefresh` lie. Apply the same
      `?? authStore.refreshToken` treatment.

- [ ] **`AgentScreen.tsx` builds its own `Authorization` header outside the
      gate** (~lines 97-98), so the agent lane gets no proactive refresh — it
      inherits whatever the last gated call happened to write back. Harmless
      today because the Agent tab is hard-disabled behind a local `const`, but
      it must be routed through the gate (or handed the user refresher) before
      that tab ships.

- [ ] Report-send SUCCESS toasts in `app/hooks/useReportSender.ts`
      (`TOAST_LABELS`: "Report sent", "Report resent", "Report forwarded") are
      still hardcoded English; the failure toasts became tx keys on
      2026-09-10. Convert the rest the same way (nine-locale change).

---

## 📍 Settings → Permissions / location gate: deferred items (JS-only — NOT runtimeVersion-gated)

> Context: surfaced during the 2026-08-08/09 build of the Permissions section
> (spec `docs/superpowers/specs/2026-08-08-settings-permissions-section-design.md`).
> Everything below was found by review and deliberately deferred — none of it
> blocks the feature, and each entry says why.

- [x] **DONE 2026-08-08.** The Location toggle never self-corrects when the OS
      grant is revoked.
      There is no OS→store sync, unlike `notificationsEnabled` (which has one
      in `app.tsx:914-936`). With `locationEnabled` true and the OS permission
      revoked in device settings, the In-Person gate early-returns and Settings
      keeps showing the switch ON for a permission that is gone — the exact
      state D4 exists to prevent. **Not stranding anyone:** `useNearbySchedules`
      does not short-circuit while the toggle is on, so it calls the OS, gets
      denied with `canAskAgain: false`, and the banner routes to device
      settings. Only the Settings display is stale. Symptom worth knowing:
      `decideLocationGate` is never called with `locationEnabled: true` in
      production (the gate skips that case, and `SettingsScreen` hardcodes
      `false`), so two of its six vitest cases cover paths production cannot
      reach. Fix: extend the existing AppState resume listener.
      **Resolved:** `app.tsx`'s resume listener now also reads the location
      permission and clears `locationEnabled` when the grant is gone. The sync
      is revoke-only by design — auto-enabling on an OS grant would answer the
      gate's own in-app consent question on the user's behalf. The stale-vitest
      symptom noted above is now the opposite: `decideLocationGate` still is not
      reached with `locationEnabled: true`, because the store follows the OS
      down before the gate runs.

- [x] **DONE 2026-08-08.** Returning from device settings does not re-run the
      gate, and the
      comment at `app/screens/InPersonScreen.tsx:638-641` claims it does.
      `visible` is `activeSegment === "inperson"` (`MeetingsScreen.tsx:143`) and
      does not change on foreground resume, so a user who enables location in
      iOS/Android settings and comes back must switch segments to be picked up.
      Spec D5 promised this behaviour. **Same fix as the item above** — one
      AppState resume hook closes both — so land them together, and correct the
      comment in the same change.
      **Resolved:** `InPersonScreen` now carries its own resume listener that
      re-runs the gate while the segment is visible, and the false comment was
      replaced with a `CHANGED` note recording why it was wrong.

- [ ] **`app.tsx:923-926` re-opts non-premium users into push on every
      foreground resume**, unconditionally. Pre-existing, but it now interacts
      badly with the premium gate on the Permissions row: a non-premium user
      cannot turn push off in-app (every tap opens the paywall), and this path
      can re-enable it behind them. Worth its own look.

- [ ] **Native-speaker pass on nine new translation strings.** The a11y fix
      shipped real (machine) translations for `accessibility:doubleTapToUpgrade`
      in all nine locales rather than the English placeholders the plan called
      for. Eight are unverified.

- [x] **PARTLY DONE 2026-08-08.** `showLocationDeniedAlert` / `runGate` have no
      re-entrancy guard. Rapid repeat taps can stack dialogs. Low impact; noted
      so it is not rediscovered.
      **Resolved for `runGate`:** the AppState resume work made this
      load-bearing rather than cosmetic — a revoke fires the gate from two
      directions on one resume — so `useLocationGate` now shares an in-flight
      promise instead of starting a second run. Guard is per hook instance, so
      it dedupes within a screen, not across `SettingsScreen` and
      `InPersonScreen` (which cannot both be mounted and interactive anyway).
      **Still open for `showLocationDeniedAlert`**, which is a plain function
      with no instance to hang state off; repeat taps on the Settings toggle can
      still stack its dialog.

- [ ] **`$lastRow` in `PermissionsSection.tsx:150` is a no-op** — `$settingsRow`
      carries no bottom border, so the modifier does nothing. Harmless, copied
      verbatim from `SettingsScreen.tsx`'s section chrome.

- [ ] **Spec defect for the record: D6's premise is stale.** It describes
      removing the day-browse fallback, but that fallback was already removed
      on 2026-08-04 (`app/utils/nearbyLogic.ts:24-28`). The consequence is that
      this feature **inherits** the App Store 5.1.1 exposure (gating in-person
      listings on a permission they don't strictly need) rather than
      introducing it. If a 5.1.1 rejection ever lands, the spec's own smallest
      reversal still applies: D7 → prompt once per app launch instead of every
      segment entry.

- [ ] **Device-only QA not yet run:** VoiceOver/TalkBack on the non-premium
      push row (confirm focus lands on the row and reaches the paywall, not on
      the a11y-hidden switch), plus the full permission matrix in
      `docs/superpowers/plans/2026-08-08-settings-permissions-section.md`
      → "Manual verification (device only)". Neither test runner can produce
      real OS permission states.

---

## 💳 RevenueCat `$email` backfill for dormant customers (API-repo script — NOT an app change)

Queued 2026-09-14. Part 1 shipped the same day: the app sets the `$email`
subscriber attribute whenever RevenueCat is identified as a signed-in Auth0
user (`app/services/purchases/emailAttributeLogic.ts`), which backfills
anyone who opens the app again. It does nothing for lapsed subscribers,
refunds in progress, or uninstalls — the customers support actually gets
asked about. Part 2 is a one-off, operator-run script that fills those in.

Spec: `api/docs/superpowers/specs/2026-09-14-revenuecat-email-backfill-script-design.md`.
Home: `api/scripts/backfill-rc-email.ts`. Dry run is the default; `--apply`
writes; `--limit 5` gates the first real batch; a JSONL ledger makes it
resumable. Starts from the RevenueCat customer export, never from the Auth0
user list — RevenueCat's write endpoints create customers that don't exist,
so iterating Auth0 would mint a phantom customer per non-subscriber.

**Blocked on two credentials (both need the Auth0 tenant, MFA lockout as of
2026-09-14):**

- [ ] Grant `read:users` to the existing M2M app (`AUTH_MGMT_CLIENT_ID`). It
      has only `update:users` today, which `POST /auth0/profile` uses.
- [ ] Create a RevenueCat **secret** API key (`sk_…`) and add it to the API
      `.env` as `REVENUECAT_SECRET_KEY`. Script-only — deliberately NOT in the
      server's `config` schema, so the running API never holds a key that can
      rewrite customer attributes.

**Built 2026-09-16 (API commit `aecf2b8`), waiting only on the credentials:**

- [x] Extract the Auth0 Management token grant + retrying `fetch` from
      `api/src/routes/auth0.ts` into `api/src/services/auth0Management.ts`
      so the route and the script share one implementation (route tests stay
      green). Adds `getUser(sub)` and `decodeScopes()`.
- [x] Pure `scripts/lib/backfillRcEmailLogic.ts` (id classification, CSV
      reader, email redaction, outcome decision, resume rule, argv) with 17
      vitest cases, plus `scripts/lib/backfillRcEmail.ts` — the loop with
      injected Auth0/RC clients and 7 end-to-end tests (dry run makes zero RC
      calls, 429 waits, 5xx retry, resume). `npm run backfill:rc-email`;
      `npm run typecheck:scripts`.
- [x] Live smoke: the script stops itself with `token lacks "read:users"
      (has: update:users)` — it reports the blocker above by itself.
- [ ] Run the runbook (a dry run needs only `read:users`; `--apply` also
      needs `REVENUECAT_SECRET_KEY`): dry run → `--apply --limit 5` → dashboard spot-check →
      full `--apply --resume` → dry run again shows nothing pending.
- [ ] Confirm support can find a customer by email in the RevenueCat
      dashboard, then delete the exported CSV.

---

## 🧹 Remove the device-id login path (device id as a user identity)

DONE 2026-10-11 on `feat/guest-mode` (spec `docs/superpowers/specs/2026-09-27-guest-mode-design.md`).

Jenova's direction, 2026-09-17: the device id must not be used as a *user
identity* anywhere. Anonymous sign-in was disabled about a month after launch
(Android only; iOS never had it), yet the code paths remain and keep producing
device-id "users": `loginAnonymously()` (`AuthenticationStore.ts`, stores the
device id in `userId` with `isAnonymous = true`), the `userIdentifier` getter
(`userId ?? deviceId`), `LoginScreen`'s `type === "anonymous"` branch, and the
`useAuth0Wrapper.ts:326` fallback. 15 files reference `isAnonymous` /
`loginAnonymously` / `userIdentifier`.

Two consumers were already fixed to ignore the device identity:
RevenueCat (`884a4a2`, spec `2026-09-17-revenuecat-identity-reactive-design.md`)
and push-token registration (`072aa6a`). The remaining readers (sync `gate()`,
report polling's `uid`, `useCloudBackupPrompt`, `BackupPassRunner`,
`AppNavigator`'s `isAuthenticated`, tracking's `setTrackingUserId`) each need
a decision: "signed-in Auth0 user or nothing".

Keep `deviceId` itself — attestation, the logger's `deviceId` attribute, and
`getDeviceId()` are legitimate *device* identity, not user identity.

- [x] Inventory each reader of the old login's flag and of the identity getter
      that fell back to the device id, and decide its signed-out behaviour:
      signed-in Auth0 user or nothing.
- [x] Remove the old login's store action, the LoginScreen branch and the
      wrapper fallback; delete the identity getter.
- [x] `isAuthenticated` stops counting the old login as signed in; the
      navigator still routes signed-out users to Login.
- [x] Migration for installs still in the old login's state: the device id left
      in `userId` is cleared on hydration (`legacyIdentityLogic.ts`) and MST
      ignores the old flag in the stored snapshot, so they open on Login,
      signed out.

---

## 📖 Finish the user's manual (`docs/manual/`) — docs-only, NOT runtimeVersion-gated

Queued 2026-10-12, updated 2026-10-13. Spec:
`docs/superpowers/specs/2026-10-12-user-manual-rag-design.md` (the layout in
§1.1, the per-area writing process in §4, the roadmap in §5). Sub-project 0,
the **skeleton**, is merged into app `root` (50e24f2) and agent `prod`
(8062fda), both 2026-10-13, neither pushed, the agent untagged, see "Ship the
agent half" below. Plan:
`docs/superpowers/plans/2026-10-12-user-manual-skeleton.md`. The pipeline was
proven end to end on a local Docker Qdrant + pgvector: Sky answered 9 of 10
checklist questions, every answer through `searchManual`.

**Where the writing stands (2026-10-13):**

| | Written | Planned (spec §1.1) |
| --- | --- | --- |
| Pages | 5 | 57 |
| Directories (the `area` values) | 1 of 10: `backup-and-devices/` | 10 |
| Roadmap areas (spec §5) | 0 of 5 | 5 |
| Words | 4,246 in 30 sections | 25–35k |
| `questions.yml` entries | 16 | ≥ 3 per page, so ≥ 171 |
| `map.md` | 510 words | "about 350, never more than 600" |

So today Sky can answer backup and multi-device questions and nothing else
about the app; **52 pages are unwritten**. What exists besides the pages: the
authoring rules (`docs/manual/README.md`), the map Sky carries in her prompt
(`map.md`) and `questions.yml`. Each area is a bounded sub-project with a
brief, not a spec (spec §4): brief → write from the named sources only →
fact-check by a DIFFERENT reader → at least three `questions.yml` entries per
page → `pnpm --dir ../agent manual:ingest ../app/docs/manual --dry-run` →
commit → ingest → CLI checklist. An invented setting in a RAG corpus is worse
than a missing page, because Sky repeats it with confidence.

**Ship the agent half (Jenova's call):**

- [x] App: `feat/user-manual` merged into `root` as 50e24f2 (2026-10-13).
      Pushing `root` is a separate decision.
- [x] Agent: `feat/manual-rag` merged into `prod` as 8062fda (2026-10-13).
      `prod` had moved to v0.8.0 (mem0) under the branch; the eight conflicts
      were resolved on the branch first (0c0268f), suite 134 files / 2,299
      tests green, stub-mode boot clean. Not pushed, not tagged: until a `v*`
      tag ships the image, Sky has no `searchManual`. Three small items were
      parked in the final review and ride with the code, not against it: the
      plan names a `packages/manual/README.md` that no task creates (agent
      `CLAUDE.md` "App Manual" covers it); every ingest inserts a `manual-map`
      history row even when the map is byte-identical (spec §3 says insert; a
      skip is a behaviour change); and the store's warn-vs-error split for a
      missing collection has no direct store test (the tools path is tested).
- [ ] Push app `root` and agent `prod`, then tag the agent (`v*`) so CI builds
      the image and runs `swarm up services agent`.
- [x] Build the `manual` collection: done 2026-10-13 (run
      `2026-10-13T19:36:43Z-079e`, manualVersion `v4.11.0-4-15-g15cb3a2`):
      35 points embedded, `manual-map` row replaced, 16 of 16 questions
      retrieve their page. **There is no dev Qdrant and no dev agent
      database.** The one Qdrant is production: `databases_qdrant` on
      enheduanna, reachable from a Mac as `http://qdrant.rso` (Caddy, port
      80) or `http://enheduanna.prod.rso:6333`; it needs `QDRANT_API_KEY`
      (Infisical `app-secrets:Qdrant/JSON`). `db.rso` resolves to enheduanna
      too, so the agent root `.env`'s `DATABASE_URL` (database `agent`) is the
      production agent database. Both variables now live in the agent root
      `.env`, so the release step is just, from the agent repo:
      `pnpm manual:ingest ../app/docs/manual --yes` (`--yes` because neither
      target is localhost). The first run failed: the Qdrant client dials
      6333 for any URL without an explicit port, fixed in agent 6e742a4
      (`createQdrantClient` passes the URL's port itself). To rehearse without
      touching production, the plan's Task 14 recipe (Docker `qdrant/qdrant`
      on 127.0.0.1:6333 + pgvector, a scratch migrator, blank `REDIS_*`) still
      works and needs no `--yes`.
- [ ] Production Qdrant has no `literature` collection (2026-10-13 listing:
      `agent_memories`, `mem0migrations`, `memory_migrations`, `messages`,
      the siri/ninshubur ones, now `manual`), so the agent's literature
      semantic search boot check must be logging "unusable" in production.
      Agent-side: confirm in the service logs and either run the literature
      ingest or drop the check. Also: the Qdrant JS client is 1.18.0 against
      server 1.16.3 and prints a compatibility warning on every client
      creation; calls work.

**Then the areas, in the spec's order (§5). Page names are the file names Sky
sees as `page`, and `questions.yml` must follow them:**

- [ ] **Area 1 — Getting started & account** (17 pages, highest support load).
      `getting-started/`: install-and-zoom, sign-in, guest-mode, onboarding,
      import-from-old-app. `account/`: wrong-account, verify-email,
      mistyped-email, email-change-not-showing, empty-account,
      forgot-password-or-old-app, signed-out, only-meetings-showing,
      sign-in-hangs, delete-account, code-not-arriving, code-rejected (one per
      `docs/support/problems/`; "data missing after new phone" maps to
      `backup-and-devices/new-phone` instead). Grown from `docs/support/replies/`
      and `reference/`; afterwards `replies/` become pointers into the manual
      (spec D7) and `docs/support/README.md` says so.
- [ ] **Area 2 — Meetings** (10 pages, the core). `meetings/`: online, starts-in,
      in-person, map-view, search, filters, favorites-and-ratings, reminders,
      meeting-details, joining-with-zoom. Sources: the filter-bar + Starts In
      spec, the In-Person specs, `MeetingRow`, `SchedulePopup` / `InPersonPopup`.
      Starts In is `__DEV__`-only today (`startsInVisible` in `LiveScreen.tsx`),
      so rule 6 (no roadmap) decides whether it gets a page at all.
- [ ] **Area 3 — Attendance** (6 pages). `attendance/`: tracking, timer, im-here,
      editing-and-archive, reports, certificate. Sources:
      `docs/MEETING_ATTENDANCE_FLOW.md`, `useReportSender` (the four send
      operations), `useAttendanceTimer`, `usePresenceCheck`.
- [ ] **Area 4 — Settings, subscription, privacy** (10 pages). `settings/`:
      profile, recovery, attendance, app-settings, subscription, cloud-backup,
      permissions, account, legal-and-support; `privacy/your-data`. Tiers
      verified row by row against `useSubscription` consumers.
      `settings/cloud-backup` describes the row and its statuses;
      `backup-and-devices/cloud-backup` describes the feature; each names the
      other by title. Settle here (spec §8): whether the 90-in-90 certificate
      needs the Attendance subscription, and whether the Community tab is
      mentioned at all (hidden behind a constant; rule 6 says no).
- [ ] **Area 5 — Home, Sky, status** (9 pages). `home/`: clean-time,
      money-saved, recovery-chart, ninety-in-ninety, tips-and-news;
      `sky/about-sky`; `status/`: offline-and-maintenance, updates,
      platform-differences. The Home card copy that says attendance is tracked
      "automatically" is wrong; the manual describes the timer.
- [ ] After each area: the spec §6 hand checklist through the CLI (against the
      local rehearsal stack, or production once the area is ingested), read for
      invented details, and `map.md` re-verified against the new pages. It is
      510 words today against the README's "about 350, never more than 600",
      so new areas add lines to it, not paragraphs.

**Open questions the first areas will hit (the answers belong in the pages):**

- [ ] Does the Premium product also grant the `recoverysky-attendance`
      entitlement? The backup pages and the map say Cloud Backup needs the
      "Attendance" subscription, which is what the code gates on
      (`revenueCatService.ts`); if Premium carries it too, one sentence per
      page says so. RevenueCat dashboard config, not code.
- [ ] Does a reminder's push reach a second signed-in device? Server behaviour
      (`useReminders.ts` POSTs every reminder with the device id); the pages
      claim only that a reminder shows where it was set.

**Follow-ups, each its own small piece of work (spec §5 + the final review):**

- [ ] `AgentScreen` sends `{ timezone, fellowship }` in the chat body; add
      `platform` and `appVersion` (JS-only here; a zod field and a prompt line
      in the agent) so Sky pre-filters by platform and stops asking "iPhone or
      Android?".
- [ ] `docs/manual/README.md` does not state the same-commit rule (CLAUDE.md
      "User's Manual" does); add it so the README is complete on its own.
- [ ] The stacks comment on `databases_qdrant` says it is reachable as
      `qdrant.rso:6333`; it is not (6333 is published on enheduanna only, and
      `qdrant.rso` is the Caddy ingress on port 80). Fix the comment in
      `stacks/databases/stack.yml`.
- [ ] Forgejo-triggered ingest, if running it by hand gets old. Until then it is
      a release step: after any release that touched `docs/manual/`, the ingest
      command above from the agent repo (CLAUDE.md "Releasing" says "the
      production `.env`"; in practice that is the root `.env` plus
      `QDRANT_URL` and `QDRANT_API_KEY` on the command line).
- [ ] LLM-judged manual evals on the agent-evals harness ("uses on-screen
      labels", "invents nothing").
- [ ] Before the Agent tab returns to production users, the two app-side
      blockers already listed above still stand: `AgentScreen`'s own
      `Authorization` header outside the token gate (see "Token freshness gate")
      and the hardcoded English string in `MeetingResultsCard` (see "App-wide
      accessibility sweep").

---

## ⚙️ Release checklist reminders

- [ ] Bump `version` **and** `runtimeVersion` in `app.json` together (native change).
- [ ] Add CHANGELOG.md entries under `[Unreleased]` before opening the PR.
- [ ] `bump-version.sh` resets the `package.json` `update` field to `"0"` —
      verify the OTA counter restarts cleanly.

### 🍎 Floor the pods' resource-bundle deployment targets, then drop the EAS image pin

Queued 2026-11-05 by the 4.12.0 release. EAS's `latest` iOS image is Xcode 27.1 now, and
Xcode 27 makes "The iOS deployment target 'IPHONEOS_DEPLOYMENT_TARGET' is set to 11.0, but
the range of supported deployment target versions is 15.0 to 27.1.x" an error instead of
a warning. It fires for the resource-bundle targets CocoaPods generates beside each pod:
`Auth0-Auth0`, `PurchasesHybridCommon-PurchasesHybridCommon`, `ReachabilitySwift-ReachabilitySwift`, `RevenueCat-RevenueCat`, `RevenueCatUI-RevenueCat_RevenueCatUI`, `Sentry-Sentry`.
React Native's `react_native_post_install` floors every pod's own target to 15.1
(`ReactNativePodsUtils.updateOSDeploymentTarget`, `node_modules/react-native/scripts/cocoapods/utils.rb`)
but iterates `native_target` only, never `resource_bundle_targets`. 4.12.0 ships with
`build.production.ios.image` pinned to `macos-tahoe-26.5-xcode-26.6` in `eas.json` instead
(the October 4.11.0 build ran on that Xcode 26 generation and only warned).

- [ ] A local config plugin (`plugins/withPodResourceBundleDeploymentTarget.ts`, `withDangerousMod`
      on `ios/Podfile`, inserted into `post_install`) that sets each resource bundle's
      `IPHONEOS_DEPLOYMENT_TARGET` to the Podfile platform (`15.1`) when it is lower. Plugin edits
      are native-shape changes: `npm run prebuild:clean`, then confirm with
      `xcodebuild -project ios/Pods/Pods.xcodeproj -target Sentry-Sentry -showBuildSettings | grep IPHONEOS_DEPLOYMENT_TARGET`.
- [ ] Put the image back to `latest` (or the matching `sdk-NN` alias) and build once on an Xcode 27
      image before tagging the next native release.
- [ ] EAS docs, read 2026-11-05: apps built on Xcode 27 images launch on iOS 27 only with the UIKit
      scene life cycle (`ios.enableSceneSupport` in expo-build-properties, SDK 57+), so moving to
      Xcode 27 is coupled to the Expo SDK upgrade, not a standalone image bump.
