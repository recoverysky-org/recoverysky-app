# In-Person Meetings: Map Surface — Design Spec

**Date:** 2026-08-03
**Status:** SUPERSEDED by `2026-08-07-in-person-map-view-design.md`
(2026-08-07). The browse map was approved with MapLibre + MapTiler; this
draft's still-valid requirements (approximate-venue circles, deep-link
retention, key handling, New Arch gate) were carried into that spec — do
not implement from this document.
Original status: Draft — not approved. Written as a follow-on to the
In-Person UI release; nothing here is scheduled.
**Scope:** Add map rendering to the in-person meeting experience, in two
phases with an explicit decision point between them. Native release — see
Release Path.

## Background

The In-Person UI release (`docs/superpowers/specs/2026-08-03-in-person-ui-design.md`)
shipped list-only by decision #3: "No map. Get Directions deep-links to the
platform maps app — no `react-native-maps` dependency. The map surface
(`/meetings/nearby` pins) is a deferred follow-up." Its "Out of scope"
section names this spec's subject as "next release."

Two things are already in place for it:

- **`GET /meetings/nearby`** exists on the API (v0.6.0, in-person serving
  branch): flat, nearest-first, `iso_dow` **optional** — deliberately shaped
  as the map surface, unlike `/schedules/nearby` which requires a day. It is
  unused by the app today.
- Every in-person meeting already carries `latitude`, `longitude`, and an
  `approximate` boolean on the wire (data layer, 2026-08-02). The UI release
  surfaces `approximate` as a caveat line in `InPersonPopup`.

The deep-link-to-native-maps flow (`buildDirectionsUrl` in `nearbyLogic.ts`)
stays regardless. It is the better UX for actually navigating, it costs
nothing, and it works on web. A map is for *seeing where a meeting is*, not
for getting there.

## The decision that actually matters

The library choice is downstream of one question: **does a third party get to
see where the user is browsing for recovery meetings?**

On a map screen the viewport *is* location data. Rendering through Google's
Android SDK sends tile requests to Google, tied to an API key that identifies
this app specifically. For a recovery app that is a meaningfully different
disclosure than an address rendered as text — and it sits oddly beside the
work already done to keep coordinates off every other wire (see the Sentry
`lat`/`lon` breadcrumb scrub in `app/services/crashReporting/sentry.ts`, and
the swallowed `Linking.openURL` rejections in `InPersonPopup`, whose RN error
message embeds the URL).

This spec does not resolve that tension by picking a "private" library. It
resolves it by **scoping what the map shows**, which changes the exposure
profile far more than the vendor does:

- **A pin for a meeting the user already tapped** discloses a venue address —
  which is public information the API already serves — centred on a place the
  user chose. It does not disclose where the *user* is.
- **A browse map centred on the user's position** discloses approximately
  where the user is standing, continuously, as they pan. That is the thing
  the rest of the app is careful not to emit.

Those are different products with different privacy costs, so they are
different phases with a decision point between them.

## Decisions

1. **Provider split: Apple Maps on iOS, Google Maps on Android.** This is
   `react-native-maps`' `PROVIDER_DEFAULT` — the library's default, not a
   configuration. Apple MapKit on iOS needs no API key, no billing account,
   and no GCP project, and Apple's stated design uses rotating identifiers
   rather than account-linked ones. Android has no native Apple option, so
   Google is the only non-OSS path there.

2. **`react-native-maps`, not MapLibre, not `expo-maps`.** MapLibre +
   self-hosted Protomaps tiles is the only option where no third party learns
   anything, and it is genuinely better on web — but it is a tile-hosting
   project (extract pipeline, CDN, styling), not a dependency. That cost is
   not justified by Phase 1, whose viewport does not reveal the user. Revisit
   it if and only if Phase 2 is approved. `expo-maps` is the natural
   Expo-native answer but is believed still alpha — see Verification Gates.

3. **Phase 1 — single pin inside `InPersonPopup`.** A short, fixed-height
   map above or below the venue block, showing one marker for the selected
   meeting. No user-location dot, no panning to arbitrary places, no
   clustering, **no new API endpoint** — the popup already holds the
   meeting's `latitude`/`longitude`. Tapping the map is a second entry point
   to the existing `handleDirections` deep-link.

4. **Phase 2 — map browse mode, conditional and separately approved.** A
   map alternative to the nearest-first list, backed by `/meetings/nearby`.
   Needs marker clustering (dense cities produce overlapping pins
   immediately), needs a user-location dot to be useful, and carries the
   continuous-viewport disclosure described above. **Do not build this as a
   continuation of Phase 1.** It is a separate decision with a real privacy
   cost attached.

