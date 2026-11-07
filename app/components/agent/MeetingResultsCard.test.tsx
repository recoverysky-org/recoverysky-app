import { render, screen } from "@testing-library/react-native"

import { MeetingResultsCard } from "./MeetingResultsCard"

// The real hook warns once per run with no i18next instance, and answers the key anyway.
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const EMPTY = "agentScreen:noMeetingsFound"

const goodMeeting = {
  id: "m1",
  name: "Sunrise Serenity",
  fellowship: "AA",
  language: "en",
  millis: new Date(2026, 7, 4, 7, 0).getTime(),
  feedback: null,
}

type CardResult = Parameters<typeof MeetingResultsCard>[0]["result"]

function mountCard(result: unknown) {
  return render(
    <MeetingResultsCard toolCallId="call-1" result={result as CardResult} isCollapsed={false} />,
  )
}

// Stored rows come back from the agent with nothing checked but that `parts` is an array, and a row
// comes back on every open. A throw here would take the tab down each time (spec D1: never a crash).
describe("MeetingResultsCard", () => {
  describe.each(["meetings", "results", "data"])("a result whose %s is not a list", (field) => {
    it.each([
      ["an object", { not: "a list" }],
      ["a string", "not a list"],
      ["a number", 7],
    ])("draws the empty state for %s", (_name, value) => {
      mountCard({ [field]: value })
      expect(screen.getByText(EMPTY)).toBeTruthy()
    })
  })

  it.each([
    ["null", null],
    ["a string", "not a result"],
    ["a number", 7],
    ["a list", [goodMeeting]],
  ])("draws the empty state when the result itself is %s", (_name, result) => {
    mountCard(result)
    expect(screen.getByText(EMPTY)).toBeTruthy()
  })

  it("takes the first field that is a list, past one that is not", () => {
    mountCard({ meetings: "not a list", results: { nope: true }, data: [goodMeeting] })
    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()
  })

  it("draws the rows it can, past junk in the list", () => {
    mountCard({
      meetings: [
        null,
        7,
        "a string",
        {},
        { ...goodMeeting, id: "m2", name: { not: "a string" } },
        { ...goodMeeting, id: "m3", fellowship: { not: "a string" } },
        { ...goodMeeting, id: "m4", language: 5 },
        { ...goodMeeting, id: "m5", millis: "soon" },
        goodMeeting,
      ],
    })
    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()
    expect(screen.getAllByRole("button")).toHaveLength(1)
  })

  it("draws the empty state for a list of nothing but junk", () => {
    mountCard({ meetings: [null, 7, {}] })
    expect(screen.getByText(EMPTY)).toBeTruthy()
  })

  it("still draws a meeting that has only some of its fields", () => {
    mountCard({ meetings: [{ id: "m1", name: "Sunrise Serenity" }] })
    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()
  })
})
