# Meetings filter bar + Live "Starts In" — design

Date: 2026-09-26
Status: approved in brainstorming, awaiting written-spec review
Scope: app repo only. The `/schedules/at_next` endpoint is built separately in
the api repo; this spec records the contract the app codes against.

## Goal

1. Fellowship and Language are filters that apply to all three Meetings
   segments (Live | In-Person | Search). Move them out of the individual
   segments into one shared bar above the segmented control. One value per
   filter, shared across segments, remembered across restarts.
2. Give Live a **Starts In** selector (`Live · 15 · 30 · 45 · 60`) that lists
   online meetings starting within the chosen number of minutes, served by a
   new API call.

## Current state (what changes)

| Segment   | Fellowship today                                                                                   | Language today                       |
|-----------|----------------------------------------------------------------------------------------------------|--------------------------------------|
| Live      | Local browse override seeded from `profileStore.fellowship`; client-side filter; resets on `preferences_changed` | none                                 |
| In-Person | `fellowshipOverride ?? savedFellowship` inside `useNearbySchedules`; server fetch param           | none                                 |
| Search    | **Writes `profileStore.fellowship` directly** — silently changes the Settings preference          | local `useState`, not persisted, "All" default |

No segment offers a Fellowship "All": In-Person and Search send fellowship as a
server fetch param, and "All" would mean an unfiltered fetch of every
fellowship. That stays true in the bar.

## Decisions

- **Browse selection, remembered.** The bar owns its own Fellowship and Lang
  values, persisted in MMKV. Fellowship is seeded from Settings on first use and
  never written back to `profileStore.fellowship`.
- **Follows Settings.** A fellowship change made in Settings (or Onboarding)
  replaces the bar's Fellowship.
- **Search stops rewriting Settings.** Its fellowship now comes from the bar.
- **Starts In replaces the list, it doesn't add to it.** `Live` (default) is
  today's in-progress list; `15/30/45/60` shows only meetings starting within
  that many minutes.
- **Starts In resets to `Live` on every visit** — it answers a right-now
  question, same reasoning as In-Person's non-persisted Time filter.
- **Starts In ships hidden** until the API route is deployed.

## Architecture

### `app/utils/meetingFiltersLogic.ts` (pure, vitest-covered)

No runtime `@/` imports (see CLAUDE.md "Test Runner Split").

- `LANGUAGE_DISPLAY_NAMES` + `getLanguageDisplayName(code)` — moved verbatim
  from `ListingsScreen.tsx`. Unknown codes fall through to the raw code.
- `resolveInitialFellowship({ persisted, saved, active })` — persisted value if
  it is still in `active` (`ACTIVE_FELLOWSHIPS`), else `saved` if in `active`,
  else `active[0]`. Guards against a build that dropped a fellowship the user
  had persisted.
- `resolveInitialLanguage(persisted)` — uppercase ISO 639-1 code or `null`
  (= all languages).
- `buildLanguageOptions(meetings, selected)` — sorted unique uppercase codes
  from `meeting.language`, always including `selected` when non-null so the
  current choice is visible and clearable even when absent from the list.
- `matchesLanguage(meeting, selected)` — `null` matches everything;
  comparison is case-insensitive.

### `app/context/MeetingFiltersContext.tsx`

Provider mounted by `MeetingsScreen` around the bar and the three segment
views. Exposes `{ fellowship, language, setFellowship, setLanguage }`.

- MMKV keys `meetings.fellowship` and `meetings.language` via
  `@/utils/storage` (`loadString` / `saveString`), same class as
  `inperson.radius`.
- **Follows Settings via `liveEvents` `preferences_changed`**, emitted by
  `ProfileStore.setFellowship()`. It must NOT be a MobX reaction on
  `profileStore.fellowship`: that field is volatile and hydrated from encrypted
  SQLite by `ProfileHydrator` on every cold start, so a reaction would fire on
  hydration and overwrite the remembered bar value at each launch — the
  opposite of "remembered". Comment this at the subscription.
- On `preferences_changed` the provider adopts `profileStore.fellowship` and
  persists it. Language is untouched (Settings language is UI language, not a
  meeting filter).

### `app/components/MeetingFilterBar.tsx` (presentational, jest-covered)

