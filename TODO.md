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

- [ ] **Translation review queue is a release blocker.** 133 machine-assisted
      strings across seven locales (ar/de/fr/pt/ru/th/uk) await a
      native-speaker pass before this ships — 70 in `inPersonPopup`, 63 in
      `inPersonScreen`. Full list: `docs/translation-review-2026-08-03.md`.
      Structure is already machine-verified (identical key sets across all
      nine locales, every interpolation placeholder present); what's missing
      is a semantics/register check. Flag for the reviewer: Arabic embeds
      `{{distance}}` inside RTL text with Latin numerals and needs checking
      on device. Also tracked in `docs/PRODUCTION_CHECKLIST.md`.

- [ ] **A `markProcessed` failure gets reported to the user as success on the
      next tap.** In `saveInPersonAttendance` (`app/services/inPerson/attendance.ts`)
      the `create` lands before `markProcessed` is attempted, so if all four
      `markProcessed` attempts fail, the function returns `{ ok: false }` — but
      the created row is still there. `hasLoggedToday` only looks at `created`,
      so the user's next tap short-circuits to `{ ok: true, alreadyLogged: true }`
      and `InPersonPopup` shows "Attendance saved" for a record stuck in exactly
      the created-but-unprocessed state the retry comment at
      `attendance.ts:106-108` calls "orphaned" and "can't see or recover". The
      second tap also fires `trackEvent("inperson_attendance_logged")` for a
      write that never completed, so that metric can over-count relative to
      processed records. Not a regression: `saveTimerAttendance` in
      `app/services/zoom/externalAttendance.ts` has the same create-then-process
      shape, so this is a house pattern and any fix should cover both. Likely
      fix is to have the same-day guard require a *processed* record, or to have
      a resumer re-drive `markProcessed` on orphans at launch.

- [ ] **Stale doc comment in `app/db/meetingEvents.ts:16`.** The `MeetingEvent.reason`
      field's JSDoc says `/** Zoom end reason (e.g. "selfLeave", "endedByHost") */`.
      Neither string is emitted anywhere in the current codebase — the in-app
      Zoom SDK that produced them was removed in 4.5.0. The only two reason
      strings fired today are `"external-zoom-timer"`
      (`app/services/zoom/externalAttendance.ts`) and `"in-person"`
      (`app/services/inPerson/attendance.ts`, added on this branch). Small,
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
      `app/components/EmptyState.tsx` and `app/screens/WelcomeScreen.tsx` have
      **zero references anywhere in the app** — Ignite boilerplate, same
      status as `DevScreen.tsx`. Give them a11y props if anything ever routes
      to them; better still, delete all three.

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

## ⚙️ Release checklist reminders

- [ ] Bump `version` **and** `runtimeVersion` in `app.json` together (native change).
- [ ] Add CHANGELOG.md entries under `[Unreleased]` before opening the PR.
- [ ] `bump-version.sh` resets the `package.json` `update` field to `"0"` —
      verify the OTA counter restarts cleanly.
