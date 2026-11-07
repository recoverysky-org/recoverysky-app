# Sky's chat sends the turn only: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Sky tab sends only the turn with a `conversation_id`, reads its thread from the agent, keeps nothing of a chat on the phone, and starts over with New conversation through a sticky fresh id plus the agent's archive route.

**Architecture:** Pure modules decide everything: the request body, the stale refusals, the tool part states, and the whole open flow with its reads injected. A thin hook binds that flow to the store and the screen. `AgentScreen` splits into an outer shell (consent, open state, composer text) and an inner `AgentChat` keyed by conversation id, so the SDK's chat restarts on a new id.

**Tech Stack:** Expo 54, `ai` 6 and `@ai-sdk/react` 3, MobX-State-Tree, MMKV, vitest for pure modules.

**Spec:** `docs/superpowers/specs/2026-11-06-agent-chat-turn-only-design.md`. The agent's side, read for the wire only and built by the agent team: `../agent/docs/superpowers/specs/2026-11-06-conversation-archive-design.md` and `../agent/docs/superpowers/specs/2026-11-06-sky-context-per-turn-design.md`.

## Global Constraints

- **Checkout and branch.** The main checkout, branch `root`, on Jenova's ruling of 2026-11-06. CHANGED 2026-11-06: this plan first called for a worktree. Every shell step starts with `cd /Users/jenova/projects/recoverysky-org/app`.
- **Shared checkout.** Other sessions work here at the same time, so HEAD can move and files can be dirty that are not yours. Stage only the paths a task names, never `git add -A`, never `git stash`. Before committing, `git diff --cached --name-only` must list only your paths. A file that was already dirty before you touched it carries someone else's hunks: stage your change alone by writing a blob built from `git show HEAD:<path>` plus your edit (`git update-index --cacheinfo 100644,$(git hash-object -w <tmpfile>),<path>`), and leave their hunks in the working tree. `npm run compile` or a test failing only in files you did not touch is theirs: name it in your report and carry on.
- **Commits:** `<emoji> <type>(<scope>): <subject>`, a body that says why, footer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit after every task. Merging, pushing and releasing are Jenova's, not this plan's.
- **TDD.** Every task writes its tests first and watches them fail, on Jenova's ruling of 2026-11-06. Component and hook tests are jest (`*.test.tsx`).
- **Tests.** Pure logic has no runtime `@/` import (type-only is fine), runs under vitest (`npm run test:unit -- <file>`). `npm run compile` after every task. Lint only touched files with `npx eslint --fix <files>`, **never** `npm run lint`. `npm run lint:deps` after a task adds a cross-folder import. `app/services/api/` stays a dependency leaf.
- **Nine locale files.** A new key lands in `en.ts` and the eight others (`ar de es fr pt ru th uk`), English text in the eight. Edit them with Python, not `perl -C`, which double-encodes.
- **Comments.** Liberal, at the call site, with the why. Every `ADDED`/`CHANGED` note dated 2026-11-06. Keep the functional comment when behavior changes (CLAUDE.md "Comments").
- **Env.** The agent URL gate reads the direct expression `process.env.EXPO_PUBLIC_AGENT_URL`, never `configStore.agentUrl`, which is never empty.
- **Logs.** Nothing of what was said. No message text, no raw sub. Ids of conversations are fine at debug.
- **a11y.** New interactive UI carries `accessibilityRole` and `accessibilityLabel`.
- **Wire values.** Guide `base-identity`. Reads: `GET /api/v1/conversations?guide=base-identity&limit=1`, `GET /api/v1/conversations/{id}/messages?limit=200`. Write: `POST /api/v1/conversations/archive` with `{ guide, except? }`, answering `{ archived }`. Listing rows name the id `conversationId`.
- **Blocked until the agent ships:** the device pass in Task 8. Every other task runs against any agent or none.

## Review Focus

1. **A crisis reply from a refused turn, then a tab switch.** The agent stored nothing, so the reply must stay on screen and the listing must not run. Pinned in Task 2, "keeps the screen when a sent id is not stored".
2. **New conversation, then a restart before the first turn.** The flag must persist, and the open must make no network call. Pinned in Task 2 (no call while fresh) and Task 7 (the flag survives a snapshot).
3. **Delete User Data offline or against a hung agent.** It must finish within 5 seconds and never throw, or the person's delete hangs. Pinned in Task 1, "gives up at the timeout".
4. **A reply that is not what we expect: a proxy's HTML, a listing with no array.** It counts as a failed read and never crashes or mints a forked thread. Pinned in Task 1 and Task 2.
5. **An OTA reaching a production install with the tab hidden.** The SQLite wipe must not run there. Pinned in Task 2, `decideChatWipe`.

