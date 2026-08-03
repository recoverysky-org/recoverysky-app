import { render, screen } from "@testing-library/react-native"

import type { MeetingWithTrex } from "@/context/MeetingContext"

import { InPersonScheduleRow } from "./InPersonScheduleRow"

const meeting = {
  id: "m1",
  name: "Sunrise Serenity",
  fellowship: "AA",
  venueType: "in_person",
  hybrid: false,
  venueName: "St. Mark's Church",
  city: "Boise",
  state: "ID",
  millis: new Date(2026, 7, 4, 7, 0).getTime(),
  duration_ms: 3600000,
  sid: "s1",
  feedback: null,
  scheduleData: null,
} as unknown as MeetingWithTrex

describe("InPersonScheduleRow", () => {
  it("renders name, venue line, and distance badge", () => {
    render(<InPersonScheduleRow meeting={meeting} distanceLabel="0.8 mi" />)
    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()
    expect(screen.getByText(/St\. Mark's Church/)).toBeTruthy()
    expect(screen.getByText("0.8 mi")).toBeTruthy()
    // Symmetric with the omission test below: pins that the badge is a real,
    // identifiable element (not just incidentally-matching text).
    expect(screen.getByTestId("distance-badge")).toBeTruthy()
  })

  it("omits the distance badge without a label", () => {
    render(<InPersonScheduleRow meeting={meeting} />)
    expect(screen.queryByText(/mi$/)).toBeNull()
    // The text-regex check above only proves no rendered string ends in
    // "mi" — it can't tell "badge absent" from "badge rendered empty".
    // Asserting on the badge's own testID is the real "absent, not empty"
    // check the component's contract promises (see InPersonScheduleRow.tsx).
    expect(screen.queryByTestId("distance-badge")).toBeNull()
  })

  it("shows the hybrid indicator for hybrid meetings", () => {
    render(<InPersonScheduleRow meeting={{ ...meeting, hybrid: true }} />)
    const hybridIndicator = screen.getByTestId("hybrid-indicator")
    expect(hybridIndicator).toBeTruthy()
    // Pins which glyph renders — the mock in test/setup.ts prefixes the icon
    // name with "icon:" precisely so this can be asserted without colliding
    // with real on-screen text.
    expect(hybridIndicator.props.children).toBe("icon:globe-outline")
  })

  it("hides the hybrid indicator for in-person-only meetings", () => {
    render(<InPersonScheduleRow meeting={meeting} />)
    expect(screen.queryByTestId("hybrid-indicator")).toBeNull()
  })
})