5. **`approximate` meetings get a circle, not a pin.** This is a correctness
   requirement, not a nicety. The `approximate` flag exists because some
   venues' coordinates are deliberately imprecise. A map pin renders a
   coordinate as a specific point on a specific building in a way a text
   address does not — so for `approximate === true`, render a translucent
   radius overlay (`<Circle>`) centred on the coordinate instead of a
   `<Marker>`, and keep the existing `inPersonPopup:approximate` caveat line
   visible. Dropping a precise pin on a deliberately-fuzzed coordinate would
   misrepresent the data and could expose a venue that asked not to be
   pinpointed.

6. **Dark mode is per-provider work.** Apple Maps follows the system
   appearance on iOS. Google Maps on Android requires an explicit
   `customMapStyle` JSON to render dark, and that prop is Google-only (a
   no-op on iOS). Wire it off the existing theme context. This is the part
   most likely to be underestimated: it is not a one-line theme hookup.

7. **Web keeps the list.** `react-native-maps` has no web support. The web
   build renders the existing list + Get Directions deep-link, unchanged.
   This is an accepted asymmetry, not a gap to fill — if web parity ever
   becomes a requirement, that is an argument for MapLibre, which is
   `maplibre-gl` underneath and works there natively.

8. **API key restriction is mandatory.** The Google Maps Android key is baked
   into the shipped binary (normal for this SDK), which makes SHA-1 +
   package-name restriction in the GCP console a release blocker rather than
   a hardening step. An unrestricted key in a published APK is someone else's
   Maps quota on our bill.

## Architecture (Phase 1)

**New dependency:** `react-native-maps` + its Expo config plugin.

**Config — note `app.json` is FLAT in this repo** (no top-level `expo`
wrapper; see CLAUDE.md). The Android key goes at `android.config.googleMaps.apiKey`,
*not* nested under `expo`. Getting this wrong fails silently with a blank
grey map rather than an error.

**New component:** `app/components/InPersonMap.tsx`

```ts
interface InPersonMapProps {
  latitude: number
  longitude: number
  /** Deliberately-imprecise coordinate — renders a radius circle, not a pin */
  approximate: boolean
  venueName?: string
  /** Second entry point to the existing deep-link */
  onPress?: () => void
}
```

Kept as its own file rather than inlined into `InPersonPopup` for three
reasons: the popup is already large; the map is the only part of the tree
with a native dependency, so isolating it keeps the rest of the popup
testable under jest-expo; and Phase 2 would reuse the marker/circle logic.

**Integration:** rendered inside `InPersonPopup`'s ScrollView, above the
venue block. The ScrollView added in the UI release matters here — a
fixed-height map is exactly the kind of unbounded-content addition that
motivated it.

**Theming:** `customMapStyle` derived from the theme context, applied on
Android only.

## Verification gates

These are open questions, not settled facts. Each must be resolved before
committing to the approach — I have not verified them.

1. **New Architecture support.** This app runs `newArchEnabled: true`.
   Recent `react-native-maps` versions support the New Architecture, but the
   exact status at a pinned version must be confirmed against the target
   Expo SDK before anything else. **This is the gate that could sink the
   whole approach** — resolve it first.
2. **Google Maps Platform pricing.** Google restructured Maps Platform
   billing tiers during 2025. Check the current Dynamic Maps SKU pricing and
   free-tier terms directly; do not rely on the older $200-credit model.
3. **`expo-maps` status.** If it has reached stable on the current SDK, it
   deserves a fresh comparison — it would be a lighter integration with the
   same provider split. Believed alpha as of writing; verify.
4. **Binary size and Play Services.** Measure the AAB delta from pulling in
   Google Play Services Maps on Android.

## Out of scope

- Marker clustering (Phase 2 concern only).
- User-location dot / follow-me (Phase 2, and a privacy decision).
- Offline or cached tiles.
- Geocoded city search or manual location entry (already deferred by the UI
  spec).
- Geofenced presence verification for attendance (already deferred).
- Replacing `buildDirectionsUrl` — the deep-link stays as the navigation
  path on every platform.

## Release path

Adding `react-native-maps` is a native dependency change. Per CLAUDE.md this
means:

- **Bump `runtimeVersion` in `app.json`** alongside `version`. This cannot
  ship as an OTA; forgetting the bump targets a runtime no installed user
  has and reaches nobody.
- Full store build and submission (`npm run release:ios` / `release:android`).
- The GCP key restriction (decision #8) is a release blocker.
- Verify on physical devices for both providers — the simulator/emulator map
  behaviour differs from hardware, particularly around Play Services
  availability on Android.

## Open for the owner

- Approve Phase 1, or leave the map out entirely? The list + deep-link flow
  is complete and shipping; a map is an enhancement, not a gap.
- Phase 2 is deliberately left unapproved. If a browse map is wanted, the
  privacy tradeoff in "The decision that actually matters" should be an
  explicit yes rather than a default that arrives with the feature.