## File map

| File | Responsibility |
|---|---|
| `app/services/api/agentConversationsLogic.ts` (new) | URLs, parsers and a client over injected `fetch` and headers |
| `app/services/api/agentConversations.ts` (new) | Binds that client to `api.agentHeaders()` and global fetch |
| `app/utils/agentConversationLogic.ts` (new) | `openConversation`, `decideChatWipe` |
| `app/utils/agentBodyLogic.ts` (new) | `turnOf`, `chatRequestBody`, `isStaleRefusal` |
| `app/utils/agentToolPartLogic.ts` (new) | `classifyToolPart` |
| `app/hooks/useAgentConversation.ts` (new) | Runs the open flow on focus, applies outcomes to the store |
| `app/models/ConversationStore.ts` | The id, the fresh flag, the volatile collapse map |
| `app/screens/AgentScreen.tsx` | Outer shell plus inner `AgentChat` |
| `app/screens/SettingsScreen.tsx` | Delete User Data step 3 |
| `app/db/ChatWipeRunner.tsx` (new), `app/db/ChatHydrator.tsx` (deleted) | The one-time wipe |

## Before Task 1

Commit only this plan and its spec to `root` as docs (`📝 docs(agent): turn-only chat design and plan`).

The agent's archive spec stays in the agent repo for the agent team; this plan does not commit it.

---

### Task 1: The agent conversation client

**Files:**
- Create: `app/services/api/agentConversationsLogic.ts`, `app/services/api/agentConversations.ts`
- Test: `app/services/api/agentConversationsLogic.test.ts`

**Interfaces:**
- Produces, from the logic file:
  - `type AgentRead<T> = { kind: "ok"; value: T } | { kind: "refused" } | { kind: "unavailable" }`
  - `AGENT_GUIDE = "base-identity"`
  - `createAgentConversationsClient(deps: { baseUrl: string; headers: () => Promise<Record<string, string>>; fetch: typeof globalThis.fetch; timeoutMs?: number }): AgentConversationsClient`
  - `AgentConversationsClient`: `listNewest(): Promise<AgentRead<string | null>>`, `readMessages(id: string): Promise<AgentRead<UIMessage[]>>`, `archive(opts: { except?: string; timeoutMs?: number }): Promise<boolean>`
- Produces, from the I/O file: `agentConversationsClient(baseUrl: string): AgentConversationsClient`, binding `api.agentHeaders` and global `fetch`.

- [ ] **Step 1: Write the failing tests**

```ts
// A fake fetch answering by URL. Helper: json(status, body) => Response.
describe("listNewest", () => {
  it("asks for the newest base-identity conversation and answers its id", async () => {
    // fetch sees `${base}/api/v1/conversations?guide=base-identity&limit=1`, with the headers from deps
    expect(await client.listNewest()).toEqual({ kind: "ok", value: "c-1" }) // { conversations: [{ conversationId: "c-1" }] }
  })
  it("answers null when none is listed", ...)            // { conversations: [] } => { kind: "ok", value: null }
  it("treats a body with no array as unavailable", ...)  // {} and an HTML 502 page => { kind: "unavailable" }
  it("treats 503 and a thrown fetch as unavailable", ...)
  it("treats a headers() rejection as unavailable", ...) // never throws
})
describe("readMessages", () => {
  it("reads limit=200 and answers the messages", ...)    // url ends /api/v1/conversations/c-1/messages?limit=200
  it("answers refused on 403 and 404", ...)
  it("drops entries with no id, role or parts array", ...)
  it("treats a body with no messages array as unavailable", ...)
})
describe("archive", () => {
  it("posts the guide and except, answering true on 200", ...) // body { guide: "base-identity", except: "c-2" }
  it("omits except when none is given", ...)
  it("answers false on 503 and on a thrown fetch", ...)
  it("gives up at the timeout and answers false", ...)   // fake timers, a fetch that never resolves, signal aborted
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:unit -- app/services/api/agentConversationsLogic.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both files**

Default timeout 15000 ms through `AbortController`. No method throws. The logic file imports `UIMessage` as a type only. `encodeURIComponent` the id.

- [ ] **Step 4: Run the tests and `npm run compile`**

Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/services/api/agentConversationsLogic.ts app/services/api/agentConversations.ts app/services/api/agentConversationsLogic.test.ts
git commit -m "✨ feat(agent): reads and archive for the conversations the agent holds"
```

