# Sky's chat sends the turn only: the agent owns the history

Status (2026-11-08): Built and planned. In the v4.13.0 tag (`1a668aa`); the Sky tab is hidden in production, and the device pass and the gates before it returns are in TODO.md.

Status when written: design, drafted 2026-11-06 from a brainstorm with Jenova. Not planned, not built. Builds
after the agent's side ships (`recoverysky-org/agent/docs/superpowers/specs/2026-11-06-sky-context-per-turn-design.md`,
the authority on what the agent does with a turn: its wire section and rulings R1 to R3 and R13) and
its archive route ships (`recoverysky-org/agent/docs/superpowers/specs/2026-11-06-conversation-archive-design.md`,
rulings A1 to A6, written for the agent team on Jenova's ruling of 2026-11-06).
This mirrors the Daily Dash app's change of the same date
(`the-daily-dash-app/docs/superpowers/specs/2026-11-06-sky-chat-turn-only-design.md`), which that app
makes to the same route.

JS-only: no native module, no plugin, no `app.json` change of its own, so it can ride an OTA. The Sky tab
is hidden in production builds (no `EXPO_PUBLIC_AGENT_URL`, CLAUDE.md "Main tabs"), but `npm run update`
still publishes this code to production installs, so everything here that touches a phone without the
tab is gated (D4, D7). Root also carries a native module for Support Contacts since 2026-11-06, so
which release this rides is decided when it is cut.

## Why

`AgentScreen` sends the whole conversation on every turn and no `conversation_id`, so on the agent
each turn is a fresh conversation and the app is the only place the thread exists, in encrypted
SQLite. The agent now builds a turn's context from the history it holds, keeps a rolling summary of
the older part and caches the prefix, so a long conversation costs a fraction of what it did and Sky
remembers further back. For that the app has to say which conversation a turn belongs to, send only
the turn, and read the history back from the agent, as the Daily Dash app already does.

## What the person gets

- The same Sky tab: the thread they scroll, the meeting cards and tool results, voice input, the FAB.
- A thread that survives a reinstall and shows on a second device, because the agent holds it.
- Sky remembering the start of a long conversation instead of quietly losing it.
- **New conversation** in place of **Clear conversation** on the screen's FAB (Settings has no such
  row; its only call to the store is Delete user data, D7): the thread starts over on this device at
  once and on the person's other devices at their next open. The old one is archived on the agent:
  no app shows it again, and it is not erased (see "Privacy"). Nothing of a chat is kept on the device
  any more, so there is nothing on it to wipe.

## Decisions

