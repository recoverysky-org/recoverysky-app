# The RecoverySky User's Manual

One Markdown page per feature, written in the voice of a user's manual. The reader is
Sky, the agent in the Sky Agent tab: the pages are chunked into her `manual` search
collection, and `map.md` is pasted into her system prompt, so she can answer "how do
I…", "where is…", "why can't I…", "what's included" and "is it private" about the app.
Nobody browses this folder; its only job is to be true.

Spec: `docs/superpowers/specs/2026-10-12-user-manual-rag-design.md`. Ingest and tools
live in the agent repo (`packages/manual`, `searchManual`, `getManualPage`).

## Layout

```
docs/manual/
  README.md            this file; never ingested
  map.md               "what the app can do": the always-on prompt section; never chunked
  questions.yml        retrieval smoke test: user phrasing → the page that must come back
  <area>/<page>.md     one page per feature; the page id Sky sees is "<area>/<page>"
```

Areas: `getting-started`, `home`, `meetings`, `attendance`, `settings`, `backup-and-devices`,
`account`, `privacy`, `sky`, `status`, `my-day`. A page's `area` in its front-matter must equal
its folder. Page ids are stable identifiers: renaming a page is a content change that
`questions.yml` must follow.

## Page template

```markdown
---
title: Cloud Backup
area: settings
screen: Settings → Cloud Backup        # on-screen labels, verbatim from app/i18n/en.ts
platforms: [ios, android]              # omitted = [ios, android, web]
tier: attendance                       # free | attendance | premium: what you need to use it
aliases: [backup, sync, "new phone"]   # keyword fuel for the search; omitted = none
---
<!-- sources: app/screens/SettingsScreen.tsx, docs/BACKUP.md -->
One paragraph: what it is, in plain words. This is its own chunk.

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

Front-matter rules (the ingest enforces them): `title`, `area` and `screen` are required;
`platforms` is a subset of `[ios, android, web]` and means all three when omitted; `tier` is
`free`, `attendance` or `premium` and means `free` when omitted; `aliases` is a list of
strings. The `<!-- sources: … -->` comment is required, lists repo-relative paths separated
by commas, and every path must exist in this repo. The ingest strips it before chunking.

## Authoring rules

These are the review checklist for every page.

1. **Second person, present tense, plain words.** "Tap Settings, then Cloud Backup."
2. **On-screen labels verbatim, in quotes,** taken from `app/i18n/en.ts`. If the screen
   says "Back up attendance", the manual never says "enable sync".
3. **No internal names.** No "ownership gate", "OTA", "MST", "entitlement", "runtime
   version", "attestation", "RevenueCat", "Auth0". If a concept needs a name, use the one
   the screen uses or describe it.
4. **Platform and tier stated inside the section where they differ**, not only in
   front-matter: "On Android, …", "This needs the Attendance subscription." A retrieved
   section stands alone.
5. **Say where data lives**: "stays on this phone", "in your backup", "never leaves the
   phone". This app's privacy posture is a feature; the manual states it precisely, never
   vaguely.
6. **No roadmap, no "coming soon", no "we plan to".** The manual describes what the
   installed app does today.
7. **Nothing that looks like real data**: no example email addresses that could be real,
   no account ids, no names. `you@example.com` is fine.
8. **Every claim is traceable** to a file in the page's `<!-- sources -->` line. A claim
   the reviewer cannot find in those sources is removed, not softened.
9. **The hand-off sentence is always the same**: "Contact support@recoverysky.app and
   mention [what to mention]." Never a different address, never "reach out to us".
10. **Honest edges.** Where the app cannot do something people expect (delete the cloud
    copy from inside the app, move favorites to a new phone), the manual says so plainly.
11. **A section is one H2 and at most 400 words.** H3s stay inside their H2. The intro
    paragraph before the first H2 is its own chunk. The ingest fails on a longer section;
    split it.
12. **"Questions people ask" is in the user's words**, the way the symptom table in
    `docs/support/README.md` is: "my favorites didn't move", not "favorites are
    device-local".
13. **At least three `questions.yml` entries per page**, in the user's words, and they
    must retrieve the page in the top three.

## How a page is chunked

- One chunk per H2 section; the intro paragraph is chunk 0.
- Chunk id is `<page>#<heading-slug>` (`backup-and-devices/new-phone#before-you-switch`;
  the intro is `<page>#intro`), so re-ingest is an idempotent upsert and two H2s on one
  page must not slug to the same thing.
- The search embeds `"<title> — <screen>\n## <heading>\n<body>"`, so the breadcrumb travels
  with the section; the keyword side also sees the page's `aliases`.
- The whole section text is stored with the chunk; nothing is fetched from anywhere else.

## The map (`map.md`)

About 350 words, never more than 750, written **to Sky** ("you" is Sky), pasted into her
prompt as one section. It must not contain a line starting with `## ` or `# ` (that would
open a new prompt section), and it follows rules 2–10 above. It lists what exists so she
searches only for details: the tabs and what is in each, the subscriptions by their
on-screen names, the ways to sign in, cloud backup in one sentence, where she lives and
what she cannot do, and the support address. Its sources are listed in a sources comment
at the top like any page.

## `questions.yml`

```yaml
- q: how do I email my attendance to my probation officer
  expect: attendance/reports
```

Each `q` runs through the same search Sky uses (no filters, three hits); the run passes
when every `expect` page appears among the three. It needs the embedding API, so the
ingest runs it, not a unit test.

## Validate before committing

From this repo, with the agent repo checked out beside it:

```bash
pnpm --dir ../agent manual:ingest ../app/docs/manual --dry-run
```

It parses every page, lists every problem (front-matter, missing sources paths, sections
over 400 words, a map with headings, questions that name a page that does not exist) and
writes nothing. The same parser runs the real ingest; there is no second implementation.

## When it is ingested

By hand, from the agent repo with the production `.env`, after a release that touched this
folder is live: `pnpm manual:ingest ../app/docs/manual`. See the "User's Manual" section
of `CLAUDE.md` and the release checklists there.
