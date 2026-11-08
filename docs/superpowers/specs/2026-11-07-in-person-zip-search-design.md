# In-Person search by ZIP — design

Date: 2026-11-07. Status: design, approved for planning once Jenova has read it.
Repos: `api` (lookup route + its data file) and `app` (the segment). Jenova's rulings are marked **(Jenova)**; everything marked
**(call)** is Claude's, made in the brainstorm and open to her correction.

## Why

The Meetings tab's In-Person segment asks for the OS Location permission the
first time someone opens it, and on every later visit while location is off
(`InPersonScreen`'s per-visit `runGate`). That prompt scares people off
**(Jenova)**: someone in early recovery opening a meetings app does not expect
to be asked where they are, and a "Don't Allow" leaves them on a banner instead
of a list. A ZIP is also useful in its own right **(Jenova)**: a trip, a
friend's town, the place you're moving to. GPS only ever answers "here".

## Goals

1. Opening In-Person never raises a location prompt unless the person chose GPS.
2. A **GPS | ZIP** control sits above the Radius selector **(Jenova)**. ZIP is
   the default **(Jenova)** and shows a text box that takes a US ZIP or a
   Canadian postal code.
3. Choosing GPS is what asks for location, through the existing gate
   (`useLocationGate` → `decideLocationGate`) **(Jenova)**.
4. The map works in ZIP mode, centered on the ZIP's point, which the API
   supplies **(Jenova)**.
5. People who have already allowed location keep GPS **(Jenova)**.

## Non-goals

- No change to Online or Search, or to `/schedules/nearby` itself.
- No city or address search; no outside geocoder; no country picker (the
  code's shape says which country).
- No place name shown for a ZIP (the data sources carry none worth trusting).
- Sky's meeting search is untouched.

## Anti-goals (a build that does these has failed, even if it works)

- A location prompt on the first open of In-Person for anyone in ZIP mode.
- ZIP mode taking a GPS fix, requesting permission, or rendering the location
  puck. In ZIP mode the phone's position is never read.
- A typed ZIP reaching Loki, Sentry (JS or native breadcrumbs) or Tempo.
- A typo that costs the device a CrowdSec ban (see the API section: unknown
  codes are not 404s).
- Moving someone who allowed location onto ZIP without asking.

## How the person sees it

### The control (call)

One row above Radius in `InPersonListHeader`, in both list and map mode (the
header is shared; see the comment at its two render sites): a two-segment
**GPS | ZIP** control in the app's existing segmented style. Under it, in ZIP
mode only, a single text box:

- placeholder "ZIP or postal code"; `autoCapitalize="characters"`,
  `autoCorrect={false}`, `returnKeyType="search"`. One box serves both
  countries, so it uses the default keyboard (Canadian codes have letters).
- **Accepted shapes:** US `NNNNN`; Canada `A1A 1A1`, with or without the space,
  any case, using Canada Post's letter rules: the first letter is one of
  `ABCEGHJKLMNPRSTVXY` and no letter is `D F I O Q U`. Anything else is refused locally with an inline message and never
  sent. (ZIP+4 `NNNNN-NNNN` is accepted and trimmed to the first five, call.)
- A lookup runs on submit, or as soon as the text becomes a complete valid
  code. Never per keystroke on a partial code.
- While it looks up, the existing spinner shows. A known code loads the list
  (or map) exactly as a GPS fix does today. An unknown code shows an inline
  "We couldn't find that ZIP or postal code" under the box, and the list keeps
  whatever it showed before.
- An empty box in ZIP mode (first visit) shows a prompt in the list area,
  "Enter a ZIP or postal code to see meetings near it", instead of the location
  banner. It does not show the old fallback banner.

All new words go into the nine locale files (`en.ts` and eight English
placeholders), with a line in `docs/translation-review-2026-08-03.md`.

### Distances, sort and the map

- In ZIP mode every distance (row badges, nearest-first sort, the radius
  circle) is measured from the ZIP's point, because that is the point sent to
  `/schedules/nearby` and `distance_m` comes back relative to it. No copy
  change: "1.2 km" now means from the ZIP's center.
- The map toggle is available in ZIP mode once a point exists. Today it hides
  when `profileStore.locationEnabled` is off (`showMapToggleNow`,
  `effectiveViewMode`); that condition becomes "this mode has a center": a GPS
  fix in GPS mode, a looked-up point in ZIP mode.
- In ZIP mode the camera fits on the ZIP point, and `NativeUserLocation` is
  **not rendered (call)**. Rendering the puck there would start a native
  location consumer in the one mode that promises not to read the position.

### Switching modes

- **To GPS:** runs the existing location gate (in-app confirm, OS prompt, or
  open device settings). Granted → today's GPS flow, unchanged. Denied or
  declined → the segment **stays on GPS (call)** and shows today's tappable
  denied/disabled banner. The ZIP tab is one tap away, and silently bouncing
  someone back would hide what happened to the choice they just made.
- **To ZIP:** stops using the fix immediately. The list refetches from the
  saved ZIP point, or shows the empty-box prompt.
- The per-visit gate effect and the resume listener in `InPersonScreen` run
  **only in GPS mode**. In ZIP mode neither ever calls `runGate`.
- Settings → Permissions → Location keeps its current meaning (may the app use
  location at all). Turning it off while in GPS mode gives today's disabled
  banner. It does not change the GPS/ZIP choice.

### "I'm Here" in ZIP mode (Jenova)

"I'm Here" still needs a real fix: it verifies the person is within
`configStore.presenceRadiusM` of the venue. In ZIP mode, when the OS permission
is not yet granted, tapping it first shows a short in-app note ("'I'm Here'
checks you're at the meeting using your location, just this once.", final copy
in the plan), then the OS prompt, then the check. It is a one-off for that
check. The search stays on ZIP. When permission is already granted, there is no
extra note; it checks as today.

Note for the builder: `InPersonPopup.handleImHere` sets
`profileStore.locationEnabled = true` as a self-heal. That stays, but it is
dangerous as the screen stands: `InPersonScreen`'s `wasLocationEnabledRef`
effect calls `requestLocation()` on the flag's false→true edge, so in ZIP mode
an "I'm Here" tap would start a GPS fix for the search. The rule below closes
that.

### Every `locationEnabled` read in the search path becomes mode-aware (call)

Today `profileStore.locationEnabled` doubles as "the search has a center". In
`InPersonScreen` it gates the per-visit gate effect, the resume listener, the
`wasLocationEnabledRef` re-acquire effect, the row filter (returns `[]` when
off), the banner-tap handler, the empty/banner branches, `effectiveViewMode`,
`showMapToggleNow` and the header's `locationDisabled` prop. The plan replaces
those reads with two derived values, computed in the pure module:

- `gpsAllowed`: GPS mode **and** `locationEnabled`. It drives the gate, resume,
  re-acquire and the location banners, and all are inert in ZIP mode.
- `hasCenter`: GPS mode with a fix, or ZIP mode with a looked-up point. It
  drives the row filter, the map toggle and `effectiveViewMode`.

A ZIP-mode person with location off in Settings therefore gets a full list and
map. `useNearbySchedules`' own `locationEnabled` short-circuit in
`acquireLocation` is likewise reached only in GPS mode.

## Starting mode and what the phone remembers

- New MMKV keys, beside `inperson.radius` / `inperson.viewMode` /
  `inperson.sortOrder`: `inperson.searchMode` (`"gps" | "zip"`) and
  `inperson.zip` (the normalised code plus its looked-up `{lat, lon}`) **(call)**.
  Keeping the point means a relaunch needs no lookup request. The stored point
  is never re-checked: if a yearly data refresh removed a code, the person keeps
  searching around its old point, which is still a real place. Editing the box
  is the only thing that looks a code up again.
- **First open on the new build, nothing stored:** GPS if
  `profileStore.locationEnabled` is true, otherwise ZIP **(Jenova: keep GPS for
  people who already allowed it)**. `locationEnabled` is the right signal:
  app.tsx's resume sync already writes it false when the OS grant is revoked.
  The decision is made once, on the segment's first activation (the `active`
  latch), and stored, so later changes to the Settings toggle don't flip the
  mode. `locationEnabled` is an MMKV-snapshot prop, so it is restored before the
  first render and the decision need not wait for anything. The plan confirms
  that against `setupRootStore`, and it must not move the decision earlier than
  activation.
- These are device settings, like the other `inperson.*` keys, so guest mode
  reads and writes them too. The guest-mode device-settings list in `CLAUDE.md`
  gains both keys (spec `2026-09-27-guest-mode-design.md`, Decision 1 class).
- Delete User Data and the dev purge clear MMKV as they already do. Nothing new
  to add there, but the plan confirms both keys are covered.

## Privacy

- **The invariant:** in ZIP mode the app never calls
  `requestForegroundPermissionsAsync`, `getLastKnownPositionAsync` or
  `getCurrentPositionAsync`, and never renders `NativeUserLocation`, outside
  "I'm Here". `useNearbySchedules` takes the search mode as an input and gates
  `acquireLocation` on it.
- A ZIP is coarse, user-chosen and not the person's position, but it can still
  be their home. Treat it like `lat`/`lon`:
  - add `postal_code` to `SENSITIVE_QUERY_KEYS` (`app/utils/scrubQuery.ts`);
  - check that the native iOS breadcrumb scrub (`scrubEventBreadcrumbs` in
    `app/services/crashReporting/sentry.ts`) covers it;
  - never log the code or its point (log `mode`, the problem kind, counts);
  - analytics carry the mode only (`inperson_search_mode_changed { mode }`),
    never the code.
- The ZIP's point lives in MMKV. It is the code's centroid, not a position of
  the person. The `useNearbySchedules` PRIVACY header gets an amendment saying
  so, and saying that ZIP mode has no fix at all.
- Server side the code is already scrubbed from traces: `LOCATION_QUERY_KEYS`
  in `api/src/telemetry/scrubUrl.ts` lists `postal_code`. The route must also
  keep the code out of pino lines.

## The API: `GET /geo/postal-code` (Jenova: separate lookup endpoint)

- **Request:** `GET /geo/postal-code?postal_code=<code>`, device auth like
  `/schedules/nearby` (`deviceToken` / `apiKey`), with **its own rate-limit
  bucket (call)**, not `GEO_RATE_LIMIT`. That bucket (30/300/3, shared by both
  nearby routes) bounds PostGIS load, and a map read must not spend it. The new
  bucket is `postal`, 20/min and 100/hr per device: a person retypes a few
  codes, not dozens.
- **Normalisation, server side as well as in the app:** trim, uppercase, drop
  spaces; `NNNNN` or `NNNNN-NNNN` → US five-digit; `A1A1A1` → Canada, looked up
  by its first three characters (the FSA).
- **Answers:**
  - `200 { found: true, lat, lon, country: "US" | "CA" }`;
  - `200 { found: false }` for a well-formed code with no row;
  - `400` for a malformed code (the app never sends one).
  - **This differs from the brainstorm's "404 for an unknown code" (call).** An
    unknown code is the normal result of a typo, and CrowdSec's `http-probing`
    scenario bans on 404s to distinct URLs, which a person retyping a ZIP
    produces. A 404 then means only "this API has no such route".
- **Data: meetings-mcp's postal table, read from its file (Jenova).** No
  Postgres and no outside geocoder. meetings-mcp is building this right now in
  the api repo: its plan
  `docs/superpowers/plans/2026-11-07-meetings-mcp-favorites.md`, Task 4,
  produces `src/mcp/postal.ts`, `scripts/build-postal-table.ts` and the
  generated `src/mcp/data/postal-codes.json`. This route reuses that code once
  it lands **(Jenova: "hijack that code once it's built")**. What it gives us,
  per that plan:
  - `normalizePostalCode(input) → { country: "US" | "CA"; key } | null` and
    `lookupPostalCode(input) → { lat, lon } | null`;
  - **source:** the GeoNames postal dump for US and CA (CC BY 4.0, credited to
    www.geonames.org), about 41,000 US keys and 1,600 Canadian FSAs, roughly
    1 MB, rounded to 4 decimal places. This replaces the Census ZCTA plus
    Statistics Canada sources this design first named;
  - **Canada by FSA,** the first three characters, as agreed here; its
    normaliser also accepts the FSA alone (`K1A`);
  - **loading:** lazy and synchronous, `readFileSync` on the first lookup,
    parsed once and held in memory. The table ships to `dist/mcp/data`
    through `postbuild`.
- **Why FSA is enough:** the smallest radius is 10 km
  (`RADIUS_OPTIONS_KM` = 10/25/50/100), and an urban FSA is a few km across.
  Rural FSAs are large; a rural Canadian may need a wider radius. Accepted.
- **Moving it out of `src/mcp/` (call).** The table serves both processes now,
  so `postal.ts` and its data file move to `src/services/` (data path and
  `postbuild` follow), and the MCP imports it as a seventh allowed pure module
  in its import boundary (api `CLAUDE.md` "The import boundary";
  `src/mcp/importBoundary.test.ts` gains the entry). A REST route importing
  from `src/mcp/` would invert the boundary's direction. The move waits until
  meetings-mcp's plan has finished, so it never collides with that run.
- **Answers built on it:** `country` comes from `normalizePostalCode`, the
  point from `lookupPostalCode`. A malformed code is a 400; a well-formed code
  with no row is `found: false`. If reading or parsing the table throws, the
  route answers `503` (`UpstreamUnavailable`, like the geo routes) and logs one
  error line without the code.
- **Credit:** CC BY 4.0 needs the GeoNames credit in the app's Licenses screen
  (the app shows data derived from it, the meetings' distances and centers).
- **Where the change lives:** `api` only: the move, the route and its OpenAPI
  entry, tests, and a CLAUDE.md section. No `common` change and no migration.
  The app needs no `common` bump.
- **Dependency:** the API half can start only after meetings-mcp Task 4 is
  committed. The app half can be built against the contract before that.

## Release order

1. `api`: after meetings-mcp's postal table has landed, deploy the moved
   module and the route, then spot-check a few codes in each country against
   production.
2. `app`: JS-only, so an **OTA** (no `runtimeVersion` bump). The app treats a
   404 from the lookup route itself as "ZIP search isn't available yet", shows
   that inline, and makes no more lookups in that session, so an app that is
   ahead of the API asks once.

## Throttling in the app (call)

- Never send a code that fails the local shape check.
- Remember answers for the session: a code already answered (found or not) is
  not asked again.
- At most one lookup in flight; a newer valid code replaces the pending one.
- A transport failure shows an inline tap-to-retry and is not retried
  automatically (`isRetryableProblem` rules; no ladder on 4xx).

## Docs that change with it

- `docs/manual/map.md`: the Meetings line says In-Person "asks for the Location
  permission"; it becomes ZIP-by-default with GPS on request. Any In-Person
  manual page that exists when this lands is updated in the same commit
  (same-commit rule). The manual-ingest HOLD in CLAUDE.md still applies.
- App `CLAUDE.md`: the In-Person segment notes, the Permissions & Location Gate
  section (the gate is now GPS-mode-only), the In-Person Map privacy notes
  (no puck in ZIP mode) and the guest-mode device-settings list.
- `CHANGELOG.md` in both repos.

## Testing

- **App, vitest (pure, new `inPersonSearchLogic.ts`):** code normalisation and
  shape check (US, ZIP+4, CA with/without space, lower case, junk); the
  starting-mode decision; "which center does this mode use"; the lookup gate
  (shape, session memo, unavailable latch).
- **App, jest:** the header renders the control, shows the box only in ZIP
  mode and the inline messages; the screen runs no `runGate` in ZIP mode on
  visit or on resume.
- **App, by hand on both platforms** (this is where a regression would hide):
  a fresh install opens In-Person with no prompt; switching to GPS prompts;
  someone with location allowed stays on GPS after the OTA; ZIP mode's map
  shows no puck; "I'm Here" in ZIP mode shows the note, then the prompt.
- **API:** route tests for every answer and for the unreadable-table `503`;
  meetings-mcp's `postal.test.ts` moves with the module and keeps passing; the
  import-boundary test passes with the new allowed module.

## Left to the builder

- Exact copy of the new strings, within the meanings above.
- The segmented control's component: reuse whatever the Meetings tab already
  uses for segments, if it fits a header row; otherwise a small themed pair of
  buttons with `accessibilityRole="tab"` / selected state (a11y is a first-class
  repo standard).
- How `useNearbySchedules` takes the mode and the ZIP point (props versus a
  small store), as long as the logic sits in the pure module.
- Whether the app also accepts a bare FSA (`K1A`) in the box, as the server's
  normaliser does.