### Task 2: The open flow and the wipe decision

**Files:**
- Create: `app/utils/agentConversationLogic.ts`
- Test: `app/utils/agentConversationLogic.test.ts`

**Interfaces:**
- Consumes: `AgentRead` (Task 1, type-only import by relative path).
- Produces:
  - `openConversation(input: OpenInput, deps: OpenDeps): Promise<OpenOutcome>`
  - `OpenInput = { conversationId: string | null; isFresh: boolean; sentIds: ReadonlySet<string>; threadOnScreen: boolean }`
  - `OpenDeps = { listNewest(): Promise<AgentRead<string | null>>; readMessages(id: string): Promise<AgentRead<UIMessage[]>>; mintId(): string }`
  - `OpenOutcome = { kind: "keep" } | { kind: "failed" } | { kind: "fresh"; id: string; minted: boolean } | { kind: "thread"; id: string; history: UIMessage[]; historyFailed: boolean }`
  - `decideChatWipe(input: { done: boolean; agentUrlEnv: string | undefined }): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
describe("openConversation", () => {
  it("makes no call while the id is fresh", async () => {
    const out = await openConversation({ conversationId: "new", isFresh: true, sentIds: new Set(), threadOnScreen: false }, deps)
    expect(out).toEqual({ kind: "fresh", id: "new", minted: false })
    expect(deps.listNewest).not.toHaveBeenCalled()
    expect(deps.readMessages).not.toHaveBeenCalled()
  })
  it("adopts the listed conversation and reads it", ...)      // { kind: "thread", id: "c-1", history, historyFailed: false }
  it("mints a fresh id when none is listed", ...)              // { kind: "fresh", id: "minted", minted: true }
  it("waits rather than mints when the listing fails", ...)    // unavailable, nothing on screen => { kind: "failed" }, mintId not called
  it("keeps the thread when the listing fails over one", ...)  // threadOnScreen: true => { kind: "keep" }
  it("keeps the thread when the read fails over one", ...)     // threadOnScreen: true, read unavailable => { kind: "keep" }
  it("shows the error with the id when the read fails over nothing", ...) // { kind: "thread", id, history: [], historyFailed: true }
  it("lists once more when the read is refused", ...)          // refused then ok: listNewest called twice, second id's thread
  it("fails on a second refusal", ...)                         // refused twice, nothing on screen => { kind: "failed" }, listNewest called twice
  it("keeps the thread on a second refusal over one", ...)     // refused twice, threadOnScreen: true => { kind: "keep" } (a re-read never blanks; a send then earns the stale path)
  it("keeps the screen when a sent id is not stored", async () => {
    // A refused turn at crisis level: the agent stored nothing
    const out = await openConversation({ conversationId: "c-1", isFresh: false, sentIds: new Set(["u-9"]), threadOnScreen: true }, deps) // readMessages("c-1") holds no u-9
    expect(out).toEqual({ kind: "keep" })
    expect(deps.listNewest).not.toHaveBeenCalled()
  })
  it("keeps the screen when that check cannot read", ...)      // unavailable or refused => keep, no listing
  it("continues when every sent id is stored", ...)            // listing runs
  it("makes no call for a fresh id whose turn failed before streaming", ...) // isFresh true with sentIds: { kind: "fresh" }, nothing read
})
describe("decideChatWipe", () => {
  it("wipes once where the build has an agent URL", ...)       // done false + "http://localhost:3333" => true
  it("never wipes in a build with no agent URL", ...)          // undefined and "" => false (the hidden-tab production install)
  it("does not wipe twice", ...)                               // done true => false
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:unit -- app/utils/agentConversationLogic.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the module**

Order inside `openConversation`: fresh returns first; a non-empty `sentIds` with an id runs the stored check; then the listing and the read, with one re-list on a refused read. `decideChatWipe` reuses `isValidAgentUrl` from `./agentTabLogic`.

- [ ] **Step 4: Run the tests and `npm run compile`**

Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/utils/agentConversationLogic.ts app/utils/agentConversationLogic.test.ts
git commit -m "✨ feat(agent): the open flow, and a re-read that never erases an unstored reply"
```

