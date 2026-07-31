# Tips System — Design Spec

**Date:** 2026-07-31
**Status:** Approved design, pre-implementation
**Scope:** App-side implementation + the server API contract the app requires.
Server implementation itself is API-repo work and is out of scope here.

## Summary

A unified "tips" framework for user education and encouragement. One tip
model, multiple types (encouragement, how-to, habit nudge, thank-you),
multiple delivery channels (Home slots, inline cards, push notifications).
Replaces the hardcoded `HELP_CARDS` Getting Started stack on Home, turns
Home into a pure dashboard, adds a Getting Started screen, per-feed push
subscriptions (JFT, SPAD, AA sayings, …), a notification inbox, and
client-computed habit nudges.

Everything is JS-only. **No `runtimeVersion` bump at any phase** —
`expo-notifications` and `expo-web-browser` are already in the native build.

## 1. Vocabulary & Model

A **tip** is the atomic unit. Type and channel are orthogonal — the server
decides delivery per tip, and future types reuse existing channels with no
new plumbing.

```ts
interface Tip {
  id: string                 // stable, never reused; dismissal keys off this
  type: "encouragement" | "howto" | "nudge" | "thankyou"
  placement: string          // which client surface renders it (see §3)
  priority: number           // ordering within a placement (higher first)
  title: string              // ALREADY LOCALIZED by the server
  body: string
  action?: { url: string } | { tab: string; params?: Record<string, string> }
}
```

**Channels:**

| Channel | Surfaces |
|---|---|
| home slot | Encouragement slot, Tip-of-the-Day slot on Home |
| inline | Dismissible `TipCard`s on a screen; Getting Started page |
| push | Expo push (server-originated) or local scheduled (habit nudges) |

**Two pipelines, never reconciled:**

- **Content pipeline (pull):** app fetches localized tips from `GET /tips`
  for all on-screen surfaces.
- **Doorbell pipeline (push):** server-originated notifications carrying
  final display text plus a URL. Tap → app opens →
  `openLinkInBrowser(url)`. Missed pushes are NOT re-delivered into any
  on-screen tip surface — but every server-sent notification lands in the
  inbox (§6), so "missed" only means the banner, never the content.

There is deliberately **no "pending tips" reconciliation** between the two
pipelines. Slots and inline surfaces render whatever `/tips` returns; the
inbox renders whatever `/notifications` returns; push is ephemeral.

## 2. Server API Contract

The app requires these endpoints. All content arrives **already localized**
— final strings, never i18n keys. Rationale: keys over the wire give
version skew (a client without the key renders a blank/raw string) AND no
compile-time safety (TxKeyPath can't check runtime strings) — the worst of
both worlds. Localized text enables instant publishing, server-side
scheduling/rotation/retraction, and new locales without app releases.

There is no English-first fallback tier: a tip is not served in a locale
until its translation exists. (Server-side authoring flow composes and
translates before publishing.)

| Endpoint | Purpose |
|---|---|
| `GET /tips?lang=<code>&fellowship=<f>` | All active tips for this user, localized. Server performs daily rotation: for `encouragement` and `tip-of-day` placements it returns *today's pick only* — the client has zero rotation logic. |
| `GET /notifications` | Inbox records: `{ id, type, title, body, url, sentAt, readAt }`, reverse-chron, localized at send time. Retention: 90 days or 100 items, whichever is smaller. |
| `PATCH /notifications/read` | Body selects one id or `all`. Sets `readAt`. |
| `GET /notification-feeds` | Available daily feeds + this user's subscription state. Drives the Settings toggles, so new feeds appear without app changes. |
| `PUT /notification-feeds` | Update this user's subscriptions. |

**Fellowship privacy:** `fellowship` is passed as a query param on the
authenticated `/tips` request **only** so the server can filter
encouragement content. The server MUST NOT store it. This preserves the
existing posture where fellowship lives in volatile/encrypted local storage
and never in a server profile. Subscribing to a fellowship-specific feed
(e.g. JFT) is an explicit, user-chosen disclosure — privacy copy in the
Settings section says so in one sentence.

**Push payloads** carry final display text (`title`, `body`) plus
`{ url, notificationId }` data. The OS renders banners without running the
app, so localization must happen server-side at send time. Broadcast =
group token records by `language` → render per group → send N batches;
identical code path to a single targeted send. Server falls back to English
for token records with missing/unsupported language (see §7).

## 3. Client Surfaces

### Home = pure dashboard

The Getting Started card stack is **deleted from Home**. Home keeps: news
card, clean time, recovery chart, money saved, 90-in-90 — untouched, no
layout changes — plus:

- **Header additions:** a `?` icon (→ Getting Started screen) and a bell
  icon with unread-count badge (→ Inbox screen). Quiet, additive; the
  header currently holds only the title.
- **Encouragement slot** — single card, fellowship-appropriate saying from
  `/tips` (`placement: "encouragement"`). If the response contains none,
  the slot does not render.
- **Tip of the Day slot** — same mechanics (`placement: "tip-of-day"`,
  type `howto`).

### `<InlineTips placement="…" />`

One component, mounted per participating screen. Filters the fetched tip
list to its placement, drops dismissed ids, renders `TipCard`s.

`TipCard` is a generalization of today's `HelpCard`: same visual (icon,
title, body, optional glowing action button, dismiss X, slide-out
animation), but takes **plain strings** instead of `TxKeyPath` props, since
content arrives localized. `HelpCard` is deleted once nothing imports it.

