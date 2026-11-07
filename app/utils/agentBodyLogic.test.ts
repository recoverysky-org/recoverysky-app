import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"

import { chatRequestBody, isStaleRefusal, turnOf } from "./agentBodyLogic"

const user = (id: string): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text: `words of ${id}` }],
})

const assistant = (id: string, parts: unknown[] = [{ type: "text", text: "a reply" }]) =>
  ({ id, role: "assistant", parts }) as UIMessage

/** Sky's card once the person has answered it, as the SDK holds it. */
const answeredCard = (id: string, before: unknown[] = []) =>
  assistant(id, [
    ...before,
    {
      type: "tool-addReminder",
      toolCallId: "call-1",
      state: "approval-responded",
      input: {},
      approval: { id: "approval-1", approved: true },
    },
  ])

describe("turnOf", () => {
  it("answers the newest user message", () => {
    const newest = user("u2")
    expect(turnOf([user("u1"), assistant("a1"), newest])).toBe(newest)
  })

  it("answers nothing for an empty list", () => {
    expect(turnOf([])).toBeNull()
  })

  it("skips a system message", () => {
    const newest = user("u1")
    expect(turnOf([newest, { id: "s1", role: "system", parts: [] }])).toBe(newest)
  })

  it("prefers a person's words typed after an answered card", () => {
    const newest = user("u2")
    expect(turnOf([user("u1"), answeredCard("a1"), newest])).toBe(newest)
  })

  it("does not read an unanswered card as the turn", () => {
    const newest = user("u1")
    const unanswered = assistant("a1", [
      { type: "tool-addReminder", toolCallId: "c", state: "approval-requested", input: {} },
    ])
    expect(turnOf([newest, unanswered])).toBe(newest)
  })

  // Parts read from the agent are checked only for being an array (isStoredMessage,
  // agentConversationsLogic.ts), so a junk entry reaches this walk. A throw here would be
  // thrown from inside the SDK's send, and the person's turn would never leave the phone.
  it.each([[null], [undefined], [7], ["text"], [[]]])(
    "treats the junk part %j as nothing",
    (junk) => {
      const newest = user("u1")
      expect(turnOf([newest, assistant("a1", [junk])])).toBe(newest)
    },
  )

  it("still finds the answer in a parts array that also holds junk", () => {
    const card = answeredCard("a1", [null])
    expect(turnOf([user("u1"), card])).toBe(card)
  })
})

describe("chatRequestBody", () => {
  it("carries exactly the newest user message, nothing older", () => {
    const newest = user("u3")
    const messages = [user("u1"), assistant("a1"), user("u2"), assistant("a2"), newest]

    expect(chatRequestBody("conv-1", messages, "America/Denver", "AA")).toEqual({
      conversation_id: "conv-1",
      messages: [newest],
      timezone: "America/Denver",
      fellowship: "AA",
    })
  })

  it("skips a trailing partial reply", () => {
    const u1 = user("u1")
    const body = chatRequestBody("conv-1", [u1, assistant("partial")], "UTC", undefined)
    expect(body.messages).toEqual([u1])
  })

  it("sends an answered card as the turn", () => {
    const card = answeredCard("a1")
    const body = chatRequestBody("conv-1", [user("u1"), card], "UTC", undefined)
    expect(body.messages).toEqual([card])
  })

  it("sends no messages when there is no turn", () => {
    const body = chatRequestBody("conv-1", [assistant("a1")], "UTC", undefined)
    expect(body.messages).toEqual([])
  })

  it("resends the same id on a retry", () => {
    // The agent stores a retry once under this id and replaces the reply it had stored
    // (agent R2), so a re-minted id would store the person's words a second time.
    const u1 = user("u1")
    const first = chatRequestBody("conv-1", [u1], "UTC", undefined)
    const retry = chatRequestBody("conv-1", [u1, assistant("partial")], "UTC", undefined)

    expect(first.messages[0].id).toBe("u1")
    expect(retry.messages[0].id).toBe("u1")
  })

  it.each([[""], [undefined]])("omits an empty fellowship (%j)", (fellowship) => {
    const body = chatRequestBody("conv-1", [user("u1")], "UTC", fellowship)
    expect(body).not.toHaveProperty("fellowship")
  })

  it("does not touch the list it was handed", () => {
    const messages = [user("u1"), assistant("partial")]
    chatRequestBody("conv-1", messages, "UTC", undefined)
    expect(messages.map((message) => message.id)).toEqual(["u1", "partial"])
  })
})

describe("isStaleRefusal", () => {
  it.each(["message_id_taken", "continuation_mismatch", "conversation_archived", "Access denied"])(
    "reads %s as stale",
    (message) => expect(isStaleRefusal(JSON.stringify({ error: "x", message }))).toBe(true),
  )

  it("does not read a rate limit, a proxy page or plain text as stale", () => {
    expect(isStaleRefusal(JSON.stringify({ error: "Too Many Requests", message: "rate" }))).toBe(
      false,
    )
    expect(isStaleRefusal("<html><body>502 Bad Gateway</body></html>")).toBe(false)
    expect(isStaleRefusal("boom")).toBe(false)
  })

  // A false positive here is what would lose words: the screen answers a stale refusal by
  // replacing the list, so only the agent's exact refusals may reach that path.
  it.each([
    ["the agent's other conflicts", JSON.stringify({ message: "conversation_guide_mismatch" })],
    ["a refusal word in plain text", "conversation_archived"],
    ["a refusal word as a bare JSON string", JSON.stringify("conversation_archived")],
    ["a refusal word in another field", JSON.stringify({ error: "conversation_archived" })],
    ["a message that only contains one", JSON.stringify({ message: "Access denied, try later" })],
    ["a message of another type", JSON.stringify({ message: ["message_id_taken"] })],
    ["JSON null", "null"],
    ["a JSON array", "[]"],
    ["a JSON number", "42"],
    ["an empty body", ""],
  ])("does not read %s as stale", (_name, body) => {
    expect(isStaleRefusal(body)).toBe(false)
  })
})
