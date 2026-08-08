# In-Person Map View — Release-Time Manual QA Checklist

This is the durable home for the map view's device-only QA items — none of
these can be verified by `npm run compile` / `lint:check` / `lint:deps` /
`npm test`. They were scattered across per-task review files
(`task-7-review.md`, `task-8-review.md`) that get deleted; this file is where
they live from now on.

**Run the full checklist on physical hardware, on both iOS and Android, in
both light and dark theme, before the native release that ships this
feature** (see `CLAUDE.md` → "Runtime Version & OTA Updates" — this feature
requires a `runtimeVersion` bump and a store build; a simulator/emulator pass
is not a substitute for the on-device items below, particularly the location
and native-bridge ones).

---

## ⚠️ Highest priority: `cluster_id` bridge type on Android

**Before anything else, confirm cluster taps work on a physical Android
device.** `InPersonMapView.tsx`'s cluster-expansion path calls
`getClusterExpansionZoom(clusterId: number)` behind a guard that requires
`typeof clusterId === "number"`. If Android's native bridge hands
`properties.cluster_id` across as a **string** instead of a `number` (a real
risk — RN bridge serialization has done this before with GeoJSON feature
properties), the guard fails silently: the tap does nothing, no error, no
crash, just a dead cluster. This is exactly the kind of platform-only bug
that no simulator run or `tsc` pass will ever catch, and it's the single
riskiest unverified line in the feature. Test on Android specifically, not
just iOS — see "Clustering" below for the full check.

---

## Toggle visibility & gating

- [ ] Toggle appears only when `/config` serves **both** `MAP_STYLE_URL_LIGHT`
      and `MAP_STYLE_URL_DARK`; hidden entirely on the web build (list-only,
      no toggle, no crash).
- [ ] Kill switch: clear both style-URL fields server-side → toggle
      disappears on next `/config` fetch; if the user had a persisted `"map"`
      view-mode preference, they land on the list, not a blank screen.
- [ ] Cold-start segment-activation gate: with a persisted `inperson.viewMode
      = "map"` and both style URLs served, cold-start the app and open the
      Meetings tab but **stay on Live** (don't tap In-Person). Confirm no
      MapTiler tile requests appear in a proxy/network log, no location
      permission prompt fires, and no location indicator lights up (iOS
      status bar / Android quick-settings) while the In-Person segment has
      never been opened. This regression-checks a fixed bug (the map used to
      mount inside a `display:none` segment on every relaunch after a user's
      first map toggle) — confirm the fix holds, i.e. silence until the
      In-Person segment is actually opened.
- [ ] Segment-switch unmount (the post-activation half of the same bug, fixed
      2026-08-08): open In-Person, toggle to map, then switch to the Live or
      Search segment — and separately, to another tab. Confirm the location
      indicator goes **out** and MapTiler tile requests stop, i.e. the GL
      surface actually unmounted rather than living on inside a `display:none`
      view for the rest of the session. Switching back to In-Person must
      restore the map (remounted, re-fitted) with the toggle still on "map",
      and the list's day/radius/fellowship state must be unchanged by the
      round trip — only the map subtree unmounts.

## Accessibility

- [ ] Toggle a11y: VoiceOver (iOS) and TalkBack (Android) read "Show map" /
      "Show list" correctly for the control's current state.
- [ ] Toggle disabled state (offline) is announced by the screen reader, not
      just shown visually greyed out.
- [ ] Map a11y label follows a language change: with the map open, change the
      app language in Settings, come back, and confirm the screen reader reads
      the map's orienting label in the NEW language without needing the map to
      be toggled off and on (fixed 2026-08-08 — it used to be captured at
      render time by the imperative `translate()`).

## Theming

- [ ] Map renders the themed style matching the app's current theme (light
      style in light mode, dark style in dark mode).
- [ ] Switching the app theme while the map is open swaps the rendered style.
- [ ] Dark-mode style-URL selection: with the app in dark mode via **both**
      "follow system" and an explicit in-app dark override (if the theme
      picker offers one), confirm the *dark* tiles actually render — i.e.
      the theme-context value driving style-URL selection reports "dark" in
      both cases, not just the system-follow path.

## Camera behavior

- [ ] Nearby mode (location granted, fix obtained): camera fits the active
      search radius around the user; the native location puck is visible.
- [ ] Fallback mode (location denied or fix failed): camera fits the result
      pins instead; no puck is shown.
- [ ] Location permission denied path specifically on iOS: confirm the map
      mounts cleanly and the puck is simply absent — no permission prompt,
      no error state. (Android is code-guarded to check permission before
      mounting the location layer; iOS needs the same behavior confirmed by
      hand.)