**Launch placement vocabulary** (a client-side contract — the server can
send new placement strings, but they do nothing until an OTA mounts a
surface for them):

`getting-started` · `home` · `meetings` · `attendance` · `settings` ·
`encouragement` · `tip-of-day`

**Graceful degradation rules (hard requirements):**
- Unknown placement → tip silently ignored.
- Unknown `action.tab` → card renders without its action button.
- Malformed tip record → skipped, logged, never crashes a surface.

**Cadence:**
- `getting-started`: stack all undismissed cards (it's a dedicated page).
- Every other inline placement: **one card at a time** — the
  highest-priority undismissed tip; dismissing it reveals the next on the
  next visit. Keeps tips humble on screens with real content above the fold.
- Slots are single-card by construction (server sends today's pick).

### Getting Started screen

App-stack modal (same pattern as Licenses/Import). Renders
`<InlineTips placement="getting-started" />` as a scrollable page.
Reachable from the Home `?` icon and a Settings row.

**New installs:** navigated here once, immediately post-onboarding, with an
obvious "Go to my dashboard →" exit. One MMKV flag
(`gettingStartedShown`). Existing users (onboarding already complete) are
never auto-navigated.

### Inbox screen

App-stack modal. Reverse-chron list from `GET /notifications`; unread rows
visually distinct; **mark-all-read** in the header. Tapping a row marks it
read and opens its `url` via `openLinkInBrowser` — the identical code path
a push tap uses (which also marks its record read via `notificationId` in
the push data, so the badge never nags about an already-opened
notification).

### Rejected alternative: gesture-hub navigation

A 5-way swipe hub (center dashboard; swipe up/down/left/right to Getting
Started / in-person / live / listings) was considered and **rejected**:
every edge collides with reserved OS gestures (Android gesture-nav back on
both edges, iOS back-swipe, notification shade, home indicator,
pull-to-refresh, scroll), invisible navigation is anti-discovery in a
feature that exists to fix a discovery problem, it duplicates the tab bar
(which must remain for accessibility), and spatial gesture paradigms fit
high-frequency social apps, not a recovery app whose users may be in
crisis. A bottom-sheet "Getting Started ⌃" handle on Home is deferred until
the `?` icon proves too quiet.

## 4. Client State & Data

### TipsStore (new MST store)

- Props: `tips[]` (last-good `/tips` payload), `unreadCount`,
  `lastFetchedAt`.
- Actions: `fetchTips()`, `fetchUnreadCount()`, `markRead(id | "all")`.
- Fetch on cold start + app foreground, throttled (~15 min).
- **Persistence:** last-good `/tips` payload cached in MMKV so offline and
  first-frame renders come from cache. (Tip content is not sensitive — the
  ConfigStore no-persist rule does not apply.) Before the first-ever
  successful fetch, slots simply don't render.

### Bundled fallback

The current 8 `HELP_CARDS` (already translated in all 9 locales via the
existing i18n bundles) remain bundled as the permanent floor for
`getting-started`. At launch the API serves those same ids; the API
response **overrides/extends the bundle by id**. Getting Started is never
empty — offline, first launch, API down, maintenance. Rotating slots
(`encouragement`, `tip-of-day`) are API-only with no fallback: absent →
not rendered.

### Dismissal

- `profileStore.dismissedHomeCards` → **renamed `dismissedTips`** (MMKV,
  client-side only). Migration: carry existing values over in the rename.
- Cross-device dismissal sync is deliberately out of scope — re-dismissing
  a few cards on a new phone is an acceptable cost; server round-trips for
  disposable hint cards are not.
- **Pruning:** ids present in `dismissedTips` but absent from the latest
  successful `/tips` response (and not in the bundle) are removed, so the
  list cannot grow forever as tips are retired.
- **Hard requirement:** launch API content for the migrated Getting Started
  tips reuses the existing ids (`"live"`, `"settings"`, `"resources"`,
  `"support"`, `"attendance"`, `"favorites"`, `"ratings"`, `"rate-app"`) so
  nothing a user already dismissed ever resurrects.

### Gating

- All tip/inbox fetches early-return when `configStore.maintenanceMode` is
  true and render from cache; they never gate the navigator (per the
  Maintenance Mode rules in CLAUDE.md).
- Attendance-placement tips additionally respect
  `profileStore.attendanceEnabled`.

## 5. Notification Subscriptions & Settings

Three-layer gate, evaluated top-down:

1. **OS permission** (exists, unchanged — no new prompt).
2. **`notificationsEnabled` master toggle** (exists, ProfileStore/MMKV).
3. **Per-feed subscriptions** (new): Settings gains a section listing
   available daily feeds (from `GET /notification-feeds`) with toggles,
   plus a "progress reminders" toggle for local habit nudges (§6).

Global/thank-you pushes ride the master toggle only. Daily feeds require
their own explicit opt-in. The server sends a feed only to subscribers, in
each token record's language.

## 6. Habit Nudges (client-derived)

Computed entirely on-device from local data (attendance SQLite, clean
date, 90-in-90 progress). **The server never sees the inputs** — attendance
and recovery dates are local/encrypted and stay that way.

- Delivered as **locally-scheduled notifications**
  (`expo-notifications` local scheduling). No server round-trip.
- Predicates evaluated on app foreground/background transitions.
- Each nudge type has a **cooldown** (no repeat within N days) persisted in
  MMKV.
- Gated on OS permission + master toggle + the "progress reminders"
  Settings toggle.
- **Tone rule:** encourage, never scold. ("3 more meetings to 90-in-90" —
  yes. Guilt framing — no. Copy reviewed against this bar.)
- **Accepted asymmetry:** local nudges do NOT appear in the inbox (the
  server never knew about them). Re-read value is negligible; accepted to
  keep the inbox purely server-sourced.

Nudge copy is client-side and therefore localized via the **existing i18n
bundles** (the one tip surface that uses `TxKeyPath`, because the content
ships with the app by necessity).

## 7. Prerequisite Fix — push-token language sync (ships first, own commit)

`app/app.tsx` wires `setNotificationLanguage` behind a MobX `reaction` on
`profileStore.language`, which **only fires on change** — and
`upsertToken()` includes `language` only via `overrides`
(`expoNotificationService.ts`). Net effect: any user who never touches the
language picker has **no language on their token record** — i.e. nearly
everyone, including users whose device has been non-English from first
launch. Localized broadcast would silently degrade to
English-for-almost-everyone.

**Fix:** include the current i18n locale in the base `upsertToken()`
payload so every registration/upsert carries it. Server treats
missing/unsupported language as English (stale records linger until each
device next upserts). JS-only, OTA-able, and lands before Phase 3.

## 8. Migration & Rollout Phases

Each phase independently shippable as an OTA:

| Phase | Contents | API dependency |
|---|---|---|
| **1. Framework** | `TipCard`, `<InlineTips>`, `TipsStore` (bundle-backed), Getting Started screen + post-onboarding default, Home cleanup + `?` icon, `dismissedTips` rename/migration, one-time "Getting Started moved" pointer via existing `AnnouncementGate` | none |
| **2. Content API** | `/tips` wired: Home slots appear, inline/getting-started go server-driven, bundle demotes to fallback | `GET /tips` |
| **3. Push feeds + inbox** | Settings subscriptions UI, inbox screen, bell + badge, push-tap → mark-read → browser | `/notifications`, `/notification-feeds`, server send pipeline; §7 fix live |
| **4. Habit nudges** | local predicates, scheduling, cooldowns, settings toggle | none |

**Existing-user impact audit:** the bottom-of-Home Getting Started stack
disappears (most active users already dismissed it) and is replaced by a
one-time pointer announcement; everything else is additive (new header
icons, new opt-in surfaces). No flow changes, no moved buttons, no new
permission prompts, dismissed state preserved by id. Tab bar and all
existing screens are pixel-identical unless/until a tip is authored for
their placement.

## 9. Testing

Per the vitest constraint (no `@/` alias resolution), all testable logic is
extracted into pure modules with zero `@/` runtime imports (type-only OK),
mirroring the `syncLogic.ts` pattern:

**Unit (vitest):**
- placement filtering + priority selection + one-at-a-time cadence
- dismissal pruning (incl. bundle-protected ids)
- bundle/API merge-by-id
- unknown placement / unknown action.tab / malformed record tolerance
- nudge predicates + cooldown arithmetic

**Manual checklist** (fetch orchestration, navigation, push — documented
alongside the code, `docs/BACKUP.md` pattern):
- offline cold start (cache render, no blank Home)
- maintenance mode (fetch gated, cached content still renders)
- push tap from killed state → browser opens, record marked read
- badge consistency across two devices (server read-state)
- new-install → onboarding → Getting Started default → dashboard exit
- dismissal persistence across relaunch

**Maestro:** Getting Started flow + dismissal persistence.

## 10. Explicitly Out of Scope

- Cross-device dismissal sync
- In-app long-form reading surface (push content lives at URLs; the web
  page owns localization and keeps fellowship literature off the app —
  no reprint/copyright exposure)
- Server-side storage of fellowship
- Silent/background push (`content-available`) — iOS throttling makes it
  unreliable; never build on it
- CMS/authoring/translation tooling (API-repo concern)
- Gesture-hub navigation (rejected, §3); bottom-sheet handle deferred
- Client-written inbox entries for local nudges (§6, accepted asymmetry)
