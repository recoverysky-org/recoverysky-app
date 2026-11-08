# The RecoverySky User's Manual: a RAG corpus so Sky knows her own app

Status (2026-11-08): In progress. The skeleton merged in `50e24f2` (first in v4.12.0) and 12 pages are written; the rest is TODO.md "Finish the user's manual". The production ingest is on HOLD (CLAUDE.md "Releasing").

Status when written: design approved in conversation 2026-10-12 (Jenova); spec awaiting review. No code yet.
Spans two repos: the corpus and its discipline live here (app), the ingest, store, tools and
prompt change live in `../agent`. The implementation plan splits its tasks by repo.

## Why

Sky (the Agent tab) runs inside RecoverySky but knows nothing about it. Her prompt describes
recovery support, meeting search and literature; nothing tells her that the app has an
Attendance tab, what Premium unlocks, that Android has a guest mode, or that cloud backup moves
attendance and nothing else. Asked "how do I send my PO a report?", she can only guess, and a
guess from a confident assistant is worse than "I don't know".

This spec gives her a user's manual: a Markdown corpus in this repo, written in the voice of a
manual a person could read (nobody will; Sky is the reader), chunked into a Qdrant collection,
searched by two new tools, with a short always-on "what the app can do" map in her prompt so she
never has to search to know a feature exists.

The four jobs the manual must let Sky do, in order of how often users will ask:

1. **How-to and where-is.** "How do I email a report?" "Where do I change my fellowship?"
   Step-by-step, using the labels on screen.
2. **Troubleshooting.** "Why can't I see the Attendance tab?" "It says this phone belongs to a
   different account." Symptom-led, the way `docs/support/` already works.
3. **Features and tiers.** "What does Premium get me?" "Is my attendance private?" What exists,
   what it costs, what stays on the phone.
4. **Hand-off.** Knowing when she can't fix it and sending the user to support with the right
   words instead of improvising.

## Decisions already made

| # | Decision | Why |
| --- | --- | --- |
| D1 | Source of truth is `docs/manual/` in the **app** repo. | Behaviour changes happen here; CLAUDE.md can require the manual page in the same commit, as it does for `docs/support/`. |
| D2 | Retrieval is **hybrid RAG** (dense + BM25, RRF) over a `manual` Qdrant collection, plus a ~350-word **map** in the prompt. | A full manual is 25–40k words; in the prompt it would cost 30–50k tokens per turn and the chat route has no prompt caching. Hybrid search already exists for the `messages` layout. |
| D3 | Chunk text lives in the **Qdrant payload**; no Postgres tables. | The manual is small. Literature hydrates from Postgres because books are large and shared; the manual needs no migration. |
| D4 | The corpus is called the **manual**, never "guide". | `GET /api/v1/guides` and the `system_prompts` table already use "guide" for selectable system prompts. |
| D5 | English only. | Sky answers in the user's language from English sources; nine locales do not get nine manuals. |
| D6 | Describes the **current release**; "older versions" notes only where behaviour differs. | Same rule as `docs/support/`. |
| D7 | `docs/support/` stays the **staff** KB. Its `replies/` seed the manual's `account/*` pages and then become two-line pointers to them. `problems/` and `reference/` are untouched. | One home for user-facing wording. Staff detail (Auth0, Loki, Tempo) does not belong in a corpus Sky reads to users. |
| D8 | The manual uses **`support@recoverysky.app`** everywhere. | It is the address on every in-app string but one (the crash screen says `.org`). The copy drift is noted under "Out of scope", not fixed here. |
| D9 | Ingest runs **by hand** from a machine with both checkouts and the agent's `.env`, after a release that touched the manual is live. | The app repo's only workflow ignores `root`, and automation would need prod Qdrant plus an OpenAI key on the runner. Later, not now. |
| D10 | `backup-and-devices/` is the **first content area**, written with the skeleton. | `docs/BACKUP.md` makes it the cheapest area to write accurately, and it proves the pipeline end to end with real content. |