- **D1. The conversation is the agent's newest, read on every open, unless this device has just
  started a new one.** `ConversationStore` keeps two persisted props (snapshot, MMKV, as its other
  props): `conversationId: string | null` and `conversationIsFresh: boolean`. An id is *fresh* when it
  was minted here and the agent has not yet taken a turn on it.
  - **Fresh:** the open reads nothing. The listing would answer an older thread and undo New
    conversation, and the messages read could only answer `404` for an id the agent has never seen
    (404s are what CrowdSec bans for). The thread is empty and the composer is live.
  - **Not fresh, or no id:** the open asks for the newest `base-identity` conversation
    (`GET /api/v1/conversations?guide=base-identity&limit=1`, the agent's default guide). A listed
    conversation's `conversationId` becomes the id, not fresh, and D3 reads its messages. None listed:
    mint a UUID on the device, fresh. The agent creates it on the first turn and lists it from then on.
    Two devices thereby stay on one thread, as the Daily Dash app does (its D8).
  - **The flag clears** the moment a turn starts streaming, because by then the agent has stored the
    person's message (agent R2). A turn that fails before that leaves the id fresh, so nothing is lost
    and nothing is read. Accepted corner: a refused turn at crisis level streams the crisis resources
    and stores no message, so the flag clears with at most an empty row behind it. That row is the
    newest, so the next open lands on an empty thread; only a failed conversation check at crisis level
    leaves no row, and then the listing answers whatever is newest.
  - **Open** means each time the Sky tab comes into focus with a session and with AI consent accepted,
    not only on mount: bottom tabs stay mounted, so a mount-only read would run once per launch and
    New conversation on another device would never arrive. No read runs while a reply streams or
    before consent. A re-read over a thread already on screen never blanks it; a failed one keeps the
    thread and logs.
  - **What a re-read may replace.** Some turns exist only on this screen: the agent stores nothing for
    a refused turn, including the crisis resources it streams for one (`crisisFallback`), and a failed
    turn's words were never answered. A tab switch must not erase those, least of all a crisis reply.
    The agent stores every admitted turn under the client's message id (agent R2), so the screen keeps
    the ids it sent on this conversation. Before a focus re-read may change anything, each must be in
    the mounted conversation's stored messages. If one is not, or that read fails, the screen stays
    exactly as it is and nothing is listed. Once all are found the open continues, and the set empties when that open replaces the thread (a listing that then fails keeps the screen and the set; one more read next focus).
    No wire marker is needed, since the id itself says whether the agent kept the turn. These replies do
    not survive a restart: the agent has no row for them and the device keeps nothing (accepted).
  - **Failures.** With nothing on screen, a listing that fails (offline, `503`) shows the screen's error
    row with a retry and the composer waits: the chat needs the agent anyway, and minting now would
    fork the thread. An id the agent refuses on the messages read (`403`, `404`: the owner was
    relinked, the thread is gone) is dropped and the listing runs once more; a second refusal is the
    error row. A reply that does not parse counts as a failed read, never a crash.
  - The listing and the messages read use `api.agentHeaders()` like the chat does; the agent guards
    `/api/v1/conversations` with the same user guards as `/api/v1/chat`.
  - **Older builds' fragments.** Those builds sent no `conversation_id`, so each turn is a one-exchange
    conversation of its own, not a thread. The agent retires them once (agent A4), so the app adopts
    whatever the listing answers, with no first-run rule. CHANGED 2026-11-06 (builder recon): this
    design first skipped the listing on the first run of a build. A reinstall also looks like a first
    run, so that rule would have hidden the person's real thread, against "survives a reinstall".
  - **Accepted limit.** Two devices that each mint a fresh id before either sends make two threads; the
    newest by last message wins on each device's next open once neither is fresh. A device holding a
    fresh id does not pick up the other device's turns until it sends or starts over. A turn that failed
    before the agent admitted it, on a thread already on the agent, keeps its id in the sent set, so that
    device holds its screen at each focus and shows no other device's turns until a restart, New
    conversation, or a send that earns D8. No words are lost (accepted, final-of-task review 2026-11-06).
- **D2. The body is the turn.** `DefaultChatTransport` gets `prepareSendMessagesRequest` (the static
  `body` goes): `({ messages }) => ({ body: { conversation_id, messages: [the turn], timezone,
  fellowship } })`, where the turn is the newest message that is the person's or an answered card, as
  the AI SDK hands the list, nothing older. A trailing assistant message with no `approval-responded`
  part is a partial reply the SDK kept after a failed stream and is skipped (the agent skips it too).
  A retry after a failed reply resends the same message with the same id; the agent stores it once and
  replaces a reply it had stored (agent R2). The pure part, `agentBodyLogic.ts`
  (`chatRequestBody(conversationId, messages, timezone, fellowship)`), is vitest-covered.
- **D3. The history comes from the agent.** On open, once the id is known, `GET
  /api/v1/conversations/{id}/messages?limit=200` answers the messages (`id`, `role`, `parts`,
  `metadata`) and the screen gives them to `useChat` as its initial messages (`setMessages` when the
  read lands after mount). A read that fails leaves the thread empty with the screen's existing error
  row and a retry; the person can still send (the agent has the history either way). The agent's
  `summary` is never shown and never requested.
- **D4. Nothing of a chat on the device.** `ConversationStore` stops holding messages: `hydrateFromSQLite`,
  `addMessage`, `addMessages`, `syncToSQLite`, `uiMessages`, `lastMessage`, `hasMessages`,
  `messageCount` and `lastSyncedAt` go, and `ChatHydrator` with them. The chat rows in the encrypted
  SQLite are deleted once by an app-side pass with a done flag, the pattern `BackupPassRunner` uses, not
  a migration: the migration list is drizzle's inside the vendored `@recoverysky-org/common`, and a
  common release should not gate this (builder check, 2026-11-06). **The pass runs only in a build with
  a valid agent URL** (`isValidAgentUrl(process.env.EXPO_PUBLIC_AGENT_URL)`). CHANGED 2026-11-06 (builder
  check): an OTA reaches production installs with the tab hidden, where those rows are a person's only
  readable copy of chats from before the tab was hidden, with no notice and no way to see they are gone.
  Unread and encrypted, they cost nothing where they are, and Delete User Data still removes them. The
  pass therefore runs in production only once the tab returns there, which is a decision to make
  knowingly, and `TODO.md` records it. This mirrors the Daily Dash app's D8 ("the agent holds the history").
- **D5. Collapsed tool results.** `collapseToolResult` kept its summary in the stored message's
  metadata. It becomes a volatile map in the store, `collapsedToolResults: Map<toolCallId, summary>`,
  not persisted and replaced on each write so MobX notices: a reload shows the meeting's tool result
  expanded again, which is what the agent stored. The selection works as today. One visible change:
  the old action looked for parts typed `tool-result`, and the SDK's stored parts are typed `tool-*` or
  `dynamic-tool`, so it never found one and the card never collapsed. Keyed by `toolCallId` alone, the
  card now collapses to "Selected: …" when the popup closes, as the code always meant it to.
- **D6. New conversation.** `clearHistory` becomes `startNewConversation(id)`: the freshly minted id
  goes in the store, fresh, and the screen's chat restarts on it. The app then calls
  `POST /api/v1/conversations/archive` with `{ guide: "base-identity", except: <the new id> }` without
  waiting: `except` means it can land before or after the first turn (agent A1). A failed call logs a
  warn. This device stays on the new thread regardless (the fresh flag), and once its first turn lands
  the new thread is the newest anyway, so the only cost is that a second device sees the old thread
  until then. The alert's copy changes with it (`agentScreen:newConversation`,
  `newConversationConfirm`, `start`) in `en` and English placeholders in the other locales, as the
  house does, and the action is no longer styled destructive, since nothing is lost. The thread is
  archived, not erased (agent A5): what Sky remembers long-term stays.