### Task 3: The store's new shape, added beside the old

**Files:**
- Modify: `app/models/ConversationStore.ts`, `app/components/agent/ToolResultRenderer.tsx`
- Test: `app/models/ConversationStore.test.tsx` (jest for now; Task 7 moves it to vitest)

**Interfaces:**
- Produces on the store:
  - props `conversationId: string | null` (default null), `conversationIsFresh: boolean` (default false)
  - actions `startNewConversation(id: string)` (id set, fresh true, collapse map emptied), `adoptConversation(id: string)` (id set, fresh false), `markConversationOnAgent()` (fresh false), `forgetConversation()` (id null, fresh false, map emptied)
  - volatile `collapsedToolResults: Map<string, string>`, `collapseToolResult(toolCallId, summary)` replacing the map on each write, `getCollapseState(toolCallId): { summary: string } | null`

The old message members stay until Task 7, so every task compiles. Only `collapseToolResult` and `getCollapseState` change now, which also makes the card collapse for real (spec D5).

Vitest cannot import this file until its `@/` imports are gone, so the store's tests start under jest, with `@/db/repositories` mocked, and Task 7 moves them.

- [ ] **Step 1: Write the failing tests**

```tsx
it("survives a restart holding a fresh id", () => {
  const a = ConversationStoreModel.create({})
  a.startNewConversation("new")
  const b = ConversationStoreModel.create(getSnapshot(a))
  expect(b.conversationId).toBe("new")
  expect(b.conversationIsFresh).toBe(true)
})
it("reads an old snapshot without its dropped props", ...) // create({ lastSyncedAt: 5, messageCount: 2 } as any) => conversationId null
it("adopting and marking clear the flag", ...)
it("forgetting clears the id, the flag and the collapse map", ...)
it("collapses by tool call id, in a new map each time", ...) // the map reference changes and getCollapseState answers the summary
```

Run: `npm run test:component -- app/models/ConversationStore.test.tsx`
Expected: FAIL, the actions do not exist.

- [ ] **Step 2: Implement the additions**

Add the props, volatile map and actions. Rewrite `collapseToolResult` and `getCollapseState`. Wrap `ToolResultRenderer` in `observer()`: it is a plain component today, so the collapse would never redraw.

