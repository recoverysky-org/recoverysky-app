import { fireEvent, render, screen } from "@testing-library/react-native"

import type { SkyMeeting } from "@/utils/agentMeetingsLogic"

import { MeetingResultsCard } from "./MeetingResultsCard"

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

const EMPTY = "agentScreen:noMeetingsFound"

const meeting = (overrides: Partial<SkyMeeting> = {}): SkyMeeting => ({
  id: "m1",
  name: "Sunrise Serenity",
  fellowship: "AA",
  language: "en",
  venue: "online",
  hybrid: false,
  continuous: false,
  startsAt: Date.now(),
  favorite: false,
  venueName: null,
  distanceM: null,
  scheduled: true,
  ...overrides,
})

function mountCard(meetings: SkyMeeting[], onSelectMeeting = jest.fn()) {
  render(
    <MeetingResultsCard
      meetings={meetings}
      isCollapsed={false}
      onSelectMeeting={onSelectMeeting}
    />,
  )
  return onSelectMeeting
}

describe("MeetingResultsCard", () => {
  it("draws a row for every meeting", () => {
    mountCard([meeting({ id: "a", name: "First" }), meeting({ id: "b", name: "Second" })])
    expect(screen.getByText("First")).toBeTruthy()
    expect(screen.getByText("Second")).toBeTruthy()
    expect(
      screen.getByText(`agentScreen:meetingsFound ${JSON.stringify({ count: 2 })}`),
    ).toBeTruthy()
  })

  // The agent's cards rule: every meeting a call returned reaches the person. The old card stopped
  // at ten and said so in English.
  it("draws past ten, with no cap", () => {
    mountCard(
      Array.from({ length: 12 }, (_, index) => meeting({ id: `m${index}`, name: `M${index}` })),
    )
    expect(screen.getAllByRole("button")).toHaveLength(12)
    expect(
      screen.getByText(`agentScreen:meetingsFound ${JSON.stringify({ count: 12 })}`),
    ).toBeTruthy()
  })

  it("hands the tapped meeting back", () => {
    const tapped = meeting({ id: "b", name: "Second" })
    const onSelect = mountCard([meeting({ id: "a", name: "First" }), tapped])
    fireEvent.press(screen.getByText("Second"))
    expect(onSelect).toHaveBeenCalledWith(tapped)
  })

  it("shows the heart on the server's favorites only", () => {
    mountCard([meeting({ id: "a", favorite: true }), meeting({ id: "b", favorite: false })])
    expect(screen.getAllByTestId("favorite-heart")).toHaveLength(1)
  })

  it("draws an always-on room as 24h", () => {
    mountCard([meeting({ continuous: true, startsAt: null })])
    expect(screen.getByText("24h")).toBeTruthy()
  })

  // MeetingRow's time reads "7:15p". The first row is the control: without it, a pattern that
  // never matched would pass the second.
  const CLOCK = /^\d{1,2}:\d{2}[ap]$/
  it("draws a meeting with no start without a time", () => {
    mountCard([meeting({ id: "a", name: "Timed" })])
    expect(screen.getByText(CLOCK)).toBeTruthy()
    screen.unmount()

    mountCard([meeting({ startsAt: null })])
    expect(screen.queryByText(CLOCK)).toBeNull()
    expect(screen.queryByText("24h")).toBeNull()
    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()
  })

  it("draws an in-person meeting's venue and distance", () => {
    mountCard([
      meeting({ venue: "in_person", venueName: "Lincoln Park Alano Club", distanceM: 543 }),
    ])
    expect(screen.getByText("Lincoln Park Alano Club")).toBeTruthy()
    expect(screen.getByText("0.3 mi")).toBeTruthy()
  })

  it("puts the weekday on the rows when one is on another day", () => {
    const inThreeDays = Date.now() + 3 * 24 * 60 * 60 * 1000
    mountCard([meeting({ id: "a" }), meeting({ id: "b", startsAt: inThreeDays })])
    expect(screen.getAllByTestId("day-label")).toHaveLength(2)
  })

  it("leaves the weekday off when every meeting is today", () => {
    mountCard([meeting({ id: "a" }), meeting({ id: "b" })])
    expect(screen.queryByTestId("day-label")).toBeNull()
  })

  it("says so when there are no meetings", () => {
    mountCard([])
    expect(screen.getByText(EMPTY)).toBeTruthy()
  })

  it("shows the summary badge once collapsed", () => {
    render(
      <MeetingResultsCard
        meetings={[meeting()]}
        isCollapsed
        collapsedSummary="Selected: Sunrise"
      />,
    )
    expect(screen.getByText("Selected: Sunrise")).toBeTruthy()
    expect(screen.queryByText("Sunrise Serenity")).toBeNull()
  })

  it("hands a tap on the badge back, to open the card again", () => {
    const onExpand = jest.fn()
    render(
      <MeetingResultsCard
        meetings={[meeting()]}
        isCollapsed
        collapsedSummary="Selected: Sunrise"
        onExpand={onExpand}
      />,
    )
    const badge = screen.getByRole("button", { name: "Selected: Sunrise" })
    expect(badge.props.accessibilityHint).toBe("agentScreen:showMeetingsAgain")
    fireEvent.press(badge)
    expect(onExpand).toHaveBeenCalledTimes(1)
  })
})
