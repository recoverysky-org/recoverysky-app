# Support knowledge base — sign-in, verification, linking — Implementation Plan

> **For agentic workers:** executed by superpowers:subagent-driven-development. Each task
> writes Markdown only. No code changes.

**Goal:** a `docs/support/` knowledge base that lets technical support staff (Auth0 dashboard +
Loki access) diagnose and fix every sign-in, email-verification and account-linking problem a
RecoverySky user can hit, plus a separate folder of copy-paste replies to users.

**Spec:** none. Requirements were set by Jenova in conversation on 2026-10-02 and are restated
under "Decisions" below; they are binding.

**Sources of truth (the facts):** four research fact sheets in this plan's SDD workspace,
`.superpowers/sdd/2026-10-02-support-knowledge-base/research/` (`app-signin.md`, `auth0.md`,
`api.md`, `verify-and-tools.md`). Every fact in them carries a `path:line` cite into the app repo
or the api repo (`../api/.claude/worktrees/email-verify`, branch `feat/email-verify`). When a
fact sheet and the code disagree, the code wins; re-read the cited line before writing.

## Decisions (Jenova, 2026-10-02)

- D1. **Audience:** full-technical support. They can use the Auth0 dashboard and Management
  API, query Loki and Tempo, and read Postmark activity.
- D2. **Location:** `docs/support/` in the app repo, Markdown.
- D3. **Replies are separate:** `docs/support/replies/`, one per problem doc, same file name.
  Problem docs link to their reply; replies never contain internal detail.
- D4. **Time frame:** describe the world AFTER the prod rollout ships (passwordless email code,
  password form, Google, Apple, email verification, automatic + explicit linking live on prod).
  Where users on old store builds behave differently, say so in a short "Old app versions" note.
- D5. **Mistyped address + `email_in_use` on the mandatory screen:** the support fix is to
  correct the address in the Auth0 dashboard. Mark it "Pending Jenova's decision on the in-app
  path" (decision 1 of the email-verification device pass is still open).
- D6. **Support is trusted to do prod Management API writes** (fix an email, set
  `email_verified`, link, unlink, delete a user). Docs give the steps and the warnings; no
  approval gate.

## Global constraints (every task)

- G1. **No real user data.** Example addresses use `user@example.com`, `typo@exmaple.com`;
  example subs are clearly fake (`auth0|65f0000000000000000000aa`). Never copy an address, sub or
  hash from logs, test fixtures or the fact sheets' examples if it might be real.
- G2. **No secrets.** Never a token, client secret, API key or `.env` value. Name the variable or
  dashboard page instead.
- G3. **Privacy rule for support itself**, stated in the README and repeated where a recipe
  touches it: logs carry `hashUserId(sub)` only; never paste a user's email or raw sub into a
  ticket, a Loki query or a log. Compute the hash locally.
- G4. **Cite sources.** Each doc ends with a `## Sources` list of repo paths (app paths relative
  to the app repo root; api paths prefixed `api:`), so a maintainer can re-check it after a code
  change. Line numbers optional.
- G5. **Exact strings.** User-visible text is quoted verbatim from `app/i18n/en.ts` (English);
  log messages are quoted verbatim from the code. If you cannot find the exact string, write the
  meaning and mark it `(paraphrase)`.
- G6. **Problem doc shape** (every file in `problems/`):
  `# <symptom in the user's words>` → `## Symptoms` (what the user says / sees) →
  `## Diagnose` (numbered checks: Auth0 dashboard, Loki, Postmark; each says what you are looking
  for and what each answer means) → `## Causes` (one subsection per cause, keyed to the
  diagnose results) → `## Solution` (per cause, numbered steps, including any Management API
  write with its warning) → `## Escalate` (when to hand to engineering, and what to attach:
  hash, appVersion, platform, timestamps, traceId) → `## Reply` (link to `../replies/<same>.md`) →
  `## Sources`.
- G7. **Reply shape** (every file in `replies/`): one or more variants keyed to the problem doc's
  causes; plain warm language; no internal words (no "sub", "Action", "tenant", "hash",
  "Management API", "MMKV"); `[bracketed]` placeholders; signed "RecoverySky Support"; English
  only. Max ~150 words per variant.
- G8. **Cross-links** are relative Markdown links and must resolve.
- G9. **Git:** work only in `/Users/jenova/projects/recoverysky-org/app/.claude/worktrees/support-kb`
  on branch `docs/support-kb`. Stage named paths only (never `git add -A`, never `git stash`).
  Commit messages `📝 docs(support): …`, ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- G10. Tone: direct and plain, short sentences, tables where they help. Not chatty.