- **D7. Delete user data.** Settings' Delete user data resets the store locally today
  (`SettingsScreen.tsx`, `conversationStore.clearHistory()`). With the thread on the agent, a local
  reset alone would show the same thread again at the next sign-in (D1 lists the newest), and nothing
  local survives the wipe to prevent it. So step 3 now calls the archive route with
  `{ guide: "base-identity" }` and no `except`, then forgets the id. It runs before sign-out because it
  needs the bearer, is bounded at 5 seconds, and never blocks the delete: a failure logs at error, as
  the reminders' rejected delete does, and that thread comes back at the next sign-in. It runs only
  when the build has a valid agent URL (`isValidAgentUrl(process.env.EXPO_PUBLIC_AGENT_URL)`, not
  `configStore.agentUrl`, which is never empty), so production builds with the tab hidden make no call.
  It deliberately does not key on premium: a lapsed subscriber's thread still goes. After it the next
  sign-in lists nothing and starts empty. The earlier thread stays on the agent. Nothing removes it
  today: the agent's purge (`DELETE /api/v1/subjects/{sub}`) is a service-token route called only by
  the Daily Dash API, and `docs/support/problems/delete-my-account.md` says no server rows are deleted
  for a RecoverySky account. Whether Delete user data should really erase it is Jenova's call, open in
  this design; see "Privacy".
