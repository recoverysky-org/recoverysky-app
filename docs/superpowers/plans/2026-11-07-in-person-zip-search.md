# In-Person search by ZIP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The In-Person segment searches around a typed US ZIP or Canadian postal code by default, and asks for location only when the person picks GPS.

**Architecture:** A pure `inPersonSearchLogic.ts` holds every decision (code shape, starting mode, lookup gating, which flags the screen keys on). A new hook `useInPersonSearchMode` owns the mode, the ZIP, MMKV and the lookup. `useNearbySchedules` takes the mode and ZIP point as inputs and never touches location in ZIP mode. The API gains `GET /geo/postal-code`, built on meetings-mcp's postal table moved into `src/services/`.

**Tech Stack:** React Native 0.81 / Expo 54, MobX-State-Tree, MMKV, apisauce, vitest (`*.test.ts`) + jest-expo (`*.test.tsx`); api: Express, zod, vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-11-07-in-person-zip-search-design.md` (read it first; it is the authority).

## Global Constraints

- Work on `root` in `/Users/jenova/projects/recoverysky-org/app` (Tasks 1–8) and on `prod` in `/Users/jenova/projects/recoverysky-org/api` (Task 9). Other sessions share both checkouts: stage only named paths, never `git add -A`, never `git stash`. Commit footer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
- Lint only the files you touched: `npx eslint --fix <files>` (app), `pnpm exec eslint <files>` (api). Never `npm run lint`.
- App checks before each commit: `npm run compile`, the task's tests, and `npm run lint:deps` (the violation count must not grow from its value at Task 1's start; record it in the ledger).
- vitest cannot resolve `@/`: every `*Logic.ts` module keeps zero runtime `@/` imports.
- In ZIP mode the app never calls `Location.requestForegroundPermissionsAsync`, `getLastKnownPositionAsync` or `getCurrentPositionAsync`, never renders `NativeUserLocation`, and never runs `runGate`, except inside "I'm Here".
- Never log, track or persist outside MMKV a postal code or its point. Log `mode`, problem `kind`, counts. Analytics carry `{ mode }` or `{ result }` only.
- MMKV keys, exactly: `inperson.searchMode` (`"gps"` | `"zip"`) and `inperson.zip` (JSON `{ "code": string, "country": "US" | "CA", "lat": number, "lon": number }`).
- Accepted code shapes (app): US `^\d{5}(-?\d{4})?$`; Canada full `A1A 1A1` (space or hyphen optional) or bare FSA `A1A`, case-insensitive. First letter in `ABCEGHJKLMNPRSTVXY`; the other letters exclude `D F I O Q U`.
- Wire contract: `GET /geo/postal-code?postal_code=<code>` → `200 { "found": true, "lat": n, "lon": n, "country": "US" | "CA" }` | `200 { "found": false }` | `400` malformed | `503` table unreadable. A `404` means the route does not exist.
- API rate limit: its own bucket `{ name: "postal", perMinute: 20, perHour: 100, maxConcurrent: 2 }`, never `GEO_RATE_LIMIT`.
- Comments follow app `CLAUDE.md` "Comments": keep the original comment, append `CHANGED 2026-11-07 (ZIP search): <why>`.
- Every new string goes into all nine locale files (`en.ts`; the other eight get the English text as a placeholder) plus an entry in `docs/translation-review-2026-08-03.md`.
- New interactive UI carries VoiceOver/TalkBack props (`accessibilityRole`, `accessibilityState`, `accessibilityLabel`).

## Review Focus

1. **Switching GPS → ZIP while a fix is in flight.** A fix that lands after the switch must not write `coordsRef`, must not fetch, and must not move the list. Task 4 gates every post-`await` write on a mode ref; Task 6's device checklist exercises it.
2. **Retyping the same code, or typing fast.** One request per distinct code per session, at most one in flight. Pinned by `decideZipLookup` tests (Task 1).
3. **Someone with location allowed opens the new build.** Nothing stored + `locationEnabled: true` → GPS; the stored mode then wins over later Settings changes. Pinned by `decideStartingSearchMode` tests (Task 1).
4. **ZIP mode with Settings → Location off.** The list, map and sort still work; no location banner. Pinned by `deriveSearchFlags` tests (Task 1).
5. **An app ahead of the API.** The route's 404 latches "unavailable" for the session, with one request. Pinned by `decideZipLookup` and `toPostalLookupResult` tests (Tasks 1–2).

---

## File Structure

| File | Task | Role |
|---|---|---|
| `app/utils/inPersonSearchLogic.ts` (+ `.test.ts`) | 1 | every new pure decision |
| `app/services/api/postalLookupLogic.ts` (+ `.test.ts`) | 2 | parse the lookup body, map problems |
| `app/services/api/index.ts` | 2 | `api.lookupPostalCode` |
| `app/utils/scrubQuery.ts` (+ test) | 2 | `postal_code` scrubbed |
| `app/hooks/useInPersonSearchMode.ts` | 3 | mode, ZIP, MMKV, lookup I/O |
| `app/utils/nearbyLogic.ts` (+ test), `app/hooks/useNearbySchedules.ts` | 4 | search inputs, no location in ZIP mode |
| `app/components/InPersonListHeader.tsx` (+ test), `app/i18n/*.ts` | 5 | GPS \| ZIP control and the box |
| `app/screens/InPersonScreen.tsx`, `app/components/InPersonMapView.tsx`, `docs/manual/map.md`, `CHANGELOG.md` | 6 | wiring, map, manual |
| `app/components/InPersonPopup.tsx` | 7 | the "I'm Here" note |
| `app/screens/LicensesScreen.tsx`, `CLAUDE.md`, `docs/translation-review-2026-08-03.md` | 8 | credit and docs |
| api `src/services/postal.ts`, `src/routes/geo.ts`, `src/app.ts`, `src/openapi.ts`, … | 9 | the lookup route |

---

### Task 1: Pure search decisions

**Files:**
- Create: `app/utils/inPersonSearchLogic.ts`, `app/utils/inPersonSearchLogic.test.ts`

**Interfaces:**
- Produces:
  - `type InPersonSearchMode = "gps" | "zip"`
  - `type PostalCountry = "US" | "CA"`
  - `interface NormalizedPostal { country: PostalCountry; code: string }`. `code` is the canonical form sent to the API: US five digits; CA uppercase with no space (`"K1A0B1"`, or `"K1A"` for a bare FSA).
  - `normalizePostalInput(raw: string): NormalizedPostal | null`
  - `parseSearchMode(raw: string | null | undefined): InPersonSearchMode | null`
  - `decideStartingSearchMode(input: { stored: string | null | undefined; locationEnabled: boolean }): InPersonSearchMode`
  - `interface StoredZip { code: string; country: PostalCountry; lat: number; lon: number }`
  - `parseStoredZip(raw: string | null | undefined): StoredZip | null`, `serializeStoredZip(z: StoredZip): string`
  - `type ZipAnswer = { found: true; lat: number; lon: number; country: PostalCountry } | { found: false }`
  - `type ZipLookupDecision = { action: "invalid" } | { action: "unavailable" } | { action: "memo"; answer: ZipAnswer } | { action: "in-flight" } | { action: "fetch"; code: string }`
  - `decideZipLookup(input: { normalized: NormalizedPostal | null; memo: ReadonlyMap<string, ZipAnswer>; unavailable: boolean; inFlightCode: string | null }): ZipLookupDecision`
  - `deriveSearchFlags(input: { mode: InPersonSearchMode | null; locationEnabled: boolean; hasFix: boolean; hasZipCenter: boolean }): { gpsAllowed: boolean; hasCenter: boolean }`
  - `shouldRunVisitGate(input: { mode: InPersonSearchMode | null; locationEnabled: boolean }): boolean`
  - `shouldExplainImHere(input: { mode: InPersonSearchMode | null; osGranted: boolean }): boolean`

- [ ] **Step 1: Write the failing tests** in `inPersonSearchLogic.test.ts` (vitest):
  - `normalizePostalInput`: `"80203"` → `{ country: "US", code: "80203" }`; `"80203-1234"` and `"802031234"` → code `"80203"`; `" k1a 0b1 "`, `"K1A-0B1"`, `"k1a0b1"` → `{ country: "CA", code: "K1A0B1" }`; `"k1a"` → `{ country: "CA", code: "K1A" }`; null for `""`, `"1234"`, `"123456"`, `"ABCDE"`, `"K1A 0B"`, `"D1A 0B1"` (bad first letter), `"W1A"` (bad first letter), `"K1O 0B1"` (O excluded).
  - `parseSearchMode`: `"gps"`/`"zip"` pass; `"GPS"`, `""`, `null`, `undefined` → null.
  - `decideStartingSearchMode`: stored `"zip"` + `locationEnabled: true` → `"zip"`; stored `"gps"` + false → `"gps"`; nothing stored + true → `"gps"`; nothing stored + false → `"zip"`; stored `"junk"` + true → `"gps"`.
  - `parseStoredZip`: round-trips `serializeStoredZip`; null for `null`, `"{"`, a missing field, a non-finite `lat`, `lat` 91, `lon` -181, a `country` other than US/CA.
  - `decideZipLookup`: null `normalized` → `invalid` (even when `unavailable`); `unavailable` → `unavailable`; a memoised code → `memo` with that answer (found and not-found both); `inFlightCode` equal to the code → `in-flight`; otherwise `fetch` with the canonical code.
  - `deriveSearchFlags`: gps + enabled + fix → `{ gpsAllowed: true, hasCenter: true }`; gps + disabled + fix → `{ false, false }`; gps + enabled + no fix → `{ true, false }`; zip + `locationEnabled: false` + zip center → `{ false, true }`; zip + no center → `{ false, false }`; mode null → both false.
  - `shouldRunVisitGate`: true only for gps + `locationEnabled: false`; false for zip either way and for null.
  - `shouldExplainImHere`: true only for zip + `osGranted: false`.
- [ ] **Step 2: Run** `npm run test:unit -- app/utils/inPersonSearchLogic.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `inPersonSearchLogic.ts`, no runtime imports at all. A file header says it is the pure half of ZIP search and points at the spec. `parseStoredZip` validates every field (lat −90..90, lon −180..180, finite).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `✨ feat(inperson): pure decisions for ZIP search`, staging the two files.

### Task 2: API client, body parsing and scrubbing

**Files:**
- Create: `app/services/api/postalLookupLogic.ts`, `app/services/api/postalLookupLogic.test.ts`
- Modify: `app/services/api/index.ts` (beside `getNearbySchedules`), `app/utils/scrubQuery.ts`, `app/utils/scrubQuery.test.ts`

**Interfaces:**
- Consumes: `ZipAnswer` (Task 1, type-only import).
- Produces:
  - `type PostalLookupResult = { kind: "ok"; answer: ZipAnswer } | { kind: "unavailable" } | { kind: "failed"; problem: string }`
  - `toPostalLookupResult(input: { ok: boolean; problemKind: string | null; data: unknown }): PostalLookupResult`: `ok` + a valid body → `ok`; problem `"not-found"` → `unavailable` (the route is missing); `ok` with a malformed body, or any other problem → `failed` with the kind (`"bad-data"` for a malformed body).
  - `api.lookupPostalCode(code: string): Promise<PostalLookupResult>`: `GET /geo/postal-code` with query `{ postal_code: code }`. It logs only the result kind.

- [ ] **Step 1: Write the failing tests.** `postalLookupLogic.test.ts`: found body → ok with `{ found: true, lat, lon, country }`; `{ found: false }` → ok not-found; found with a string `lat`, lat out of range, or country `"MX"` → `failed`/`"bad-data"`; problem `"not-found"` → `unavailable`; problems `"timeout"`, `"rejected"` → `failed` with that kind. `scrubQuery.test.ts`: `scrubUrl("https://api.recoverysky.org/geo/postal-code?postal_code=K1A0B1")` filters `postal_code`, matching the existing `lat`/`lon` cases' expected form.
- [ ] **Step 2: Run** `npm run test:unit -- app/services/api/postalLookupLogic.test.ts app/utils/scrubQuery.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `"postal_code"` to `SENSITIVE_QUERY_KEYS` with a comment naming the ZIP lookup (the Sentry native breadcrumb scrub reads the same set through `scrubQueryString`, so that covers it). Add `lookupPostalCode` with a PRIVACY line like `getNearbySchedules`' ("never log the code").
- [ ] **Step 4: Run** the same command, then `npm run compile`. Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** `✨ feat(api): lookupPostalCode client, postal_code scrubbed from breadcrumbs`.

### Task 3: `useInPersonSearchMode` hook

**Files:**
- Create: `app/hooks/useInPersonSearchMode.ts`

**Interfaces:**
- Consumes: Task 1's decisions and types; `api.lookupPostalCode` (Task 2); `loadString`/`saveString` from `@/utils/storage`; `useProfileStore`; `trackEvent` from `@/services/tracking`.
- Produces:
  - `type ZipStatus = "empty" | "invalid" | "looking" | "found" | "notFound" | "unavailable" | "failed"`
  - `useInPersonSearchMode(active: boolean): { mode: InPersonSearchMode | null; setMode(mode: InPersonSearchMode): void; zipInput: string; setZipInput(text: string): void; submitZip(): void; retryZip(): void; zipStatus: ZipStatus; zipCenter: { lat: number; lon: number } | null; zipCode: string | null }`

Behaviour (I/O only; every decision is a Task 1 call):
- `mode` is null until `active` first goes true. Then it is `decideStartingSearchMode({ stored: loadString("inperson.searchMode"), locationEnabled })`, saved at once. `setMode` saves it and tracks `inperson_search_mode_changed { mode }`.
- On mount it restores `inperson.zip` via `parseStoredZip`: `zipInput` shows the stored code (CA displayed as `A1A 1A1`), `zipCenter` is its point, and `zipStatus` is `"found"`. With nothing stored: `""` and `"empty"`.
- `setZipInput` updates the text. When `normalizePostalInput` accepts it, it runs the lookup at once. Partial text never triggers a lookup, and an invalid-message is not shown while typing.
- `submitZip` runs the lookup; an unaccepted shape sets `"invalid"`.
- The lookup goes through `decideZipLookup`, with a session memo (`useRef<Map>`), an `unavailable` ref latch, and the in-flight code. `fetch` → `"looking"` → `api.lookupPostalCode`:
  - found → save `inperson.zip`, set `zipCenter`, `"found"`;
  - not found → `"notFound"` (keep the previous `zipCenter`);
  - `unavailable` → latch, `"unavailable"`;
  - `failed` → `"failed"`, no automatic retry.
  - Each found/not-found answer is memoised. Track `inperson_zip_lookup { result }` where `result` is the status. A response for a code that is no longer the newest submitted is dropped.
- `retryZip` re-runs the current text's lookup.
- File header: PRIVACY paragraph (the code and its point stay in this hook's state and MMKV; nothing logs or tracks them). It is not unit-tested because it imports `@/`; the decisions are in `inPersonSearchLogic.ts`.

- [ ] **Step 1: Implement** the hook as above.
- [ ] **Step 2: Run** `npm run compile` and `npx eslint --fix app/hooks/useInPersonSearchMode.ts`. Expected: 0 errors.
- [ ] **Step 3: Commit** `✨ feat(inperson): useInPersonSearchMode owns the GPS/ZIP choice and the lookup`.

### Task 4: `useNearbySchedules` searches from the chosen center

**Files:**
- Modify: `app/utils/nearbyLogic.ts`, `app/utils/nearbyLogic.test.ts`, `app/hooks/useNearbySchedules.ts`

**Interfaces:**
- Consumes: `InPersonSearchMode` (Task 1).
- Produces:
  - `NearbyModeInput` gains optional `searchMode?: InPersonSearchMode | null` and `hasZipCenter?: boolean`. Absent `searchMode` behaves exactly as today, so existing tests stay green.
  - `useNearbySchedules(active: boolean, fellowship: string, search: { mode: InPersonSearchMode | null; zipCenter: { lat: number; lon: number } | null })`.
  - The result's `getCoords` is renamed `getSearchCenter`: it returns the GPS fix in GPS mode and `zipCenter` in ZIP mode.
  - The result gains `hasFix: boolean`: GPS mode and `fix === "acquired"` with a fix in `coordsRef`. It is state-derived, never the coordinate itself.

- [ ] **Step 1: Write the failing tests** (`nearbyLogic.test.ts`), for `searchMode: "zip"`:
  - `resolveMode`: `active: false` → `"locating"`; `hasZipCenter: false` → `"fallback"`; center + `nearbyFetchFailed` → `"fallback"`; center → `"nearby"`; `permission: "denied"` and `fix: "failed"` are ignored in zip mode.
  - `resolveBannerReason` in zip mode: `"nearbyFailed"` when the fetch failed with a center, else null (no `"denied"`/`"fixFailed"` ever).
  - `searchMode: null` → `"locating"`.
- [ ] **Step 2: Run** `npm run test:unit -- app/utils/nearbyLogic.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the logic change, then the hook:
  - a `modeRef` mirrors `search.mode`;
  - `acquireLocation` returns at once unless `modeRef.current === "gps"`, and its `isCurrent()` also requires gps, so a fix that lands after a switch writes nothing (Review Focus 1);
  - switching to `"zip"` clears `coordsRef`;
  - `fetchMeetings` takes its center from `modeRef.current === "zip" ? zipCenter : coordsRef.current` and lists `search.mode`, `zipCenter?.lat` and `zipCenter?.lon` in its deps, so a new ZIP point refetches;
  - the driver effect's first load runs `acquireLocation` only in GPS mode, waits while `mode` is null, and re-runs `startInitialLoad` on a zip → gps switch;
  - `refresh` re-fixes only in GPS mode;
  - `modeInput` passes `searchMode` and `hasZipCenter`.
  - Append the PRIVACY header amendment the spec asks for: ZIP mode reads no position; `zipCenter` is a code's centroid from MMKV, not the person's position; `getSearchCenter` returns whichever applies.
- [ ] **Step 4: Run** `npm run test:unit -- app/utils/nearbyLogic.test.ts` and `npm run compile`. Expected: PASS. Compile errors remain only at `InPersonScreen`'s call site, which Task 6 fixes; fix those two lines minimally now (pass `{ mode: "gps", zipCenter: null }` and rename `getCoords`) so the tree compiles at this commit.
- [ ] **Step 5: Commit** `♻️ refactor(inperson): nearby search takes its center from the chosen mode`.

### Task 5: The GPS | ZIP control and the box

**Files:**
- Modify: `app/components/InPersonListHeader.tsx`, `app/components/InPersonListHeader.test.tsx`, the nine `app/i18n/*.ts`, `docs/translation-review-2026-08-03.md`

**Interfaces:**
- Consumes: `InPersonSearchMode` (Task 1), `ZipStatus` (Task 3, type-only).
- Produces new `InPersonListHeaderProps`: `searchMode: InPersonSearchMode | null`, `onSelectSearchMode(mode: InPersonSearchMode): void`, `zipInput: string`, `onChangeZipInput(text: string): void`, `onSubmitZip(): void`, `zipStatus: ZipStatus`, `onRetryZip(): void`.
- New `inPersonScreen` keys, English text exactly:
  - `searchModeLabel`: "Search by"
  - `searchModeGps`: "GPS"
  - `searchModeZip`: "ZIP"
  - `zipPlaceholder`: "ZIP or postal code"
  - `zipInvalid`: "Enter a 5-digit ZIP or a postal code like K1A 0B1."
  - `zipNotFound`: "We couldn't find that ZIP or postal code."
  - `zipUnavailable`: "ZIP search isn't available right now."
  - `zipFailed`: "Couldn't look that up. Tap to try again."
  - `emptyNeedsZip`: "Enter a ZIP or postal code to see meetings near it."
  - `imHereLocationTitle`: "Check you're here"
  - `imHereLocationMessage`: "\"I'm Here\" uses your location once, to check you're at this meeting. Your search stays on your ZIP."
  - `imHereLocationContinue`: "Continue"

- [ ] **Step 1: Write the failing tests** (`InPersonListHeader.test.tsx`, extend `baseProps` with `searchMode: "zip"`, `zipInput: ""`, `zipStatus: "empty"` and jest.fn handlers):
  - both tabs render with `accessibilityRole="tab"`; the ZIP tab has `accessibilityState.selected` true in zip mode;
  - pressing GPS calls `onSelectSearchMode("gps")`;
  - the box (found by placeholder "ZIP or postal code") renders in zip mode and not in gps mode, and not when `searchMode` is null;
  - typing calls `onChangeZipInput`; submitting calls `onSubmitZip`;
  - each status shows its message: `invalid` → zipInvalid, `notFound` → zipNotFound, `unavailable` → zipUnavailable, `failed` → zipFailed; pressing the failed message calls `onRetryZip`; `found`/`empty`/`looking` show none.
- [ ] **Step 2: Run** `npm run test:component -- app/components/InPersonListHeader.test.tsx`. Expected: new cases FAIL.
- [ ] **Step 3: Implement.** The control is a row above the Radius/Day/Time grid, a themed two-button pair in the header's existing pill styling (the list/map pill is the model), wrapped in a `View` with `accessibilityRole="tablist"` and `accessibilityLabel` = searchModeLabel. The box is `TextField` from `@/components` (never raw `TextInput`): `autoCapitalize="characters"`, `autoCorrect={false}`, `autoComplete="postal-code"`, `returnKeyType="search"`, `maxLength={10}`. Add the keys to all nine locale files (English placeholders in eight) and one review-queue entry listing them.
- [ ] **Step 4: Run** the same test plus `npm run compile`. Expected: PASS. Pass the new props from both `InPersonListHeader` call sites in `InPersonScreen` as gps-mode no-ops for now, so this commit compiles.
- [ ] **Step 5: Commit** `✨ feat(inperson): GPS | ZIP control and postal code box in the header`.

### Task 6: Wire the screen; map and manual

**Files:**
- Modify: `app/screens/InPersonScreen.tsx`, `app/components/InPersonMapView.tsx`, `app/components/InPersonMapView.web.tsx` (prop parity), `docs/manual/map.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5.
- Produces: `InPersonMapViewProps.showUserLocation: boolean`. `NativeUserLocation` renders only when it is true. `InPersonPopup` receives `searchMode` (consumed in Task 7; add the optional prop to the popup's props here with no behaviour yet).

- [ ] **Step 1: Wire.** In `InPersonContent`:
  - Call `useInPersonSearchMode(active)` and pass `{ mode, zipCenter }` to `useNearbySchedules`. Compute `const { gpsAllowed, hasCenter } = deriveSearchFlags({ mode, locationEnabled: profileStore.locationEnabled, hasFix, hasZipCenter: zipCenter !== null })`, with `hasFix` from the hook (Task 4).
  - Replace each `profileStore.locationEnabled` read, by role:
    - the visit gate effect: `if (!shouldRunVisitGate({ mode, locationEnabled })) return` in place of `if (profileStore.locationEnabled) return`;
    - the resume listener: same rule;
    - the `wasLocationEnabledRef` re-acquire effect: only when `mode === "gps"`;
    - `handleBannerPress`'s first branch: `mode === "gps" && !locationEnabled`;
    - `ListEmptyComponent`: zip mode with no `zipCenter` → a non-tappable `emptyNeedsZip` text, checked first; the `emptyNeedsLocation` branch only when `mode === "gps" && !locationEnabled`;
    - `visibleMeetings`: `if (!hasCenter) return []`;
    - `effectiveViewMode` and `showMapToggleNow`: `hasCenter` in place of `locationEnabled`;
    - the header's `locationDisabled`: `mode === "gps" && !locationEnabled`.
  - Every changed read keeps its comment and gains a `CHANGED 2026-11-07 (ZIP search)` line.
  - `setMode("gps")` also calls `runGate()` when `!locationEnabled` (the gate is the only prompt path). Granted → the hook's zip→gps re-run fixes and fetches. Declined → stays on GPS with today's banner.
  - Map: pass `showUserLocation={mode === "gps"}`. Give `<InPersonMapView>` `key={mode === "zip" ? zipCode ?? "zip" : "gps"}`, so a new ZIP or a mode switch re-fits the camera (it fits once per mount). Pass `searchMode={mode}` to `InPersonPopup`.
  - Wire the header props from the hook (both call sites).
- [ ] **Step 2: Docs in the same commit (same-commit rule).** `docs/manual/map.md`: replace "In-Person has a list and a map and asks for the Location permission." with words saying In-Person searches around a ZIP or postal code by default, and the "GPS" choice asks for the Location permission. Use the labels exactly: "GPS", "ZIP", "ZIP or postal code". Run `pnpm --dir ../agent manual:ingest ../app/docs/manual --dry-run`; expected exit 0. `CHANGELOG.md` `[Unreleased]` → `Changed`: In-Person opens on a ZIP or postal code search and asks for location only when you choose GPS; people who already allowed location stay on GPS. Add `Docs`: `(manual)` map line.
- [ ] **Step 3: Run** `npm run compile`, `npm run test:unit`, `npm run test:component`, `npm run lint:deps`. Expected: all pass, depcruise count unchanged.
- [ ] **Step 4: Commit** `✨ feat(inperson): search by ZIP by default, GPS only on request`.

Device checklist (record results in the ledger; Jenova runs what you cannot):
1. Fresh install → In-Person: no OS prompt; the ZIP box and the `emptyNeedsZip` text show.
2. Type `10001`: list loads with no extra Enter; map shows no blue dot.
3. Switch to GPS: in-app confirm then OS prompt; allow → list from your position.
4. On GPS, switch to ZIP during "locating": the list never jumps to your position.
5. An install with location allowed, updated to this build: opens on GPS.
6. Settings → Location off, then ZIP mode: list and map still work.

### Task 7: "I'm Here" note in ZIP mode

**Files:**
- Modify: `app/components/InPersonPopup.tsx`

**Interfaces:**
- Consumes: `shouldExplainImHere` (Task 1); `searchMode` prop (Task 6); the Task 5 `imHereLocation*` strings.

- [ ] **Step 1: Implement.** In `handleImHere`, after the `canLogAttendance` / `isChecking` guards and **before** the `locationEnabled` self-heal, read `Location.getForegroundPermissionsAsync()` (a read, never a prompt; on rejection treat as not granted). When `shouldExplainImHere({ mode: searchMode, osGranted })`, show a two-button confirm (`imHereLocationTitle` / `imHereLocationMessage`, Cancel + `imHereLocationContinue`). Native uses `Alert.alert`; web uses the `window.confirm` fallback that `useLocationGate` uses (react-native-web's `Alert` is a no-op). Cancel returns before the self-heal and before `check`. Continue carries on unchanged. Comment it with the spec's reason and with the ordering rule (the note must precede the self-heal, or a cancel would still flip `locationEnabled`).
- [ ] **Step 2: Run** `npm run compile` and `npm run test:component`. Expected: PASS.
- [ ] **Step 3: Commit** `✨ feat(inperson): explain the one-off location check behind "I'm Here" in ZIP mode`.

### Task 8: Credit and repo docs

**Files:**
- Modify: `app/screens/LicensesScreen.tsx`, the nine `app/i18n/*.ts` (one key), `docs/translation-review-2026-08-03.md`, `CLAUDE.md`

- [ ] **Step 1: Credit.** `settingsScreen.postalDataCredit`: "Postal code data © GeoNames (www.geonames.org), licensed under CC BY 4.0." Render it as a `Text` above the OSS blob in `LicensesScreen`. Add it to all nine locales and the review queue.
- [ ] **Step 2: CLAUDE.md.**
  - "Navigation" In-Person notes and "Permissions & the Location Gate": the gate runs only in GPS mode.
  - "In-Person Map" privacy bullet: no puck in ZIP mode; `getSearchCenter` returns the mode's center.
  - "Guest mode (Android)" device-settings list: add `inperson.searchMode` and `inperson.zip`.
  - "Smaller Subsystems" In-Person bullet: one paragraph on ZIP search naming the spec, `inPersonSearchLogic.ts`, `useInPersonSearchMode`, and the API route and its release-order dependency.
- [ ] **Step 3: Run** `npm run compile` and `npm run test:component -- app/components/InPersonListHeader.test.tsx`. Expected: PASS.
- [ ] **Step 4: Commit** `📝 docs(inperson): GeoNames credit and CLAUDE.md for ZIP search`.

### Task 9: API `GET /geo/postal-code` (api repo, `prod`)

**Gate, check first:** `cd /Users/jenova/projects/recoverysky-org/api && git log --oneline -- src/mcp/postal.ts | head -1`, and in `.superpowers/sdd/2026-11-07-meetings-mcp-favorites/progress.md` look for a `Task 4: complete` line. If `src/mcp/postal.ts` is not committed, or that plan's ledger lacks its final-review line, **stop and report BLOCKED**. Moving files under a running plan collides with it.

**Files:**
- Move: `src/mcp/postal.ts` → `src/services/postal.ts`, `src/mcp/postal.test.ts` → `src/services/postal.test.ts`, `src/mcp/data/postal-codes.json` → `src/services/data/postal-codes.json` (`git mv`)
- Modify: every importer of `src/mcp/postal` (grep), `src/mcp/importBoundary.test.ts` (allow `services/postal`), api `CLAUDE.md` "The import boundary" (seven pure modules), `package.json` `postbuild` (copy `src/services/data` → `dist/services/data` in place of the mcp path), the postbuild assertion in `postal.test.ts`
- Create: `src/routes/geo.ts`, `src/routes/geo.test.ts`
- Modify: `src/app.ts` (`app.use("/geo", geoRouter)` beside `/schedules`), `src/openapi.ts` (`/geo/postal-code`, tag `Geo`), api `CLAUDE.md` (a "Postal code lookup" section), api `CHANGELOG.md`

**Interfaces:**
- Consumes (from meetings-mcp Task 4, unchanged by the move): `normalizePostalCode(input: string): { country: "US" | "CA"; key: string } | null`, `lookupPostalCode(input: string): { lat: number; lon: number } | null`. A table read or parse failure throws (lazy `readFileSync`).
- Produces: the wire contract in Global Constraints. The limiter `const POSTAL_RATE_LIMIT: RateLimitOptions = { name: "postal", perMinute: 20, perHour: 100, maxConcurrent: 2 }` is defined in `geo.ts`, with a comment saying why it is not `GEO_RATE_LIMIT`.

- [ ] **Step 1: Move** the module with `git mv` and fix the imports, the boundary test and `postbuild`. Run `pnpm test src/services/postal.test.ts src/mcp` and `pnpm typecheck`. Expected: PASS. Commit `♻️ refactor(postal): the postal table serves the api and the MCP from src/services`.
- [ ] **Step 2: Write the failing route tests** (`geo.test.ts`, supertest; follow `schedules.nearby.test.ts` for the logger and `deviceAuth` mocks; mock `../services/postal.js`):
  - `10001` → 200 `{ found: true, lat, lon, country: "US" }`;
  - `k1a 0b1` → 200 with `country: "CA"`;
  - well-formed unknown → 200 `{ found: false }`;
  - `postal_code` missing or `"12"` → 400;
  - `lookupPostalCode` throwing → 503 `upstream_unavailable`, and the logger's error call's arguments do not contain the code;
  - no device credential → 401, as `deviceAuth` answers today.
- [ ] **Step 3: Run** `pnpm test src/routes/geo.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `geo.ts`: `router.get("/postal-code", deviceAuth, postalLimiter, handler)`. The handler validates with a zod string schema (1–12 chars). `normalizePostalCode` null → 400 via `badRequest`. Otherwise it runs `lookupPostalCode` inside try/catch: the catch logs `"postal table unavailable"` with the error kind only and answers 503 in `sendApiError`'s `upstream_unavailable` shape. Responses set `Cache-Control: private, max-age=86400`. Mount it in `app.ts`. Add the OpenAPI entry; its description says unknown codes are 200 `found: false` on purpose (CrowdSec `http-probing` bans on 404s). Add the CLAUDE.md section and a CHANGELOG `Added` entry naming app ZIP search as the client.
- [ ] **Step 5: Run** `pnpm test`, `pnpm typecheck`, `pnpm exec eslint src/routes/geo.ts src/routes/geo.test.ts src/app.ts src/openapi.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `✨ feat(geo): GET /geo/postal-code, a ZIP or postal code to its point`.

## Release (Jenova's, not a task)

1. API: deploy; spot-check `10001`, `90210`, `K1A 0B1`, `M5V` and an unknown code against production.
2. App: OTA via `npm run update` (no `runtimeVersion` bump: no native change). Manual ingest stays on HOLD per CLAUDE.md.
