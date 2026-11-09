import { act, fireEvent, render, screen } from "@testing-library/react-native"

import { ConversationStoreModel } from "@/models/ConversationStore"

import { ToolResultRenderer } from "./ToolResultRenderer"

// The real hook warns once per run with no i18next instance, and answers the key anyway.
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}))

jest.mock("expo-localization", () => ({
  getLocales: () => [{ measurementSystem: "us" }],
}))

// My Day's own English words, as in RoutineResultsCard.test.tsx; the photo is a bundled JPEG.
jest.mock("@/hooks/useMyDayCopy", () => ({
  useMyDayCopy: () => jest.requireActual("@daily-dash/my-day/copy").defaultMyDayCopy,
}))
jest.mock("@/theme/myDayPhotos", () => ({ coldStartMyDayPhoto: () => ({ uri: "photo" }) }))

let mockStore: ReturnType<typeof ConversationStoreModel.create>
jest.mock("@/models", () => ({
  useConversationStore: () => mockStore,
}))

/** A meetings-mcp Meeting (api docs/mcp-tools.md) */
const mcpMeeting = {
  id: "m1",
  name: "Sunrise Serenity",
  fellowship: "AA",
  venue: "online",
  hybrid: false,
  language: "en",
  favorite: false,
  startsAt: { iso: "2026-11-09T01:15:00.000Z", local: "Sun, 7:15 PM", timezone: "UTC" },
  continuous: false,
}

/** The MCP bridge's output: the server's one text part, holding the JSON */
const envelope = (payload: unknown, isError = false) => ({
  isError,
  content: [{ type: "text", text: JSON.stringify(payload) }],
})

const partOf = (toolName: string, result: unknown, toolCallId = "call-1") => ({
  type: "tool-result" as const,
  toolCallId,
  toolName,
  result,
})

const meetingsPart = partOf(
  "find_meetings_now",
  envelope({ total: 1, returned: 1, meetings: [mcpMeeting] }),
)