- [ ] **Step 3: Run the tests and `npm run compile`**

Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add app/models/ConversationStore.ts app/models/ConversationStore.test.tsx app/components/agent/ToolResultRenderer.tsx
git commit -m "✨ feat(agent): the store holds the conversation id and a fresh flag"
```

### Task 4: The body, the stale refusals, the tool parts

**Files:**
- Create: `app/utils/agentBodyLogic.ts`, `app/utils/agentToolPartLogic.ts`
- Test: `app/utils/agentBodyLogic.test.ts`, `app/utils/agentToolPartLogic.test.ts`

**Interfaces:**
- Produces:
  - `turnOf(messages: readonly UIMessage[]): UIMessage | null`
  - `chatRequestBody(conversationId: string, messages: readonly UIMessage[], timezone: string, fellowship: string | undefined): { conversation_id: string; messages: UIMessage[]; timezone: string; fellowship?: string }`
  - `isStaleRefusal(errorMessage: string): boolean`
  - `classifyToolPart(part: { type: string; [key: string]: unknown }): ToolPartView | null`, where `ToolPartView = { kind: "result"; toolCallId: string; toolName: string; output: unknown } | { kind: "finished"; toolName: string } | { kind: "running"; toolName: string }`

- [ ] **Step 1: Write the failing tests**

```ts
describe("chatRequestBody", () => {
  it("carries exactly the newest user message, nothing older", ...) // 5 messages => messages: [the last user], conversation_id, timezone, fellowship
  it("skips a trailing partial reply", ...)      // [user u1, assistant partial] => [u1]
  it("sends an answered card as the turn", ...)  // assistant with a part state "approval-responded" last => that message
  it("sends no messages when there is no turn", ...) // [assistant only] => []
  it("resends the same id on a retry", ...)      // the id is untouched
  it("omits an empty fellowship", ...)           // "" and undefined => no fellowship key
})
describe("isStaleRefusal", () => {
  it.each(["message_id_taken", "continuation_mismatch", "conversation_archived", "Access denied"])(
    "reads %s as stale", (message) => expect(isStaleRefusal(JSON.stringify({ error: "x", message }))).toBe(true))
  it("does not read a rate limit, a proxy page or plain text as stale", ...) // {message:"rate"}, "<html>", "boom" => false
})
describe("classifyToolPart", () => {
  it("renders a finished dynamic tool's output as a result", ...) // dynamic-tool, state output-available, toolName, output
  it("names a static tool from its type", ...)                     // tool-searchMeetings => toolName searchMeetings
  it("reads a legacy row with a result as a result", ...)          // tool-invocation, toolInvocationId, state "result", result
  it("reads a legacy row with no result as finished, never running", ...) // tool-invocation, state "call" => finished, toolName from the field, not "invocation"
  it("reads output-error and output-denied as finished", ...)
  it("reads input-streaming and input-available as running", ...)
  it("answers null for text, step-start and data parts", ...)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:unit -- app/utils/agentBodyLogic.test.ts app/utils/agentToolPartLogic.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both modules**

The stale set matches on the parsed body's `message` field, in `try`/`catch` around `JSON.parse`. A type-only `UIMessage` import from `ai`.

- [ ] **Step 4: Run the tests and `npm run compile`**

Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/utils/agentBodyLogic.ts app/utils/agentBodyLogic.test.ts app/utils/agentToolPartLogic.ts app/utils/agentToolPartLogic.test.ts
git commit -m "✨ feat(agent): the turn-only body, stale refusals and finished tool rows"
```

### Task 5: The screen reads from the agent and sends the turn

**Files:**
- Create: `app/hooks/useAgentConversation.ts`
- Modify: `app/screens/AgentScreen.tsx`, all nine `app/i18n/{en,ar,de,es,fr,pt,ru,th,uk}.ts`, `docs/translation-review-2026-08-03.md`
- Test: `app/hooks/useAgentConversation.test.tsx`, `app/screens/AgentScreen.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces:
  - `useAgentConversation({ agentUrl: string; enabled: boolean }): { view: AgentConversationView; chatState: MutableRefObject<{ busy: boolean; sentIds: Set<string> }>; retry(): void; reopenStale(): void; startNew(): void }`
  - `AgentConversationView = { phase: "loading" } | { phase: "failed" } | { phase: "ready"; id: string; history: UIMessage[]; historyFailed: boolean; readAt: number }`

Hook rules, each with a comment saying why:
- Runs `openConversation` on the false-to-true edge of `useIsFocused()` while `enabled`, and when `enabled` turns true. Bottom tabs stay mounted, so mount alone would run once per launch. Skips while `chatState.current.busy`.
- A generation counter drops a read that lands after `startNew` or a newer open.
- A read that lands while `busy`, or after `sentIds` changed since it started, is dropped whole: its answer predates the turn on screen, and applying it would erase that turn.
- Applies outcomes: `fresh` with `minted` calls `store.startNewConversation(id)` and shows it ready and empty. `fresh` without `minted` on the id already showing changes nothing and does not bump `readAt`: `sentIds` may hold a turn that failed before streaming, whose words are on screen, and a `setMessages([])` would erase them. `thread` calls `store.adoptConversation(id)` and empties `sentIds`. `keep` changes nothing. `failed` calls `store.forgetConversation()`, whatever the cause: a fresh id never reaches `failed`, and a listed id is listed again next open.
- `threadOnScreen` is the current view being `ready` with a non-empty history or non-empty `sentIds`.
- `startNew()` mints with `randomUUID` from `expo-crypto`, calls `store.startNewConversation`, empties `sentIds`, shows it as ready and empty, fires `trackEvent("agent_conversation_started")`, then calls `agentConversationsClient(agentUrl).archive({ except: id })` unawaited, logging a warn on `false`.
- `reopenStale()` calls `store.forgetConversation()`, empties `sentIds`, and runs the open with nothing on screen.

Screen rules:
- Outer `AgentScreen` keeps the consent gate and owns `input` state, so words survive `AgentChat` remounting. It renders loading, or the failed row (`agentScreen:loadFailed`, a `agentScreen:retry` button, composer not offered), or `<AgentChat key={view.id} … />`.
- `AgentChat` holds what was in the screen's body. `useChat({ id: conversationId, messages: history, transport })`, the transport built once with `useMemo`: `api`, `expoFetch`, `headers: () => api.agentHeaders()` and `prepareSendMessagesRequest: ({ id, messages }) => …`. It adds `turnOf(messages)?.id` to `chatState.sentIds` when that turn's role is user, and answers `{ body: chatRequestBody(id, messages, timezone, fellowshipRef.current) }`. `fellowshipRef` is updated each render, because the SDK keeps the first transport and the old static body went stale after a Settings change.
- Effects: mirror `status` into `chatState.busy`. On `status === "streaming"` call `store.markConversationOnAgent()`. When `readAt` changes and nothing is streaming, `setMessages(history)`.
- On an `error` where `isStaleRefusal(error.message)`: put the last user message's text back in `input`, call `clearError()` and `reopenStale()`, draw no row. Key the effect on `error`, so one refusal acts once. Any other error draws today's row. `historyFailed` draws the row with the retry and leaves the composer live.
- Tool parts go through `classifyToolPart`: `result` renders `ToolResultRenderer`, `running` renders today's badge, `finished` renders that badge's shape with a `checkmark-done` icon and `agentScreen:toolFinished`.
- FAB: `add` icon, `$fabMenuItem` background `colors.tint`, label `agentScreen:newConversation`. The alert uses the spec's copy; the action is not `destructive`. Remove `persistedIdsRef`, `prevStatusRef`, both store effects and the stale doc comment lines.

- [ ] **Step 1: Write the failing hook and screen tests**

```tsx
// useAgentConversation.test.tsx: useIsFocused, the client and expo-crypto mocked, a real store.
it("opens on the focus edge, not on every render", ...)
it("skips an open while a turn is busy", ...)
it("drops a read that lands after startNew", ...)                 // deferred read; startNew; resolve => the view stays on the new id
it("drops a read that lands after a send", ...)                   // sentIds gains an id mid-read => view and sentIds unchanged
it("leaves the view alone on a fresh id with a failed turn", ...) // refocus with sentIds set: same readAt, no read
it("empties sentIds when a thread is adopted", ...)
it("forgets the id on failed and shows the failed phase", ...)
it("startNew archives with except and shows ready and empty", ...) // archive({ except: id }) unawaited, trackEvent fired
it("reopenStale forgets, then opens with nothing on screen", ...)

// AgentScreen.test.tsx: @ai-sdk/react and the hook mocked.
it("puts the words back and reopens on a stale refusal, with no error row", ...) // error.message = JSON body of conversation_archived
it("draws today's row for any other error, with no reopen", ...)
it("acts once per refusal", ...)                                  // rerender with the same error object
it("sends the turn and records its id", ...)                      // call the transport's prepareSendMessagesRequest: one message in the body; chatState.sentIds holds its id
it("marks the conversation on the agent when streaming starts", ...)
```

Run: `npm run test:component -- app/hooks/useAgentConversation.test.tsx app/screens/AgentScreen.test.tsx`
Expected: FAIL, the hook does not exist and the screen does not behave so.

- [ ] **Step 2: Add the keys**

With Python, in all nine files' `agentScreen` block, add the spec's six strings exactly and remove `clearConversation`, `clearConversationConfirm`, `clear`, `clearChat`. Add the six to the translation review queue.

- [ ] **Step 3: Write the hook**

As above. The store's own tests are not touched here.

- [ ] **Step 4: Split the screen**

As above. Move styles only if a component needs them; both components stay in `AgentScreen.tsx`.

- [ ] **Step 5: Verify**

Run: `npm run test:component -- app/hooks/useAgentConversation.test.tsx app/screens/AgentScreen.test.tsx && npm run compile && npx eslint --fix app/hooks/useAgentConversation.ts app/hooks/useAgentConversation.test.tsx app/screens/AgentScreen.tsx app/screens/AgentScreen.test.tsx && npm run lint:deps`
Expected: tests pass, no type errors, no lint errors, no new dependency violations.

- [ ] **Step 6: Commit**

```bash
git add app/hooks/useAgentConversation.ts app/hooks/useAgentConversation.test.tsx app/screens/AgentScreen.tsx app/screens/AgentScreen.test.tsx app/i18n/en.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/es.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts docs/translation-review-2026-08-03.md
git commit -m "✨ feat(agent): Sky's thread comes from the agent and the body is the turn"
```

### Task 6: Delete User Data reaches the agent

**Files:**
- Modify: `app/screens/SettingsScreen.tsx` (step 3 of `handleDeleteUserData`), `docs/support/problems/delete-my-account.md`

**Interfaces:**
- Consumes: `agentConversationsClient` (Task 1), `isValidAgentUrl`, `store.forgetConversation()` (Task 3).

No test of its own: the step is inline in a large handler with nothing mounted around it, and its bound, its never-throw and its answer are pinned by Task 1's client tests. Device pass step 8 covers the rest.

- [ ] **Step 1: Change step 3**

```ts
// 3. Start Sky's conversation over. CHANGED 2026-11-06 (turn-only spec D7): the thread lives on
// the agent now, so a local reset alone would show it again at the next sign-in. Before sign-out
// because it needs the bearer; bounded because the person's delete must never wait on the agent.
// This archives and erases nothing, see the spec's "Privacy".
if (isValidAgentUrl(process.env.EXPO_PUBLIC_AGENT_URL)) {
  const archived = await agentConversationsClient(configStore.agentUrl).archive({ timeoutMs: 5000 })
  if (!archived) logger.error("Delete User Data: Sky's conversations were not archived")
}
conversationStore.forgetConversation()
```

Only this call site changes. The store loses `clearHistory` in Task 7.

- [ ] **Step 2: Correct the support doc**

In the table row for Delete User Data, replace "the handler makes no server call" with: it also archives the person's Sky conversations in builds where the tab exists, which hides them from the app and erases nothing. Keep "Anything on our servers" in what it does not delete.

- [ ] **Step 3: Verify**

Run: `npm run compile && npx eslint --fix app/screens/SettingsScreen.tsx`
Expected: no errors. `SettingsScreen.tsx` must pass `npm run lint:deps` too.

- [ ] **Step 4: Commit**

```bash
git add app/screens/SettingsScreen.tsx docs/support/problems/delete-my-account.md
git commit -m "✨ feat(settings): Delete User Data starts Sky's conversation over on the agent"
```

### Task 7: Nothing of a chat on the device

**Files:**
- Create: `app/db/ChatWipeRunner.tsx`
- Delete: `app/db/ChatHydrator.tsx`
- Modify: `app/models/ConversationStore.ts`, `app/db/index.ts`, `app/app.tsx`, `app/db/ReportPollingResumer.tsx` (its comment)
- Test: `app/models/ConversationStore.test.ts` (moved from `.test.tsx`), `app/db/ChatWipeRunner.test.tsx`

**Interfaces:**
- Consumes: `decideChatWipe` (Task 2), `chatMessageRepo.clear()` (`Promise<Result>`).
- Produces: `ChatWipeRunner` component, headless, in the slot `ChatHydrator` held.

- [ ] **Step 1: Move the store's tests and write the runner's, all failing**

`git mv` Task 3's test to `app/models/ConversationStore.test.ts`, drop its `@/db/repositories` mock and import from `vitest`.

```tsx
// ChatWipeRunner.test.tsx: useDatabase, chatMessageRepo and storage mocked
it("wipes once the database is seeded, and saves the flag on ok", ...)
it("does not save the flag when the wipe fails", ...)   // { ok: false } => no saveString, next launch tries again
it("does nothing in a build with no agent URL", ...)    // the hidden-tab production install: no clear, no flag
it("does nothing when the flag is saved", ...)
it("waits for the database", ...)                       // status not "seeded": no clear
```

Run: `npm run test:unit -- app/models/ConversationStore.test.ts` and `npm run test:component -- app/db/ChatWipeRunner.test.tsx`
Expected: FAIL, the store's `@/` imports do not resolve and the runner does not exist.

- [ ] **Step 2: Write the runner**

Once `useDatabase().status === "seeded"` and a ref says it has not run: when `decideChatWipe({ done: loadString("agent.chatWipe.done") !== null, agentUrlEnv: process.env.EXPO_PUBLIC_AGENT_URL })` holds, `await chatMessageRepo.clear()`. Save the flag only on an `ok` result, so a failed wipe tries again next launch. Log the outcome, never the rows. The header comment says why it does not run in production yet (spec D4).

- [ ] **Step 3: Strip the store**

Remove `hydrateFromSQLite`, `addMessage`, `addMessages`, `clearHistory`, `setLastSyncedAt`, `syncToSQLite`, the views `isHydrated`, `lastMessage`, `hasMessages`, `uiMessages`, the props `lastSyncedAt`, `messageCount`, `truncateToolMeetings`, `StoredMessage` and every `@/` import. Rewrite the header comment around the agent holding the history.

- [ ] **Step 4: Verify**

Run: `npm run test:unit -- app/models/ConversationStore.test.ts && npm run test:component -- app/db/ChatWipeRunner.test.tsx && npm run compile && npm run lint:deps && npx eslint --fix app/db/ChatWipeRunner.tsx app/db/ChatWipeRunner.test.tsx app/db/index.ts app/app.tsx app/models/ConversationStore.ts`
Expected: the store's and the runner's tests pass, no type errors or violations. `grep -rn "ChatHydrator\|clearHistory\|uiMessages" app` finds nothing but this task's own change comments.

- [ ] **Step 5: Commit**

```bash
git add app/db/ChatWipeRunner.tsx app/db/ChatWipeRunner.test.tsx app/db/ChatHydrator.tsx app/models/ConversationStore.ts app/models/ConversationStore.test.ts app/db/index.ts app/db/ReportPollingResumer.tsx
# app/app.tsx may carry another session's hunks: see "Shared checkout" in Global Constraints.
git commit -m "🔥 refactor(agent): no chat rows on the phone, and a one-time wipe where the tab exists"
```

### Task 8: Docs, full checks, and the device pass

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md` (the ConversationStore line, "repositories.ts" and "Resumer/hydrator" lines, "AI Agent Integration"), `EVENTS.md`, `docs/manual/map.md`, `TODO.md`

- [ ] **Step 1: Write the docs**

- `CHANGELOG.md` under `[Unreleased]`, in the spec's words, noting the tab is hidden in production and that this needs the agent releases of both designs.
- `CLAUDE.md`: the store's new shape, `ChatWipeRunner` for `ChatHydrator`, and the agent section: turn-only body, agent-held thread, fresh flag, the re-read rule, with `ADDED 2026-11-06`.
- `EVENTS.md`: rename the row to `agent_conversation_started`, "User started a new conversation".
- `docs/manual/map.md` "Where data lives": Sky keeps the conversation on RecoverySky's servers under the account, the one exception to "Nothing else moves between phones". "New conversation" and "Delete User Data" start it over without erasing it, and what Sky has learned stays.
- `TODO.md`: mark the Sky hand-off's history item decided, and add the three production gates from the spec's "Privacy" section: erasure, the promising words, and the production wipe.

- [ ] **Step 2: Run every check**

Run: `npm run compile && npm run test:unit && npm run test:component && npm run lint:deps && pnpm --dir /Users/jenova/projects/recoverysky-org/agent manual:ingest "$PWD/docs/manual" --dry-run`

Expected: all pass, exit 0.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md CLAUDE.md EVENTS.md docs/manual/map.md TODO.md
git commit -m "📝 docs(agent): the turn-only chat in the changelog, manual, events and CLAUDE.md"
```

- [ ] **Step 4: Device pass, once the agent ships both designs**

On a dev build with a local agent on those releases, confirm and record each:

1. A first message lands, and a request log shows one message in the body with `conversation_id`.
2. Kill and reopen the app: the thread comes back from the agent.
3. Tap New conversation, kill the app before sending: it opens empty, with no conversations request in the log.
4. Send on it, reopen: that thread is shown and the old one is not.
5. With a second simulator on the same account: New conversation on one, then send from the other. The words return to its composer, it moves to the new thread, and no error row shows.
6. Force a refused turn at crisis level (a chat limit set to zero): the resources show, and switching tabs and back keeps them.
7. Close a meeting popup from a result card: the card collapses to "Selected: …".
8. Run Delete User Data with the agent stopped: it finishes within about 5 seconds. Then with the agent up: the next sign-in opens empty.

If the agent has not shipped, leave this step open and say so. Do not report the feature as verified.
