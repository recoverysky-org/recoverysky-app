# In-Person Meetings: Map View (List/Map Toggle) — Design Spec

**Date:** 2026-08-07
**Status:** Approved via brainstorming session 2026-08-07.
**Supersedes:** `2026-08-03-in-person-map-design.md` (draft, never approved).
That draft proposed `react-native-maps` with a phased rollout (Phase 1
single-pin popup map, Phase 2 browse map gated on an explicit privacy
decision). This spec **is** that explicit decision: the owner approved a
browse map with the privacy trade-offs named below, and chose MapLibre +
MapTiler over `react-native-maps`. Requirements from the draft that remain
correct are carried forward here (marked ⤵) rather than re-derived.
**Scope:** A map alternative to the In-Person segment's nearest-first list,
behind a list/map toggle. Native release — see Release Path.

## Summary

Add a full-area map view to the Meetings tab's In-Person segment, toggled
against the existing list. Rendering is `@maplibre/maplibre-react-native`
(OSS, GL vector tiles, one identical look on iOS and Android) with hosted
MapTiler tiles. Pins are the same result set the list shows, clustered,
colored by fellowship. Tapping a pin opens the existing `InPersonPopup`.
The user's own position renders as MapLibre's native blue-dot puck.

## The privacy decision (explicit, per the superseded draft)

The 2026-08-03 draft correctly framed the core question: **on a browse map,
the viewport is location data — does a third party get to see where the
user is browsing for recovery meetings?**

Decision, 2026-08-07: **yes, accepted, with named boundaries.** MapTiler's
servers see vector-tile requests for the user's viewport (approximate area +
IP), tied to our API key. This is inherent to any hosted tile provider and
was chosen over the two alternatives:

- Google's Android SDK (the draft's path) — same viewport disclosure, to a
  party with far more cross-referencing capability, via a key baked into the
  binary.
- Self-hosted Protomaps — zero third-party disclosure, but a tile-hosting
  operations project (extract pipeline, CDN, updates). Deliberately deferred,
  **not** rejected: the config-served style URL (below) makes migrating to it
  later a server-side change, no app release.

Boundaries that make this acceptable:

- The user's **coordinates** still never leave the device except as the
  already-scrubbed `/schedules/nearby` query params. Tile requests disclose
  the *viewport*, not a GPS fix, and carry no user identity beyond IP.
- The puck renders **natively inside the GL view** — raw coordinates do not
  enter JS state, MMKV, or logs. `coordsRef` gains exactly one new consumer:
  the initial camera position (an on-device native prop, not an egress).
- The `useNearbySchedules` PRIVACY header's accounting list MUST be updated
  in the same commit that lands the map (its standing rule): (a) new
  on-device consumer of `coordsRef` — map camera + native puck; (b) new
  third-party egress — MapTiler viewport tile requests.

## Decisions

1. **MapLibre (`@maplibre/maplibre-react-native`), not `react-native-maps`,
   not `expo-maps`.** Reverses the draft's decision #2, for UI/UX reasons the
   draft did not weigh: GL vector rendering is pixel-identical across iOS,
   Android — one QA pass, one set of screenshots; the style JSON is ours, so
   light and dark styles genuinely match the app's theme (the draft's
   decision #6 flagged per-provider dark-mode work as the most underestimated
   item — MapLibre dissolves it); clustering is built into the engine; and
   data-driven styling colors pins from `FELLOWSHIP_COLORS` without
   per-marker RN views. `expo-maps` remains iOS 17+ and immature, and has no
   styling depth. The draft's observation that MapLibre "is genuinely better
   on web" also keeps the (deferred) web path coherent.

