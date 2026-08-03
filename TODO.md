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

- [ ] **Premium-gate `returnTo` round-trip is broken for in-person meetings.**
      `InPersonPopup` sends `returnTo: "Meetings:meetingId:<id>"` (copied
      verbatim from `SchedulePopup`, per the plan) → `SettingsScreen.navigateReturn()`
      hardcodes `segment: "live"` → `MeetingsScreen` force-routes to Live
      whenever a `meetingId` route param is present → `LiveScreen` deliberately
      drops in-person records (commit `16344c5`). Net effect: a user pays at
      the paywall, gets bounced to the wrong segment, no popup reopens, and the
      reminder they were trying to create was never created. Ruled **defer**.
      Full analysis and three fix options:
      `.superpowers/sdd/2026-08-03-in-person-ui/task-10-report.md` → "Question 2".

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

---

## ⚙️ Release checklist reminders

- [ ] Bump `version` **and** `runtimeVersion` in `app.json` together (native change).
- [ ] Add CHANGELOG.md entries under `[Unreleased]` before opening the PR.
- [ ] `bump-version.sh` resets the `package.json` `update` field to `"0"` —
      verify the OTA counter restarts cleanly.
