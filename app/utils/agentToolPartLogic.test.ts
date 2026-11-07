import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"

import { classifyToolPart } from "./agentToolPartLogic"

describe("classifyToolPart", () => {
  it("renders a finished dynamic tool's output as a result", () => {
    const output = { meetings: [] }
    expect(
      classifyToolPart({
        type: "dynamic-tool",
        toolName: "searchMeetings",
        toolCallId: "call-1",
        state: "output-available",
        input: {},
        output,
      }),
    ).toEqual({ kind: "result", toolCallId: "call-1", toolName: "searchMeetings", output })
  })

  it("names a static tool from its type", () => {
    const output = { meetings: [] }
    expect(
      classifyToolPart({
        type: "tool-searchMeetings",
        toolCallId: "call-1",
        state: "output-available",
        input: {},
        output,
      }),
    ).toEqual({ kind: "result", toolCallId: "call-1", toolName: "searchMeetings", output })
  })

  it("reads a legacy row with a result as a result", () => {
    const result = { meetings: [] }
    expect(
      classifyToolPart({
        type: "tool-invocation",
        toolInvocationId: "call-1",
        toolName: "searchMeetings",
        args: {},
        result,
        state: "result",
      }),
    ).toEqual({ kind: "result", toolCallId: "call-1", toolName: "searchMeetings", output: result })
  })

  it("reads a legacy row with no result as finished, never running", () => {
    expect(
      classifyToolPart({
        type: "tool-invocation",
        toolInvocationId: "call-1",
        toolName: "searchMeetings",
        args: {},
        state: "call",
      }),
    ).toEqual({ kind: "finished", toolName: "searchMeetings" })
  })

  it("never names a legacy tool after its part type", () => {
    expect(classifyToolPart({ type: "tool-invocation", state: "call" })).toEqual({
      kind: "finished",
      toolName: "tool",
    })
  })

  it("reads a legacy result with no id as finished, since a card needs the id", () => {
    expect(
      classifyToolPart({
        type: "tool-invocation",
        toolName: "searchMeetings",
        result: { meetings: [] },
        state: "result",
      }),
    ).toEqual({ kind: "finished", toolName: "searchMeetings" })
  })

  it.each(["output-error", "output-denied"])("reads %s as finished", (state) => {
    expect(classifyToolPart({ type: "tool-addReminder", toolCallId: "c", state })).toEqual({
      kind: "finished",
      toolName: "addReminder",
    })
    expect(
      classifyToolPart({ type: "dynamic-tool", toolName: "addReminder", toolCallId: "c", state }),
    ).toEqual({ kind: "finished", toolName: "addReminder" })
  })

  it.each(["input-streaming", "input-available"])("reads %s as running", (state) => {
    expect(classifyToolPart({ type: "tool-searchMeetings", toolCallId: "c", state })).toEqual({
      kind: "running",
      toolName: "searchMeetings",
    })
    expect(classifyToolPart({ type: "dynamic-tool", toolName: "searchMeetings", state })).toEqual({
      kind: "running",
      toolName: "searchMeetings",
    })
  })

  it.each([[null], [undefined]])(
    "reads output-available with a %s output as finished",
    (output) => {
      expect(
        classifyToolPart({
          type: "tool-searchMeetings",
          toolCallId: "c",
          state: "output-available",
          output,
        }),
      ).toEqual({ kind: "finished", toolName: "searchMeetings" })
    },
  )

  it("reads output-available with no tool call id as finished", () => {
    expect(
      classifyToolPart({ type: "tool-searchMeetings", state: "output-available", output: {} }),
    ).toEqual({ kind: "finished", toolName: "searchMeetings" })
  })

  it("keeps a falsy output that is really there", () => {
    expect(
      classifyToolPart({
        type: "tool-count",
        toolCallId: "c",
        state: "output-available",
        output: 0,
      }),
    ).toEqual({ kind: "result", toolCallId: "c", toolName: "count", output: 0 })
  })

  it("falls back to a generic name for a dynamic tool with no usable name", () => {
    expect(classifyToolPart({ type: "dynamic-tool", state: "input-available" })).toEqual({
      kind: "running",
      toolName: "tool",
    })
    expect(classifyToolPart({ type: "dynamic-tool", toolName: 7, state: "output-error" })).toEqual({
      kind: "finished",
      toolName: "tool",
    })
    expect(classifyToolPart({ type: "tool-", state: "output-error" })).toEqual({
      kind: "finished",
      toolName: "tool",
    })
  })

  // This screen has no approval cards. "Using addReminder…" would spin for good on a card
  // nobody here can answer, and "addReminder finished" would claim something that was not done.
  it.each(["approval-requested", "approval-responded"])("draws nothing for %s", (state) => {
    expect(classifyToolPart({ type: "tool-addReminder", toolCallId: "c", state })).toBeNull()
  })

  it.each([[undefined], ["some-future-state"], [7]])("draws nothing for a state of %j", (state) => {
    expect(classifyToolPart({ type: "tool-searchMeetings", toolCallId: "c", state })).toBeNull()
  })

  it("answers null for text, step-start and data parts", () => {
    expect(classifyToolPart({ type: "text", text: "hello" })).toBeNull()
    expect(classifyToolPart({ type: "step-start" })).toBeNull()
    expect(classifyToolPart({ type: "data-crisis", data: {} })).toBeNull()
  })

  it.each([[null], [undefined], [7], ["tool-x"], [[]], [{}], [{ type: 7 }]])(
    "answers null for the junk part %j, without throwing",
    (junk) => {
      expect(classifyToolPart(junk as never)).toBeNull()
    },
  )

  it("takes the SDK's own part type, so the screen needs no cast", () => {
    const parts: UIMessage["parts"] = [
      { type: "text", text: "hello" },
      { type: "dynamic-tool", toolName: "t", toolCallId: "c", state: "input-available", input: {} },
    ]
    expect(parts.map((part) => classifyToolPart(part))).toEqual([
      null,
      { kind: "running", toolName: "t" },
    ])
  })
})