Props in, callbacks out — no store or context reads, so its test mounts it
bare (the `PermissionsSection` pattern). Two selector cells side by side,
`Fellowship | Lang`, reusing the existing selector-cell + modal chrome. Lang's
modal leads with "All languages". Cell labels use native display names, and
accessibility labels announce label + current value.

`MeetingsScreen` renders it above `SegmentedControl` and feeds it:
- fellowship options: `ACTIVE_FELLOWSHIPS`
- language options: `buildLanguageOptions()` over the **active segment's**
  loaded meetings. Each segment reports its current post-fetch list (before
  the language filter) through the context's
  `reportMeetings(segment, meetings)`; `MeetingsScreen` picks the active
  segment's list. The bar never fetches anything itself.

### Segment changes

- **Live (`LiveScreen.tsx`)**: remove the fellowship selector row and its
  modal; read fellowship + language from context; filter
  `fellowship === ctx.fellowship && matchesLanguage(...)`. Remove the local
  `filterFellowship` state and its `preferences_changed` reset (the context
  owns that now; keep the `refresh()` on that event). Add the Starts In chips
  (below). Gains a `visible` prop from `MeetingsScreen`.
- **In-Person (`InPersonScreen.tsx`, `useNearbySchedules.ts`)**: remove the
  fellowship cell and `FellowshipSelectorModal`. `useNearbySchedules` takes
  `fellowship` as an input; `fellowshipOverride`, `setFellowshipOverride` and
  the `savedFellowship` reset effect go (their job moved to the context —
  update the header comments). Apply `matchesLanguage` client-side to the
  fetched day. Fellowship stays a server fetch param.
- **Search (`ListingsScreen.tsx`)**: remove the Fellowship and Lang cells and
  both modals; grid becomes Venue / Radius / Day / Time (2×2 — update the
  cell-order comment block ~L947). Fetch uses `ctx.fellowship` instead of
  `profileStore.fellowship`; language filter reads `ctx.language`. It no
  longer calls `profileStore.setFellowship`.

### Empty state for a stale language

If the selected language has no meetings in the current list, the segment's
empty state says so ("No {language} meetings") and offers a **Show all
languages** button that sets language to `null`. The option is never silently
dropped.

## Starts In (Live)

### API contract (built in the api repo)

```
GET /schedules/at_next?offset=30&starts_at=2026-09-26T19:08:00-07:00&tz=America/Los_Angeles&venueType=online
Auth: device auth, same as /schedules/live (goes through the token freshness gate)
Query params (all URL params, no body):
  offset        15 | 30 | 45 | 60
  starts_at     ISO 8601, device "now" truncated to the minute
  tz            IANA, Intl.DateTimeFormat().resolvedOptions().timeZone
  venueType     "online"
  periodicities optional, same semantics as /schedules/live
  fellowship    optional, same semantics as /schedules/live; the app does not send it
Response: same shape as GET /schedules/live —
  { timestamp, count, schedules: [{ sid, meeting, millis, duration_ms, continuous, data }] }
  where `millis` is the meeting's upcoming start (UTC ms).
```

The API owns the interpretation of `offset` + `starts_at`. The app sends
`starts_at` as its reference time and does no window math beyond pruning
(below). Fellowship is not sent so bar changes filter instantly on-device
without a refetch, matching Live.

**Clarification (review round 1, 2026-09-26):** the example URL above uses a
local-offset timestamp (`19:08:00-07:00`), but the shipped client
(`atNextLogic.buildStartsAt()`) actually sends `starts_at` as **UTC** ISO 8601
with a trailing `Z` (`Date.toISOString()`), with `tz` alongside for the API's
local-day interpretation. The API must accept the `Z` form — the example
above is illustrative of the format family, not the literal wire value.

**SUPERSEDED 2026-09-27 — the deployed contract** (api repo `src/openapi.ts`,
operationId `getAtNextSchedules`, commit 583b2fa) differs from the draft above,
and the app now follows it:

```
GET /schedules/at-next?offset=30&starts_at=true&venueType=online
  offset        15 | 30 | 45 | 60 — picks ONE quarter-hour mark: 15 is the next
                :00/:15/:30/:45 strictly after now; 30/45/60 are 15/30/45 min
                past it (at 12:06, 30 → 12:30; at 12:20, 30 → 12:45)
  starts_at     boolean, default true — true: only meetings starting exactly at
                the mark (CONTINUOUS excluded); false: everything in session then.
                The app sends `true` explicitly.
  venueType     "online"
  periodicities / fellowship  optional, as /schedules/live; the app sends neither
  (no `tz` param)
Response: the /schedules/live shape plus the mark —
  { timestamp, at, offset, count, schedules: [...] }   `at` = ISO mark answered for
Errors: 400 bad offset / non-boolean starts_at, 401, 500 (404 = older API build)
```