## 1. The corpus (`docs/manual/`)

### 1.1 Layout

One page per feature, grouped by area. Around 45 pages when complete, 25–35k words.

```
docs/manual/
  README.md            authoring rules (section 1.3); never ingested
  map.md               "What RecoverySky can do": the always-on prompt section (section 2.1)
  questions.yml        retrieval smoke test: user phrasing → expected page (section 3.4)
  getting-started/     install-and-zoom, sign-in, guest-mode, onboarding, import-from-old-app
  home/                clean-time, money-saved, recovery-chart, ninety-in-ninety, tips-and-news
  meetings/            online, starts-in, in-person, map-view, search, filters,
                       favorites-and-ratings, reminders, meeting-details, joining-with-zoom
  attendance/          tracking, timer, im-here, editing-and-archive, reports, certificate
  settings/            profile, recovery, attendance, app-settings, subscription, cloud-backup,
                       permissions, account, legal-and-support
  backup-and-devices/  cloud-backup, using-more-than-one-device, new-phone,
                       one-account-per-phone, if-backup-isnt-working
  account/             wrong-account, verify-email, mistyped-email, email-change-not-showing,
                       empty-account, forgot-password-or-old-app, signed-out, only-meetings-showing,
                       sign-in-hangs, delete-account, code-not-arriving, code-rejected
                       (one per docs/support problem; "data missing after new phone" maps to
                       backup-and-devices/new-phone instead)
  privacy/             your-data
  sky/                 about-sky
  status/              offline-and-maintenance, updates, platform-differences
```

Page names are the file names Sky sees as `page` (`backup-and-devices/new-phone`). They are
stable identifiers: renaming a page is a content change that `questions.yml` must follow.

`settings/cloud-backup` describes the Settings row and its statuses; `backup-and-devices/*`
describes the feature. Both exist on purpose: one answers "what is this switch", the other
answers "how do I move to a new phone". Each names the other by title.

### 1.2 Page template

Front-matter feeds the retrieval filters and the breadcrumb. The body has a fixed shape so every
page can serve all four jobs.

```markdown
---
title: Cloud Backup
area: settings
screen: Settings → Cloud Backup        # on-screen labels, verbatim from app/i18n/en.ts
platforms: [ios, android]              # omitted = [ios, android, web]
tier: attendance                       # free | attendance | premium: what you need to use it
aliases: [backup, sync, "new phone", "lost my records"]   # keyword fuel for the BM25 side
---
<!-- sources: app/screens/SettingsScreen.tsx, docs/BACKUP.md -->
One paragraph: what it is, in plain words.

## How to turn on Cloud Backup
Steps. The first sentence restates where you are, because this section is retrieved alone.

## What you'll see
Statuses, labels, limits.

## Good to know
Tier, platform differences, what it does NOT do.

## If something's wrong
Symptom → what to try → when to contact support.

## Questions people ask
**Q:** Will my favorites move to my new phone?
**A:** No. Only attendance records and the reports you've sent are backed up. …
```

Front-matter rules, enforced by the ingest's zod schema:

- `title` (string), `area` (one of `getting-started home meetings attendance settings
  backup-and-devices account privacy sky status`) and `screen` (string) are required.
- `platforms` is a subset of `[ios, android, web]`; omitted means all three. The ingest always
  writes the full list, so the tool's platform filter is a plain match.
- `tier` is one of `free | attendance | premium`; omitted means `free`.
- `aliases` is a list of strings; omitted means none.
- The `<!-- sources: … -->` comment is required, lists repo-relative paths, and every path must
  exist in the app checkout the ingest reads from. The ingest strips it before chunking.

### 1.3 Authoring rules (`docs/manual/README.md`)

These are the review checklist for every page. The README carries them verbatim.