- **D8. The agent's refusals that mean the thread is stale.** `400 message_id_taken` and
  `400 continuation_mismatch` (the card was answered on another device, or the thread moved on),
  `409 conversation_archived` (New conversation on another device, agent A2) and `403` "Access denied"
  (the owner was relinked) all mean the thread in memory is stale, and a retry would repeat them. The
  screen drops the id if the thread is gone, re-lists and re-reads (D1, D3), draws no error row, and
  **puts the person's words back in the composer**, since the re-read replaces the list they were in. Only the last message's words return: an earlier turn that exists only on screen, such as an unstored crisis reply, goes with the list (accepted, builder's call 2026-11-06; it takes a refused turn and an archive elsewhere together).
  The SDK surfaces a non-2xx answer as an error whose `message` is the response body, so the classifier
  in `agentBodyLogic.ts` parses that JSON and is vitest-covered; a body that is not JSON (a proxy's 502
  page) is not stale. A message at the agent's refused crisis level gets the crisis resources from the
  agent (agent A2) as a stream, so it never reaches this path and stays on screen (D1). This screen has no approval cards yet, so `message_id_taken` and `continuation_mismatch` should
  not arise here; they are classified anyway, as they cost one line each.
- **D9. Rows from before this agent.** The agent answers a row stored without parts as a
  `tool-invocation` part (`toolName`, `args`, `result`, `state: "result" | "call"`). The screen's prefix
  check reads that as a tool called "invocation" with no output and shows "Using invocation…" for good.
  Such a part, and any tool part in a finished state (`output-error`, `output-denied`), renders as a
  finished tool, never as "Using tool…"; a legacy part with a `result` for a meeting tool still renders
  its card. The decision is a pure function, vitest-covered.
- **D10. The agent's rollout.** This build waits for the agent release that ships both its designs. Against
  an older agent the body still parses (the agent reads the last message either way) but each turn
  would run on a fresh conversation with no history, as today; against the new agent an older app
  build keeps working as today too, minus history, since it sends no id (agent R13).

## Privacy, in one place

The thread leaves the device: it lives on the agent under the person's subject, as the Daily Dash
app's does. The device keeps the conversation id and nothing of what was said. The one-time SQLite
wipe (D4) removes what earlier builds kept, where the tab exists.

**New conversation and Delete user data archive the thread: no app shows it again, and it is not
erased.** What Sky remembers long-term stays too (agent A5). Nothing erases any of this for a
RecoverySky account today (D7). This is not new, since the agent already stores every turn, but this
design is what makes "Delete" look complete, so it matters more. Three things must be settled before
the tab returns to production, none of which changes this build:

- Whether Delete user data should erase on the agent (an erase route, a change for the agent team).
- The words that promise otherwise: `settingsScreen:deleteUserDataConfirm` ("delete all your user data"),
  `onboarding:privacyControlBody` ("Your records stay on this device unless you send a report or turn on
  cloud backup"), and the AI consent text, which is CMS content, not in this repo.
- When the production wipe runs (D4).

## Copy (English; the other eight locales ship English placeholders)

- `agentScreen:newConversation`: "New conversation"
- `agentScreen:newConversationConfirm`: "Start a new conversation with Sky? You can't go back to this one from the app."
- `agentScreen:start`: "Start"
- `agentScreen:loadFailed`: "Couldn't load your conversation with Sky."
- `agentScreen:retry`: "Try again"
- `agentScreen:toolFinished`: "{{toolName}} finished"

The old keys `clearConversation`, `clearConversationConfirm`, `clear` and `clearChat` go from all nine
files; nothing else uses them.

## Also in this change

- `CHANGELOG.md` under `[Unreleased]` (OTA): the Sky tab sends only the message you typed; Sky keeps
  the conversation and a summary of its older part, so long conversations cost less and she remembers
  further back; the thread is read from Sky on open and no longer kept on the phone; Clear conversation
  is New conversation.
- `CLAUDE.md`'s AgentScreen and ConversationStore paragraphs follow the store's new shape.
- `EVENTS.md`: `agent_message_sent` unchanged; `agent_conversation_cleared` becomes
  `agent_conversation_started`. The old row names an event nothing fires; the new one is fired from
  `startNewConversation`'s caller.
- `docs/manual/map.md`'s "Where data lives" (same-commit rule): Sky keeps the conversation on RecoverySky's
  servers under the account, it is the one exception to "nothing else moves between phones", New
  conversation and Delete User Data start it over without erasing it, and what Sky has learned stays.
- `docs/support/problems/delete-my-account.md`: its table says Delete User Data makes no server call,
  which D7 changes. It now also archives the person's Sky conversations, which erases nothing.
- `TODO.md`: the Sky hand-off's "second history model" item is decided by this design, and the three
  production gates from "Privacy" are recorded under it.

## Non-goals

- Search over the thread, paging past 200 messages, erasing a conversation on the agent, any sign to
  the person that the older part was summarised: none of these, by Jenova's rulings of 2026-11-06.
- Going back to an archived thread, and a retry button for a failed turn (the screen has none today;
  the error row's retry is only for loading): builder's calls, 2026-11-06, not Jenova's rulings.

## Left to the builder

- Where the listing and messages reads live (`services/api/index.ts` beside `agentHeaders`, or an
  `agentConversations.ts`), and their vitest-covered response parsing.
- The one-time wipe's done flag and where it runs (the store's hydration point is the natural one).
- Whether the initial messages go through `useChat({ messages })` on a late mount or `setMessages`
  on arrival; both exist in the screen today.