2. **MapTiler free tier for tiles and styles.** Chosen by the owner over
   OpenFreeMap (free, keyless, donation-funded) for style quality. The API
   key is **never baked into the binary**: full style URLs are served by
   `/config` (below), so key rotation or a provider swap (OpenFreeMap,
   self-hosted Protomaps) is a server-side change. Residual risk: the free
   tier has monthly request caps; a cap blank-out is handled by the map-load
   failure path (Error handling #2). Monitor usage in the MapTiler dashboard;
   graduating to a paid tier or another provider is a config edit.
   *(⤵ draft decision #8, adapted: the key can't be SHA-1-restricted like a
   Google Android key. Compensating controls: server-side delivery, MapTiler's
   own origin/usage restrictions where applicable, rotation without release.)*

3. **List/Map toggle, full-area swap.** A toggle control in the In-Person
   segment header swaps the results area between the existing list and the
   map (Airbnb pattern). The list code is untouched; the map is additive.
   The chosen view persists to MMKV (`inperson.viewMode`) as a display
   preference — same class as the existing `inperson.radius` pref, carries
   no positional information.

4. **The map shows the same result set as the list.** Pins come from the
   venues `useNearbySchedules` already returns — the day-scoped
   `/schedules/nearby` results in nearby mode, or the day-browse results in
   fallback mode. Toggling views never changes *what* is found, only how it
   is shown; the list stays the accessible and offline-safe equivalent of
   the map. **Divergence from the draft:** the unused `GET /meetings/nearby`
   endpoint (flat, nearest-first, day-optional — shaped for a map in API
   v0.6.0) is NOT adopted in this release. An any-day browse map is a
   different product than a toggled rendering of today's results; adopting
   the endpoint later is compatible with this design (swap the feature
   source) but must be its own decision, since "results differ between list
   and map" breaks the toggle's mental model.

5. **Clustering on.** The GeoJSON `ShapeSource` sets `cluster: true`;
   cluster circles render the point count and expand the camera on tap.
   Dense metros overlap pins immediately without it (the draft deferred
   clustering only because its Phase 1 had a single pin).

6. **Pins are GL symbols colored by fellowship; tap opens `InPersonPopup`.**
   Data-driven styling maps `FELLOWSHIP_COLORS` onto pin color — no
   per-marker RN views, which keeps thousands of points smooth. Tapping a
   pin behaves exactly like tapping the venue's list row: the existing
   `InPersonPopup` opens with the same meeting data. No map-specific detail
   UI.

7. **⤵ `approximate` venues get an area indicator, not a precise pin**
   (draft decision #5, carried forward verbatim in intent). The
   `approximate` flag exists because some venues' coordinates are
   deliberately imprecise; a pin renders a coordinate as a specific building
   in a way text does not. For `approximate === true`, render a translucent
   circle (separate layer filtered on the flag) instead of a pin symbol, and
   the existing `inPersonPopup:approximate` caveat line remains in the popup.
   Approximate venues still participate in clustering; the circle treatment
   applies when unclustered.

8. **User-location puck on.** MapLibre's `UserLocation` renders natively
   inside the GL view. Initial camera: nearby mode centers on the user's
   position zoomed to fit the search radius; fallback mode (no location)
   fits bounds to the result pins. No follow-me tracking; the camera is
   free after initial placement.

9. **⤵ Get Directions deep-link stays** (draft, Background). The map is for
   *seeing where meetings are*; `buildDirectionsUrl` remains the navigation
   path on every platform.

10. **Web keeps the list.** `@maplibre/maplibre-react-native` is
    native-only. On web the toggle does not render and the segment stays
    list-only. Accepted asymmetry; if web parity becomes a requirement,
    `maplibre-gl` (the JS sibling) speaks the same style JSON — that is a
    follow-up, not this release.

## Config & keys

`/config` gains two fields, mirrored as new ConfigStore fields (volatile,
never persisted to MMKV, like every other key it holds):

- `mapStyleUrlLight` — full MapTiler style URL, key embedded server-side
- `mapStyleUrlDark` — dark variant

The map component selects between them via `useAppTheme()`. **Feature gate:**
if either field is absent or empty (older server, provider trouble, or a
deliberate kill switch), the toggle does not render and the segment is
list-only — identical to today. No client release is needed to turn the map
off, rotate the key, or swap providers.

## Architecture

**New dependency:** `@maplibre/maplibre-react-native` + its Expo config
plugin. *(⤵ draft, adapted: `app.json` is FLAT in this repo — no top-level
`expo` wrapper. The plugin entry goes in the top-level `plugins` array;
misplacing config fails silently.)*

**New component:** `app/components/InPersonMapView.tsx` — the GL map,
camera logic, sources/layers, tap handling. Receives the venue list and
callbacks; owns no fetching. Isolated in its own file so the rest of the
segment stays testable under jest-expo without the native module.

**New pure module:** `app/utils/inPersonMapLogic.ts` — zero runtime `@/`
imports (type-only OK), vitest-covered. Owns every decision the map makes:

- venues → GeoJSON FeatureCollection (including the `approximate` split)
- camera math: center+zoom from (coords, radiusKm), or bounds from pins
- "should the toggle render" (platform, config fields, result shape)
- fellowship → pin color resolution

**Integration:** `InPersonScreen.tsx`'s `InPersonContent` renders the
toggle in the segment header (beside the radius control) and swaps the
results area between the existing list and `InPersonMapView`. The
`inPersonActivated` lazy-mount gate in `MeetingsScreen` already ensures
none of this (including the location prompt) runs before the user first
opens the segment — unchanged.

**Theming:** light/dark style URLs from ConfigStore, switched by the app
theme. Cluster/pin/circle layer colors come from the app's theme tokens and
`FELLOWSHIP_COLORS`.

**i18n:** new keys (toggle labels/hints, map-unavailable toast) are a
nine-locale change — keys must exist in all nine files (hard `tsc` error
otherwise); English placeholder text in the other eight, queued for
native-speaker review.

**A11y (first-class, per repo standard):** the toggle gets full
VoiceOver/TalkBack labels/hints/state. The list remains the accessible
equivalent of the map surface — the map never becomes the only path to any
capability (pin tap = list row tap; directions unchanged).

## Error handling

1. **Config fields missing/empty** → toggle hidden, list-only. Silent by
   design (this is the kill switch, not an error).
2. **Style or tile load failure** (network, MapTiler cap, bad style) →
   toast (`inPersonMap:unavailable`), auto-flip back to list, toggle stays
   visible for retry. Covers the free-tier cap blank-out.
3. **Offline** (`networkStore`) → toggle disabled with the standard
   greyed pattern; a blank tile grid is a worse experience than the list.
4. **`maintenanceMode`** → no gate. Tiles are not our API; the map keeps
   working during our maintenance like the rest of the already-fetched UI.
5. **No results** → nearby mode renders the puck at the radius-fit
   camera (an empty map around you is honest); fallback mode with zero
   pins has nothing to frame, so the camera uses a fixed continent-level
   default from the device locale. The list's existing empty state
   remains the primary communicator — users toggle back.

## Testing

- **Vitest (pure):** `inPersonMapLogic.test.ts` — GeoJSON building
  (approximate split, fellowship colors), camera math (radius fit, bounds,
  degenerate cases: 1 pin, 0 pins, antimeridian not required — continental
  use), toggle-render rules (config absent, web platform, empty results).
- **jest-expo (component):** toggle renders/labels/disabled-when-offline;
  map module mocked.
- **Manual checklist (release blocker, per platform on hardware):** light
  and dark styles; cluster tap expands; pin tap opens the correct popup;
  approximate venue renders circle not pin; puck appears in nearby mode;
  fallback mode fits bounds; airplane mode disables toggle; kill switch
  (config fields empty) hides toggle; view-mode pref survives restart.

## Verification gates (resolve before implementation)

1. **New Architecture / RN 0.81 / Expo SDK 54 support** for the pinned
   `@maplibre/maplibre-react-native` version. *(⤵ draft gate #1 — still the
   gate that could sink the approach; resolve first.)*
2. **MapTiler free-tier terms**: current monthly request cap, mobile SDK
   request accounting, and whether key restrictions can scope to the app.
3. **Binary size delta** from the MapLibre native libs (measure AAB + IPA).
4. **Style customization path**: confirm MapTiler style URLs accept our
   light/dark needs directly, or whether we host edited style JSON (still a
   server-side asset, same config mechanism).

## Out of scope

- Web map (`maplibre-gl`) — deferred, coherent follow-up.
- Adopting `GET /meetings/nearby` / any-day browse — separate decision
  (Decision #4).
- Offline/cached tiles.
- Follow-me tracking, heading indicator.
- Single-pin mini-map inside `InPersonPopup` (the draft's Phase 1) — the
  browse map supersedes its purpose; revisit only on user demand.
- Geocoded city search / manual location entry (already deferred by the
  in-person UI spec).

## Release path

- New native dependency → **bump `runtimeVersion` in `app.json` alongside
  `version`** (`npm run patch`/`minor`, then the manual `runtimeVersion`
  edit). Cannot ship as OTA.
- Server work lands first: `/config` fields live before the client release
  (the client is null-safe either way).
- Full store build + submit (`npm run release:ios` / `release:android`).
- Manual checklist above runs on physical devices for both platforms.
- CHANGELOG: user-facing Added entry for the map view; config fields noted
  for the server changelog.