1. **Second person, present tense, plain words.** "Tap Settings, then Cloud Backup."
2. **On-screen labels verbatim, in quotes,** taken from `app/i18n/en.ts`. If the screen says
   "Back up attendance", the manual never says "enable sync".
3. **No internal names.** No "ownership gate", "OTA", "MST", "entitlement", "runtime version",
   "attestation". If a concept needs a name, use the one the screen uses or describe it.
4. **Platform and tier stated inside the section where they differ**, not only in front-matter:
   "On Android, …", "This needs the Attendance subscription." A retrieved section stands alone.
5. **Say where data lives**: "stays on this phone", "in your backup", "never leaves the phone".
   This app's privacy posture is a feature; the manual states it precisely, never vaguely.
6. **No roadmap, no "coming soon", no "we plan to".** The manual describes what the installed
   app does today.
7. **Nothing that looks like real data**: no example email addresses that could be real, no
   account ids, no names. `you@example.com` is fine.
8. **Every claim is traceable** to a file in the page's `<!-- sources -->` line. A claim the
   reviewer cannot find in those sources is removed, not softened.
9. **The hand-off sentence is always the same**: "Contact support@recoverysky.app and mention
   [what to mention]." Never a different address, never "reach out to us".
10. **Honest edges.** Where the app cannot do something people expect (delete the cloud copy
    from inside the app, move favorites to a new phone), the manual says so plainly.
11. **A section is one H2 and at most 400 words.** H3s stay inside their H2. The intro paragraph
    before the first H2 is its own chunk. The ingest fails on a longer section; split it.
12. **"Questions people ask" is in the user's words**, the way the symptom table in
    `docs/support/README.md` is: "my favorites didn't move", not "favorites are device-local".
13. **At least three `questions.yml` entries per page**, in the user's words, and they must
    retrieve the page in the top three (section 3.4).

### 1.4 Chunk contract

What the ingest does with a page, so writers know what retrieval sees:

- One chunk per H2 section; the intro paragraph is chunk `0`.
- Chunk id is `${page}#${heading-slug}` (`backup-and-devices/new-phone#before-you-switch`),
  turned into a UUID the way `messageIdToPointId` does, so re-ingest is an idempotent upsert.
- The dense vector embeds `"{title} — {screen}\n## {heading}\n{body}"`, so the breadcrumb
  travels with the section.
- The sparse (BM25) vector is built from the same text plus the page's `aliases`, so the
  aliases boost every chunk on the page on the keyword side only.
- Payload (section 3.2) carries the whole section text; nothing is hydrated from elsewhere.

## 2. What Sky sees

### 2.1 The map (`docs/manual/map.md`)

About 350 words, written to the same rules, always in the prompt. It tells Sky what exists so
she searches only for details:

- The four tabs and what is in each: Home; Meetings → "Online", "In-Person", "Search";
  Attendance → "New", "Archive", "Reports" (the tab appears only when attendance is turned on in
  Settings); Settings and its sections.
- The three tiers, verified against the code at writing time. Starting facts (2026-10-12):
  Premium (`recoverysky-premium`) unlocks the Agent tab (Sky herself), push notifications and
  meeting reminders; the Attendance subscription (`recoverysky-attendance`) unlocks attendance
  reports and cloud backup; attendance *tracking* itself is free. Products are monthly, yearly
  and lifetime. The map names tiers by their on-screen names ("Premium", "Attendance"), never by
  entitlement id.
- The ways to sign in (email code, Google, Apple, and a password page for older accounts), and
  that Android has "Just join meetings" (guest mode) while iPhone needs an account.
- That cloud backup exists, is opt-in, and backs up attendance and sent reports only.
- Where she lives (the Agent tab, Premium) and what she can and cannot do in the app (she cannot
  change settings or log attendance; she explains how).
- The support address.

### 2.2 The prompt section

