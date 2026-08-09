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

## ⚙️ Release checklist reminders

- [ ] Bump `version` **and** `runtimeVersion` in `app.json` together (native change).
- [ ] Add CHANGELOG.md entries under `[Unreleased]` before opening the PR.
- [ ] `bump-version.sh` resets the `package.json` `update` field to `"0"` —
      verify the OTA counter restarts cleanly.