Consequences in the app: "Starts In 30" means *starting at the mark after
next*, so the list is labelled with `at` ("starting at 7:30p", empty state "No
meetings starting at 7:30p"); rows all share one start, so they are ranked by
feedback like Live rather than start-sorted; and because the server recomputes
every offset's mark at each quarter-hour boundary, the hook refetches once just
after the next boundary (`at` for offset 15, `at − (offset − 15) min` for
30/45/60) instead of every 5 min. `buildStartsAt` and `sortByStart` were
removed. Known gap: meetings starting off the quarter hour (7:05, 7:10…) never
appear under any Starts In option, because `starts_at=true` matches the mark
exactly.

**CHANGED 2026-09-27 (Jenova):** the control is "[Live Now] Starts in
[15m|30m|45m|60m]". The app prefetches all four offsets while Live is on
screen and shows only the chips whose list is non-empty after the shared
Fellowship + Lang filters; the control hides when none are, and a selected chip
that empties falls back to Live Now. Screen readers hear "Starts in 30
minutes". This supersedes the always-visible chips and the per-selection fetch
above.

### `api.getAtNextSchedules({ offset })` — `app/services/api/index.ts`

GET with the query params above (apisauce `get(url, params)`, like `getLiveSchedules`); `offset` typed as the `15|30|45|60` union. Returns
`{ kind: "ok"; schedules: LiveSchedule[]; count } | GeneralApiProblem`, the
same union as `getLiveSchedules`. Results go through `projectOnline()`.

### `app/utils/atNextLogic.ts` (pure, vitest-covered)

- `START_IN_OPTIONS = ["live", 15, 30, 45, 60] as const`
- `buildStartsAt(now: Date): string` — ISO, seconds/ms zeroed.
- `pruneStarted(entries, nowMs)` — drops entries whose `millis <= nowMs`.
- `sortByStart(entries)` — ascending `millis`.
- `classifyAtNextProblem(kind)` → `"hide-for-session"` (not-found),
  `"retryable"` (per `isRetryableProblem`), `"show-error"` (everything else).

### `app/hooks/useAtNextSchedules.ts`

`useAtNextSchedules(offset: StartsIn, visible: boolean)`, separate from
`MeetingContext` so the in-progress Live pipeline is untouched.

- Fetch when `offset !== "live"` and `visible`: on selection, on
  pull-to-refresh, and every **5 min** while both hold.
- A 60 s tick applies `pruneStarted` between fetches so a 15-min list never
  shows a meeting that already began.
- Transport failures retry through `isRetryableProblem()`
  (`contentRetryLogic.ts`); a 401/403/404/429 ends on the first answer.
- A failed fetch keeps the last list and surfaces an inline
  "Couldn't load — tap to retry".
- **404 → endpoint not deployed:** hide the chips for the session and fall
  back to `live`, so a flag flipped before the API deploy degrades cleanly.
- Blocked while `isLiveRefreshBlocked()` (maintenance or outage): chips
  disabled, view on `live`.

### `StartsInChips` component (presentational, jest-covered)

Compact one-tap chip row `Live · 15 · 30 · 45 · 60` in the slot the Live
fellowship row used to occupy. `accessibilityRole="button"`,
`accessibilityState={{ selected, disabled }}`, labels like "Starts in 30
minutes".

### Reset rule

`LiveContent` resets Starts In to `live` on the false→true edge of its new
`visible` prop (per-visit ref), covering both segment switches and returning
to the Meetings tab. Keyed on the edge, never on a store value — see CLAUDE.md
"The trap, hit twice".

### Visibility flag

`const startsInVisible = __DEV__` in `LiveScreen.tsx`, the same pattern as
`agentTabVisible`, with a comment naming the api route it waits on. Flipping
it to `true` after the API deploy is a JS-only OTA — no `runtimeVersion` bump.

### Rows

At-next rows render through `MeetingRow` unchanged, sorted by start time. If
`MeetingRow` needs a "starts at 7:30 PM" line, add it as data-driven chrome
(renders when a start time is present), not a mode branch — see the
`MeetingRow` note in CLAUDE.md.

## Analytics

- `meetings_fellowship_changed { fellowship }`
- `meetings_language_changed { language | "all" }`
- `live_starts_in_changed { offset }`

These replace `listings_fellowship_changed` / `listings_language_changed`.

## i18n

New keys in all nine locale files (English placeholder text in the other
eight is fine; the key must exist or `tsc` fails): Starts In label, the chip
labels / a11y labels, "No {language} meetings", "Show all languages",
"Couldn't load — tap to retry". Reuse existing `listingsScreen:langLabel`,
`allLanguages`, `selectLanguage` where they fit, or move them to a
`meetingsScreen:` namespace if that reads better.

## Testing

**Vitest**
- `meetingFiltersLogic.test.ts`: initial-value precedence (persisted → saved →
  first active); stale persisted fellowship not in the active list; option
  list from meetings with the selection always kept; display-name fallback;
  case-insensitive match; `null` matches all.
- `atNextLogic.test.ts`: `buildStartsAt` truncation; prune boundary
  (`millis === now` pruned); ascending sort; problem classification.

**Jest**
- `MeetingFilterBar.test.tsx`: both cells render; a11y labels carry current
  values; "All languages" only on Lang; taps call the right callbacks.
- `StartsInChips.test.tsx`: selected chip's `accessibilityState.selected`;
  disabled state blocks taps.

**Manual checklist** (no CI runs any of this)
- [ ] Fellowship and Lang carry across Live / In-Person / Search.
- [ ] Both survive a cold start.
- [ ] Changing fellowship in Settings moves the bar; a cold start does not.
- [ ] Choosing a fellowship in the bar leaves Settings unchanged.
- [ ] Stale language → empty state → "Show all languages" works.
- [ ] Starts In resets to Live on segment switch and on returning to the tab.
- [ ] Against an API without the route: chips hide, view stays on Live.
- [ ] Maintenance banner on → chips disabled.
- [ ] VoiceOver and TalkBack pass on the bar and chips.
- [ ] Cold start → Settings → change fellowship → first open of Meetings
  shows the new fellowship. (review round 1, 2026-09-26: this used to be
  lost when Settings was reached before Meetings ever mounted — see
  MeetingFiltersContext.tsx's module-scope `preferences_changed` subscriber.)

## Docs & release

- `CHANGELOG.md` `[Unreleased]`: **Changed** — Fellowship and Language
  filters moved to a shared bar above the Meetings segments and remembered
  across restarts; **Fixed** — changing fellowship in Search no longer changes
  the Settings fellowship; **Added** — Language filter on Live and In-Person;
  Starts In on Live (dev builds only until the API ships).
- CLAUDE.md "Navigation": describe the bar, `MeetingFiltersContext`, and the
  `preferences_changed`-not-reaction rule.
- JS-only: no `runtimeVersion` bump.

## Out of scope

- Building `/schedules/at_next` (api repo).
- Persisting Starts In.
- A Fellowship "All" option.

## Appendix: CLAUDE.md history (moved 2026-09-27)

This is the "Meetings tab segments + Shared filter bar" text from `CLAUDE.md` exactly as it read before it was cut down to current-state rules. It is kept here so the reasoning and change log are not lost.

**Meetings tab segments** (`MeetingsScreen.tsx`): three segments — Online | In-Person | Search, segment keys `live` / `inperson` / `listings`. "Online" is a label-only rename of Live (2026-09-27; key still `live`), and the Live screen's heading follows the Starts In pick: "Live Now" for Live Now, "Starts in 30m" for a minute chip. A minute pick remembers the mark it was made for; once that mark moves (quarter-hour refetch, return from background) it follows its meetings to whichever visible chip now shows that mark (60m's 13:00 becomes 45m at 12:15), then to the lowest visible chip once the mark has passed or its chip is hidden, and to Live Now only when no chip is left (`followStartsIn`). While a batch is loading the pick and chips hold still and the list shows a spinner; a chip tapped mid-batch adopts the mark the batch lands with rather than being moved. "Search" is a label-only rename of the old Listings segment (the key is still `listings`; only the i18n label changed). `MeetingsScreen` is the segmented-control shell; each segment's content is a named export from its own screen file — `LiveContent` (`LiveScreen.tsx`), `InPersonContent` (`InPersonScreen.tsx`), `ListingsContent` (`ListingsScreen.tsx`). All three mount from app start; inactive ones are hidden with `display: "none"`, not unmounted.

**Shared filter bar** (ADDED 2026-09-26): Fellowship and Lang live in
`MeetingFilterBar` directly below the segmented control (moved there 2026-09-27), not inside any segment. State
is `MeetingFiltersContext` (owned by `MeetingsScreen`, MMKV keys
`meetings.fellowship` / `meetings.language`, pure decisions in
`meetingFiltersLogic.ts`). It is a browse selection and never writes
`profileStore.fellowship`. It follows Settings through the `preferences_changed`
event, **not** a MobX reaction: hydration assigns `profileStore.fellowship` on
every cold start and a reaction would wipe the remembered pick. Segments report
their loaded list via `reportMeetings()` so the Lang picker offers the active
segment's languages. Each segment's language empty state ("Show all
languages") must be checked ahead of that segment's other catch-all empty
branches (time-bucket, nearby/fallback, etc.) or it never renders — hit once on
In-Person. Live's **Starts In** pill (`useAtNextSchedules`, `atNextLogic.ts`,
`GET /schedules/at-next`) resets to Live on the segment's hide edge (leaving
Live via a segment switch or leaving the Meetings tab), not the show edge —
`useAtNextSchedules`'s effects run before `LiveScreen`'s reset effect in the
same commit, so a show-edge reset fired one wasted `at_next` request per
revisit; the user-visible rule is still "resets to Live on every visit". It is
gated by `startsInVisible` in `LiveScreen.tsx` until the API route is deployed.
A failed `at_next` refresh keeps the last-loaded list rather than blanking it,
surfacing an inline tap-to-retry instead (empty-list branch or a banner over
kept rows). CHANGED 2026-09-26 (review round 1): `useAtNextSchedules`'s 5-min
refetch and 60 s prune tick now pause while `AppState` isn't `"active"`
(Android keeps JS timers firing in the background) and resume with one
immediate refetch on the background→active edge — this does not reset Starts
In, which stays a per-segment-visit concern owned by `LiveScreen`.
CHANGED 2026-09-27: aligned with the deployed API contract (api repo
`src/openapi.ts`): the route is hyphenated `/schedules/at-next`, `offset`
picks ONE coming quarter-hour mark (not a window), `starts_at` is a boolean
the app sends as `true` (only meetings starting exactly at the mark), and the
response's `at` names that mark. So the list is labelled "starting at 7:30p",
rows are feedback-ranked like Live, and the hook refetches once just after the
next quarter-hour boundary — `at` for offset 15 but `at − (offset − 15) min`
for 30/45/60, because the server recomputes every mark at each boundary
(`refetchDelayMs`, with a 60 s floor for a device clock running ahead of the
API) — instead of every 5 min. Meetings starting off the quarter hour (7:05…)
never appear under Starts In; that's the contract, not a bug.
CHANGED 2026-09-27 (later): the control reads "[Live Now] Starts in
[15m|30m|45m|60m]" and `useAtNextSchedules(active)` now prefetches all four
offsets in one parallel batch (on showing Live, on foreground, after each
boundary, on pull-to-refresh) — picking a chip only chooses a slot. Chips with
no meetings after the shared Fellowship + Lang filters are hidden
(`availableStartsIn`), the whole control hides when none have any, and a pick
whose chip empties falls back to Live Now (`resolveStartsIn`). That's four
requests per quarter hour while Live is on screen (usually cache hits
server-side; the first request after a boundary for a newly-due mark can be a
cache miss that builds it). Hardening (review, same day): the refetch timer
takes the LATEST boundary across slots so a failed slot's stale mark can't
turn it into a 60 s poll; a failed slot keeps its rows only until its own
boundary passes; an all-failed batch retries at the next clock quarter-hour;
pull-to-refresh in Live Now refreshes the Starts In batch too; hiding Live
abandons an in-flight batch's retries; and rows are pruned with a ~10 s grace
so the minute tick can't empty the selected chip just before its refetch.
Spec: `docs/superpowers/specs/2026-09-26-meetings-filter-bar-and-starts-in-design.md`.