`buildSystemPrompt` (`packages/agent/src/systemPrompt.ts`) takes a new option,
`appManual?: string`. When present it emits a `## The RecoverySky app` section after the crisis
sections and before `RECOVERY_GUIDELINES`, so a crisis still reads first. The section is the map
followed by fixed instructions, in this spirit:

> You are running inside the RecoverySky app's Agent tab. Above is what the app can do. For any
> question about using the app (how to, where is, why can't I, what's included, is it private)
> call `searchManual` before answering, and answer from what it returns, using the on-screen
> labels it gives. Use `getManualPage` when the answer spans several steps. If the manual does
> not cover the question, say you are not sure and give support@recoverysky.app; never invent a
> setting, a screen or a feature. When the answer depends on the phone (iPhone or Android) or the
> subscription and you do not know, ask. Do not mention the manual or the search to the user.

The map reaches the prompt through the `system_prompts` table as an active row named
`manual-map`, the way `base-identity` does. `createSystemPromptSource`
(`apps/api/src/services/systemPrompts.ts`) gains `loadManualMap()` with the same cache-last-good
behaviour as `loadBaseIdentity()` and the same call sites; the pipeline passes the value into
`buildSystemPrompt` the way it passes `baseIdentity`. No row, or a failed read with nothing
cached, means no `## The RecoverySky app` section. The two tools are always offered and always
listed (they answer `unavailable` when there is nothing to search), so `toolList.test.ts` keeps
one fixed list and an environment without a manual behaves as today apart from two inert tools.

`TOOL_INSTRUCTIONS` gains an "### App Manual Tools" group numbering `searchManual` 7 and
`getManualPage` 8; `FIRST_MEMORY_TOOL_NUMBER` becomes 9. `packages/pipeline/tests/toolList.test.ts`
checks the list against `createChatTools` and is updated with it.

### 2.3 The tools

Both are built per request like the literature tools (`createManualTools(ctx)` in
`packages/tools/src/manualTools.ts`, registered in `createChatTools`), so embedding and search
calls carry the request's trace context. Providers are injected at boot with setters, matching
`setLiteratureQdrantStore` / `setLiteratureEmbeddingProvider`.

**`searchManual({ query, area?, platform? })`**

- `query`: 1–300 chars. `area`: the area enum. `platform`: `ios | android | web`.
- Embeds the query with the configured `IEmbeddingProvider`, builds the BM25 sparse vector with
  `getBM25Embedder()`, runs the hybrid prefetch + RRF query against `manual` with `area` and
  `platforms` as `must` match filters (a keyword match on an array payload matches any element).
- Returns up to 5 hits: `{ page, title, screen, heading, tier, platforms, content, score }`.
  `content` is capped at 3,000 chars (a 400-word section is well under it).
- Score threshold is 0, as for literature: `text-embedding-3-small` scores cluster low and the
  model judges relevance from the ranking.
- When the store is not configured, the collection is unusable, or the search fails, the tool
  returns `{ hits: [], unavailable: true }` and logs the error; it never throws into the stream.

**`getManualPage({ page })`**

- `page`: a page id matching `^[a-z0-9-]+/[a-z0-9-]+$`. (The map is not in the collection; it
  is already in the prompt.)
- Scrolls the collection with `page` as the filter, orders by `order`, joins the sections under
  their headings, caps at 8,000 chars (the longest pages will be cut; the cap is a bound, not a
  target), and returns `{ page, title, screen, tier, platforms, content }` or `{ found: false }`.

### 2.4 The store

`ManualVectorStore` in `packages/memory/src/stores/ManualVectorStore.ts`, exported from the
package. It owns the `manual` collection name and the hybrid layout (named `dense` 1536/Cosine +
`sparse`, the `messages` layout) and offers:

- `checkCollection()`: `collectionConfigProblem(info, size, 'hybrid')`, read only, mirrors
  `checkLiteratureCollection`.