- [ ] Zero results and no location fix: camera falls back to a
      continent-level default view rather than an empty/blank close-up.
- [ ] Persisted-map cold start (fixed 2026-08-08): with `inperson.viewMode =
      "map"` already persisted and location permission already granted,
      cold-start the app and tap In-Person. The camera must settle on the
      search radius around the user once the fix lands — NOT sit at the
      continent-level default with the meetings in one tiny cluster. (The map
      mounts before the fix exists, so this is the deferred one-shot fit
      doing its job; the fallback view is only ever the starting frame.)
- [ ] Camera does not refit when results change under a panned map: toggle to
      map, wait for the initial fit to land, pan/zoom away from it, let a
      background refresh land new data, and confirm the camera stays where the
      user left it (it fits exactly once per mount, by design — the one-shot
      latch must not re-arm on data changes).
- [ ] Radius / day / fellowship / time-of-day filter changes while already in
      map mode update the rendered pins in place; the camera position is
      unaffected by the filter change.

## Clustering

- [ ] Cluster tap expands the cluster (zooms in until the underlying pins
      separate) on **both** iOS and Android — this is the check for the
      highest-priority `cluster_id` risk called out at the top of this file.
      Do not skip the Android pass.
- [ ] Cluster count text and multi-meeting-venue count text actually render
      visible numbers, not blank bubbles — the symbol layers don't pin a
      `text-font`, so they depend on the configured MapTiler style serving a
      compatible default glyph stack. If bubbles render but are blank, that's
      a real defect to file (fix: set an explicit `text-font` matching what
      the style's glyph endpoint serves).

## Pins, popups, and the venue chooser

- [ ] Single-meeting pin tap opens `InPersonPopup` for the correct meeting.
- [ ] Multi-meeting venue: the pin shows the correct count; tapping it opens
      the venue chooser, and picking a row opens that row's own popup with
      the right meeting (confirms `properties.ids` round-trips correctly as
      the joined-string format the pure logic module emits).
- [ ] Chooser → popup handoff on a physical iPhone specifically: tapping a
      row in the chooser dismisses the chooser modal and presents
      `InPersonPopup` in the same interaction. iOS has a known
      dismiss-then-present modal race; confirm the popup actually appears
      rather than silently failing to present.
- [ ] Chooser overflow: find or seed a venue with 8+ same-day meetings (a
      single clubhouse address is the realistic case) and open its pin.
      Confirm every row is reachable — scrollable, not clipped or drawn
      outside the card.
- [ ] Approximate venue renders as a translucent circle/area, never a precise
      pin — check this at several zoom levels, since the circle's radius is
      fixed in screen pixels and can visually shrink toward a point at high
      zoom. Confirm it still reads as "an area" rather than "a pin" even
      zoomed in.

## Network resilience

- [ ] Map-load failure: point the style URL at a 404 or otherwise-broken URL
      (e.g. on a dev server) and confirm the app shows the "map unavailable"
      toast and automatically flips back to the list view, with the toggle
      still present so the user can retry.
- [ ] Map-load failure does NOT destroy the saved preference (fixed
      2026-08-08): after the failure above, fix the style URL and tap the
      toggle back to map — it must actually re-enter map mode, not no-op.
      Then, separately, trigger the failure again and cold-restart the app
      **without** tapping the toggle: the user must come back on the *map*,
      because a transient tile/style failure is session-only and never
      rewrites `inperson.viewMode` in MMKV.
- [ ] Airplane mode while already on the map: the toggle stays tappable and
      switches back to the list on tap (it is not disabled while already in
      map mode, only when *entering* it offline).
- [ ] Airplane mode while on the list: the toggle greys out and announces
      "Map is unavailable offline" (screen reader check, not just visual).
- [ ] Re-enabling network after airplane mode: the toggle re-enables without
      needing an app restart.

## Persistence

- [ ] View-mode preference (list vs. map) survives a full app restart/cold
      start — reopening the app returns to whichever mode was active when
      the app was last closed, subject to the kill-switch and
      segment-activation gates above.

---

## Notes for whoever runs this

- Several items above ("cold-start segment-activation gate", "chooser
  overflow", "airplane mode while already on the map") are regression checks
  for bugs that were found and fixed during implementation review — they're
  included so a future change to this code can't silently reopen them.
- "Toggling list → map → list refits the camera every time (losing any pan/
  zoom you had)" is expected behavior, not a bug — the camera is fit once at
  mount and not re-derived. Don't file it; just confirm it still feels
  acceptable before release.