// The real store and the real card, because what this pins is the wiring between them.
describe("ToolResultRenderer", () => {
  beforeEach(() => {
    mockStore = ConversationStoreModel.create({})
  })

  // The bug of 2026-11-08: meetings-mcp's results reached the screen and drew no meeting, because
  // the renderer knew only the retired tools' names and read the meetings off the output itself.
  it("draws meetings-mcp's meetings as a card", () => {
    render(<ToolResultRenderer part={meetingsPart} messageId="reply" onSelectMeeting={jest.fn()} />)
    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()
  })

  // The agent promises every meeting a tool returns reaches the person as a card.
  it("draws a card for any tool whose answer holds meetings", () => {
    render(
      <ToolResultRenderer
        part={partOf("get_meeting", envelope({ meeting: mcpMeeting, occurrences: null }))}
        messageId="reply"
        onSelectMeeting={jest.fn()}
      />,
    )
    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()
  })

  it("hands the tapped meeting back with its tool call", () => {
    const onSelect = jest.fn()
    render(<ToolResultRenderer part={meetingsPart} messageId="reply" onSelectMeeting={onSelect} />)
    fireEvent.press(screen.getByText("Sunrise Serenity"))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1", venue: "online" }),
      "call-1",
    )
  })

  it.each([
    ["a tool with no meetings", partOf("recall_memory", { memories: [] })],
    ["a refusal", partOf("find_meetings_now", envelope({ code: "rate_limited" }, true))],
    [
      "a retired tool's list",
      partOf("findMeetings", { meetings: [{ id: "m1", name: "Sunrise", time: "7:00 PM" }] }),
    ],
  ])("draws the finished badge for %s", (_name, part) => {
    render(<ToolResultRenderer part={part} messageId="reply" onSelectMeeting={jest.fn()} />)
    expect(
      screen.getByText(`agentScreen:toolFinished ${JSON.stringify({ toolName: part.toolName })}`),
    ).toBeTruthy()
    expect(screen.queryByText("agentScreen:noMeetingsFound")).toBeNull()
  })

  // Spec D5: the collapse state lives in the store's volatile map. As a plain component the renderer
  // read it once, and the card never redrew when its popup closed. The observer wrap is the fix.
  it("collapses the card when the store's map changes", () => {
    render(<ToolResultRenderer part={meetingsPart} messageId="reply" onSelectMeeting={jest.fn()} />)
    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()

    act(() => {
      mockStore.collapseToolResult("call-1", "Selected: Sunrise Serenity")
    })

    expect(screen.getByText("Selected: Sunrise Serenity")).toBeTruthy()
    expect(screen.queryByText("Sunrise Serenity")).toBeNull()
  })

  // The card holds every meeting the call returned, and the agent tells Sky each one reaches the
  // person as a card they can tap, so closing one meeting must not hide the rest for good.
  it("opens the card again when its badge is tapped", () => {
    render(<ToolResultRenderer part={meetingsPart} messageId="reply" onSelectMeeting={jest.fn()} />)
    act(() => {
      mockStore.collapseToolResult("call-1", "Selected: Sunrise Serenity")
    })

    fireEvent.press(screen.getByRole("button", { name: "Selected: Sunrise Serenity" }))

    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()
    expect(mockStore.getCollapseState("call-1")).toBeNull()
  })

  it("leaves the card open when another tool call collapses", () => {
    render(<ToolResultRenderer part={meetingsPart} messageId="reply" onSelectMeeting={jest.fn()} />)

    act(() => {
      mockStore.collapseToolResult("call-2", "Selected: another")
    })

    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()
  })

  // The Daily Dash MCP server sends the API's JSON as structuredContent and as the text part.
  describe("a get_today answer", () => {
    const todayAnswer = {
      asOf: { date: "2026-11-08", timezone: "America/Chicago" },
      recordable: true,
      routine: {
        weekStart: "2026-11-02",
        items: [
          {
            id: "r1",
            title: "Call my sponsor",
            bucket: "afternoon",
            timeOfDay: "12:30",
            sortOrder: 0,
            tick: null,
            weekDone: 2,
          },
        ],
        warnings: [],
      },
      steering: null,
      tonight: { date: "2026-11-08", exists: false },
      word: null,
      quote: null,
      sky: { schedule: null },
    }
    const todayPart = partOf("get_today", {
      ...envelope(todayAnswer),
      structuredContent: todayAnswer,
    })

    it("draws the routine card, not a finished badge", () => {
      render(<ToolResultRenderer part={todayPart} messageId="reply" onSelectMeeting={jest.fn()} />)

      expect(screen.getByText("My Daily Routine")).toBeTruthy()
      expect(screen.getByText("Call my sponsor")).toBeTruthy()
      expect(screen.queryByText(/agentScreen:toolFinished/)).toBeNull()
    })

    it("hands the My Day link the screen's callback", () => {
      const onOpenMyDay = jest.fn()
      render(
        <ToolResultRenderer
          part={todayPart}
          messageId="reply"
          onSelectMeeting={jest.fn()}
          onOpenMyDay={onOpenMyDay}
        />,
      )

      fireEvent.press(screen.getByRole("button", { name: "agentScreen:openMyDay" }))
      expect(onOpenMyDay).toHaveBeenCalledTimes(1)
    })

    // A collapse is for a card a person picked from; a routine card is never picked, so a stale
    // entry for its call id must not hide it.
    it("ignores the collapse map", () => {
      mockStore.collapseToolResult("call-1", "Selected: something")
      render(<ToolResultRenderer part={todayPart} messageId="reply" onSelectMeeting={jest.fn()} />)

      expect(screen.getByText("Call my sponsor")).toBeTruthy()
    })

    it("draws a refused get_today as the finished badge", () => {
      const refused = partOf("get_today", envelope("The Daily Dash could not be reached", true))
      render(<ToolResultRenderer part={refused} messageId="reply" onSelectMeeting={jest.fn()} />)

      expect(screen.queryByText("My Daily Routine")).toBeNull()
      expect(screen.getByText(/agentScreen:toolFinished/)).toBeTruthy()
    })
  })
})