- `search(queryEmbedding, queryText, { area?, platform?, limit }, ctx)`.
- `getPage(page, ctx)`.
- `ensureCollection()`, `upsert(points)`, `deleteWhereRunIdNot(runId)`, `findByIds(ids)`: used by
  the ingest only.

The hybrid query body (`prefetch` dense + sparse, `fusion: 'rrf'`) currently lives in
`QdrantVectorStore.hybridSearch`, private and mapped to `MessagePayload`. It moves to a shared
`qdrant/hybridQuery.ts` that takes a collection and returns raw points; both stores call it.
`mapQdrantError` moves to `qdrant/errors.ts` for the same reason. Behaviour of the messages path
does not change; its tests must still pass.

Boot (`apps/api/src/container.ts`) constructs the store when `QDRANT_URL` is set, calls
`checkCollection()` in `init` beside the literature check, logs "Qdrant manual collection
unusable" on a problem and keeps readiness green. The embedding provider is the one literature
uses.

## 3. Ingest (`packages/manual/` in the agent repo)

### 3.1 Package shape

A workspace package, split the way the repo likes:

- `src/parse.ts`: pure. Front-matter parsing and validation, sources-comment extraction,
  H2 chunking, the word cap, chunk ids, embed-text and sparse-text construction, content hash.
  Vitest-covered with fixture pages.
- `src/ingest.ts`: I/O. Reads the directory, calls `parse`, embeds, writes Qdrant and the
  `manual-map` row, runs the check, prints the summary.
- `src/check.ts`: runs `questions.yml` against the live collection through the same search the
  tool uses.
- `bin/manual.ts`: CLI. Root scripts `manual:ingest` and `manual:check`.

Reads the monorepo root `.env` like the API (`QDRANT_URL`, `QDRANT_API_KEY`, `DATABASE_URL`,
`OPENAI_API_KEY`). The run writes to whatever those point at, so the CLI prints the Qdrant and
database hosts first and requires `--yes` when either is not localhost.

### 3.2 One run, in order

1. **Parse** every `*.md` except `README.md`; validate; collect chunks. `map.md` is read as
   plain Markdown for step 7 and is never chunked. Any error
   (bad front-matter, a missing sources path, a section over 400 words, two pages with the same
   id) fails the run before anything is written, listing every problem at once.
2. **Diff**: fetch existing points by id; a chunk whose `contentHash` matches is not embedded,
   only its `runId` is refreshed. A re-run after editing one page embeds one page.
3. **Embed** the rest with `OpenAIEmbeddingProvider` in batches; build sparse vectors.
4. **Ensure** the collection exists with the hybrid layout and payload indexes on `page`,
   `area`, `platforms`, `tier`, `runId` (keyword) and `order` (integer).
5. **Upsert** all points (new, changed, and refreshed).
6. **Sweep**: delete every point whose `runId` is not this run's. Renamed and removed pages and
   sections cannot linger.
7. **Map**: in one transaction, set `active = false` on existing `manual-map` rows and insert the
   new one as active (the table has a unique active-per-name index; history rows stay, as for
   `base-identity`). `SystemPromptRepository` gains `replaceActive(name, content)`.
8. **Check** (section 3.4). A miss fails the run with exit 1, after the writes: the corpus is
   already live, and the failure is a signal to fix `questions.yml` or the page, not to roll
   back.
9. **Summary**: pages, chunks, words, chunks embedded vs skipped, estimated embedding cost,
   misses, `manualVersion`, hosts.

Flags: `--dry-run` (steps 1 and 9 only, plus the would-embed count), `--check-only` (step 8
against the live collection), `--version <string>` (overrides `manualVersion`), `--yes`.

### 3.3 Payload