## File map

```
docs/support/
  README.md
  reference/{sign-in-methods,account-linking,device-owner,email-verification,tools}.md
  problems/<name>.md        (11, listed in Tasks 4–5)
  replies/<name>.md         (one per problem, same names)
```

## Task 1: README and tools reference

**Files:** create `docs/support/README.md`, `docs/support/reference/tools.md`.

- README: one-paragraph scope; **symptom → problem doc** table (all 11 problems from Tasks 4–5,
  with the user's words in column 1); a reference list; a glossary (sub, primary account,
  identity, connection, owner, hash, `loginMethod`, Hide My Email); the privacy rule (G3); "how to
  use these docs" (diagnose first, reply second); a note that the docs describe the post-rollout
  world (D4) and the D5 pending decision.
- tools.md: Auth0 dashboard (find a user by email, read identities and `email_verified`, tenant
  log event codes table relevant to our flows, Action execution results); Management API
  operations support may perform (D6) with exact endpoints and warnings; hashing an Auth0 sub
  into the log `userId` (algorithm + a one-line shell or node command); Loki (URL, labels,
  query_range chunking, LogQL examples for auth lines by hashed userId); Tempo lookup by traceId;
  Postmark activity (tags, inactive recipients); what is never logged.

## Task 2: Sign-in methods and device owner references

**Files:** create `docs/support/reference/sign-in-methods.md`, `docs/support/reference/device-owner.md`.

- sign-in-methods: one section per method (email code, password, Google, Apple): what the user
  taps (verbatim), Auth0 connection, `sub` prefix, `loginMethod`, logout behaviour, timings
  (code length, resend, timeouts), every login error message and its trigger; "signed out
  unexpectedly" causes; Old app versions note.
- device-owner: owner record, when set/cleared, ownership outcomes, the wrong-account screen
  (verbatim copy and each button), relink after another device linked the account, Delete User
  Data effects (local vs Auth0 vs cloud backup).

## Task 3: Account linking and email verification references

**Files:** create `docs/support/reference/account-linking.md`, `docs/support/reference/email-verification.md`.

- account-linking: automatic linking (the Link passwordless identity Action: guard, oldest-match,
  primary, no `email_verified` check, refresh skip, never denies), explicit linking
  (wrong-account rescue → `POST /auth0/link`), relink on other devices, Settings → Account rows,
  Apple Hide My Email (automatic can't match; explicit still works; fresh-phone gap), what data
  follows the primary, how to tell in the tenant log that a login was linked.
- email-verification: who is asked / never asked, six skips one per local day then mandatory,
  hidden-and-not-counted conditions, the three steps, every API error code → user message →
  meaning, success effects (Auth0 email + `email_verified`, local record, renewal), Postmark tag,
  the D5 lock-out, rate limits.

## Task 4: Problem docs, batch A (codes and screens)

**Files:** create in `docs/support/problems/`:
`no-code-email.md`, `code-rejected-or-expired.md`, `wrong-account-screen.md`,
`verify-screen-wont-go-away.md`, `mistyped-email-locked-out.md`, `email-change-not-showing.md`.
Follow G6. `no-code-email` covers both Auth0's login code and the API's verification code (they
are sent by different systems — say how to tell which). `mistyped-email-locked-out` carries D5.

## Task 5: Problem docs, batch B (accounts and data)

**Files:** create in `docs/support/problems/`:
`empty-account-after-sign-in.md` (duplicate account; Hide My Email fresh-phone gap),
`data-missing-after-new-phone.md`, `forgot-password-or-old-app.md`,
`signed-out-unexpectedly.md`, `sign-in-hangs-google-apple.md`. Follow G6.

## Task 6: Replies and housekeeping

**Files:** create `docs/support/replies/<name>.md` for all 11 problems (G7); modify
`docs/AUTH_LINKING_TESTS.md` "Not covered here" Apple line to: automatic email-match linking
can't fire for Hide My Email (the relay address never matches); linking still happens through
the wrong-account rescue (link to `support/reference/account-linking.md`); modify `CLAUDE.md`
"Repo Docs Map" to add a `docs/support/` bullet (one or two lines). Verify every relative link
under `docs/support/` resolves (a small shell loop is fine) and report the result.
