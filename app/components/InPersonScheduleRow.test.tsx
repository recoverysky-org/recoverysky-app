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
  })

  it("omits the distance badge without a label", () => {
    render(<InPersonScheduleRow meeting={meeting} />)
    expect(screen.queryByText(/mi$/)).toBeNull()
  })

  it("shows the hybrid indicator for hybrid meetings", () => {
    render(<InPersonScheduleRow meeting={{ ...meeting, hybrid: true }} />)
    expect(screen.getByTestId("hybrid-indicator")).toBeTruthy()
  })

  it("hides the hybrid indicator for in-person-only meetings", () => {
    render(<InPersonScheduleRow meeting={meeting} />)
    expect(screen.queryByTestId("hybrid-indicator")).toBeNull()
  })
})