```ts
{
  corpus: 'manual',
  page: 'backup-and-devices/new-phone',
  order: 2,                       // 0 = intro
  heading: 'Before you switch',   // '' for the intro
  title: 'Moving to a new phone',
  area: 'backup-and-devices',
  screen: 'Settings → Cloud Backup',
  platforms: ['ios', 'android'],
  tier: 'attendance',
  aliases: ['new phone', 'transfer', 'switch phones'],
  content: '…the section text…',
  contentHash: 'sha256 of embed text',
  manualVersion: 'v4.11.0-4-3-gabc1234',   // git describe --tags of the app checkout
  runId: '2026-10-12T19:04:11Z-7f3a',
  ingestedAt: 1760295851000
}
```

### 3.4 `questions.yml`

```yaml
- q: how do I email my attendance to my probation officer
  expect: attendance/reports
- q: it says this phone belongs to a different account
  expect: account/wrong-account
- q: my favorites didn't come over to my new phone
  expect: backup-and-devices/using-more-than-one-device
```

Each `q` runs through the same hybrid search as the tool (no filters, limit 3); the run passes
when every `expect` page appears among its three. It needs the embedding API, so it is an
on-demand check, not a unit test. Every page has at least three entries (rule 13).

### 3.5 When it runs, and the discipline

- App CLAUDE.md gains a "User's Manual (`docs/manual/`)" section and a Repo Docs Map line:
  any user-visible behaviour change updates the matching manual page **in the same commit**;
  CHANGELOG entries that touch the manual go under `Docs` with a `(manual)` tag; a page is
  validated with `pnpm --dir ../agent manual:ingest --dry-run docs/manual` before commit (one
  parser, no second implementation here).
- The release sections ("OTA release", "Native release") gain the line: *did this release touch
  `docs/manual/`? Then, once it is live, run `pnpm manual:ingest ../app/docs/manual` from the
  agent repo with the production `.env`.*
- `docs/support/README.md` notes that user-facing wording lives in the manual and `replies/` are
  pointers (after area 1 lands).
- Agent CLAUDE.md documents the package, the `manual` collection, the `manual-map` row, the two
  tools and the prompt section.

## 4. The writing process (per area)

Pages are documents, not code. Each area is a bounded sub-project with a brief, not a spec. The
brief and the review are what keep the corpus true; an invented setting in a RAG corpus is worse
than a missing page, because Sky will repeat it with confidence.

1. **Brief**: the pages, and for each page its sources: the screen and components, the `en.ts`
   namespace, the spec(s), the CLAUDE.md section, and any `docs/` file.
2. **Write** each page to the template from those sources only.
3. **Fact-check review**, by a different reader than the writer (a subagent when the writer is a
   subagent): every claim traced to a source or removed; every internal term; every section over
   the cap; every missing platform or tier note; every hand-off sentence checked against rule 9.
4. **Questions**: at least three `questions.yml` entries per page, in the user's words.
5. **Verify**: `--dry-run`, commit, ingest to the **dev** Qdrant, ask Sky three of the
   questions through the CLI (`packages/cli`), and read the answers for invented details.

## 5. Roadmap

| # | Sub-project | Pages | Notes |
| --- | --- | --- | --- |
| 0 | **Skeleton** | `README.md`, `map.md`, `questions.yml`, `backup-and-devices/*` (5) | `packages/manual`, `ManualVectorStore`, `hybridQuery` extraction, `manualTools`, prompt section + `manual-map`, container wiring, both CLAUDE.md updates. D10: the backup area is written here, from `docs/BACKUP.md` and `SettingsScreen.tsx`. |
| 1 | Getting started & account | `getting-started/*`, `account/*` | Grown from `docs/support/replies/` and `reference/`; then `replies/` become pointers (D7). Highest support load. |
| 2 | Meetings | `meetings/*` (10) | The core. Sources include the filter-bar and Starts In spec, In-Person specs, `MeetingRow`, popups. |
| 3 | Attendance | `attendance/*` (6) | Timer, "I'm Here", reports' four send operations, the certificate. `docs/MEETING_ATTENDANCE_FLOW.md`. |
| 4 | Settings, subscription, privacy | `settings/*`, `privacy/your-data` | Tiers verified row by row against `useSubscription` consumers. |
| 5 | Home, Sky, status | `home/*`, `sky/about-sky`, `status/*` | The Home card copy that says attendance is tracked "automatically" is wrong; the manual describes the timer. |

Follow-ups, each its own small piece of work:

- **App context in the chat body.** `AgentScreen` sends `{ timezone, fellowship }`; add
  `platform` and `appVersion` (JS-only on the app side; a zod field and a prompt line on the
  agent side) so Sky pre-filters by platform and stops asking "iPhone or Android?".
- `replies/` → pointers (after area 1).
- Forgejo-triggered ingest, if running it by hand gets old.
- LLM-judged manual evals on the agent-evals harness ("uses on-screen labels", "invents nothing").

## 6. Testing

- `packages/manual` `parse.ts` (vitest): front-matter validation and defaults, the sources
  comment, H2 chunking with the intro chunk, H3s staying inside their H2, the 400-word cap,
  stable chunk ids, embed-text and sparse-text shape, content-hash stability.
- `ManualVectorStore` (vitest, stubbed client): filter construction for `area` and `platform`,
  payload → hit mapping (points missing `page` or `content` are dropped and counted), `getPage`
  ordering and cap, `checkCollection` on a wrong layout.
- `hybridQuery` extraction: the existing `QdrantVectorStore` tests still pass unchanged.
- `manualTools` (vitest): input bounds, the `unavailable` shape when no store is set, the hit
  cap, `getManualPage` id validation.
- `systemPrompt` (vitest): the section is present with `appManual` and absent without; it sits
  after the crisis sections and before the guidelines; the tool list numbers 7–8 and memory tools
  from 9. `toolList.test.ts` updated.
- `SystemPromptRepository.replaceActive` (integration test beside the existing store tests):
  the old row is inactive, the new one active, history kept.
- `questions.yml` on every ingest (on demand; needs the embedding API).
- **Hand checklist**, run against dev through the CLI before the skeleton is called done, and
  again after each area:
  1. "How do I send my PO a report?"
  2. "My favorites didn't move to my new phone."
  3. "Why don't I see the Attendance tab?"
  4. "Is my clean date private?"
  5. "I'm on Android and don't want an account."
  6. "How do I delete my data?" (expects the honest cloud-copy edge and the hand-off sentence)
  7. "What does Premium get me?"
  8. "The app says this phone is set up for a different account."
  9. "Can I use RecoverySky on two phones?"
  10. "What does 'Paused — offline' mean?"
  For each: did she search, did she use the on-screen labels, did she invent anything, did she
  hand off correctly, did she keep the manual invisible?

Known state: five agent suites were already red on a clean tree on 2026-10-10
(`systemPrompt.test.ts`, `Pipeline.test.ts`, `definitions.test.ts`, `meetingClient.test.ts`,
`MemoryOrchestrator.test.ts`). They are not regressions of this work; the plan must note which
are red before its first task.

## 7. Out of scope

- Publishing the manual for humans (a static site at recoverysky.app). The Markdown and
  front-matter make it cheap later; nothing here depends on it.
- Translating the manual.
- Fixing the two copy drifts found while mapping: the crash screen's `support@recoverysky.org`
  (every other string says `.app`) and the Home card's "tracked automatically". Both are app
  copy changes with their own CHANGELOG entries; the manual describes the truth meanwhile.
- Deleting the cloud copy from inside the app (tabled 2026-09-30; the manual states the edge).
- Prompt caching in the chat route.
- Any change to how literature is stored or searched.

## 8. Open questions

None blocking the skeleton. Two to settle during area 4: whether the 90-in-90 certificate needs
the Attendance subscription (the map's tier list is verified at writing time), and whether the
manual should mention the Community tab at all (it is hidden behind a constant today; rule 6
says no).
