import { render, screen } from "@testing-library/react-native"

import type { MeetingWithTrex } from "@/context/MeetingContext"

import { MeetingRow } from "./MeetingRow"

const inPersonMeeting = {
  id: "m1",
  name: "Sunrise Serenity",
  fellowship: "AA",
  venueType: "in_person",
  hybrid: false,
  venueName: "St. Mark's Church",
  city: "Boise",
  state: "ID",
  language: "en",
  millis: new Date(2026, 7, 4, 7, 0).getTime(),
  duration_ms: 3600000,
  sid: "s1",
  feedback: null,
  scheduleData: null,
} as unknown as MeetingWithTrex

// Online meetings carry no venue fields at all — that absence is what
// collapses the subtitle to a bare fellowship, so it has to be modelled
// faithfully rather than blanked out with empty strings.
const onlineMeeting = {
  id: "m2",
  name: "Os Lusófonos",
  fellowship: "NA",
  venueType: "online",
  hybrid: false,
  language: "pt",
  millis: new Date(2026, 7, 4, 17, 0).getTime(),
  duration_ms: 3600000,
  sid: "s2",
  feedback: null,
  scheduleData: null,
} as unknown as MeetingWithTrex

describe("MeetingRow", () => {
  describe("in-person meetings", () => {
    it("renders name, venue line, and distance badge", () => {
      render(<MeetingRow meeting={inPersonMeeting} distanceLabel="0.8 mi" />)
      expect(screen.getByText("Sunrise Serenity")).toBeTruthy()
      expect(screen.getByText(/St\. Mark's Church/)).toBeTruthy()
      expect(screen.getByText("0.8 mi")).toBeTruthy()
      // Symmetric with the omission test below: pins that the badge is a real,
      // identifiable element (not just incidentally-matching text).
      expect(screen.getByTestId("distance-badge")).toBeTruthy()
    })

    it("omits the distance badge without a label", () => {
      render(<MeetingRow meeting={inPersonMeeting} />)
      expect(screen.queryByText(/mi$/)).toBeNull()
      // The text-regex check above only proves no rendered string ends in
      // "mi" — it can't tell "badge absent" from "badge rendered empty".
      // Asserting on the badge's own testID is the real "absent, not empty"
      // check the component's contract promises (see MeetingRow.tsx).
      expect(screen.queryByTestId("distance-badge")).toBeNull()
    })

    it("shows the hybrid indicator for hybrid meetings", () => {
      render(<MeetingRow meeting={{ ...inPersonMeeting, hybrid: true }} />)
      const hybridIndicator = screen.getByTestId("hybrid-indicator")
      expect(hybridIndicator).toBeTruthy()
      // Pins which glyph renders — the mock in test/setup.ts prefixes the icon
      // name with "icon:" precisely so this can be asserted without colliding
      // with real on-screen text.
      expect(hybridIndicator.props.children).toBe("icon:globe-outline")
    })

    it("hides the hybrid indicator for in-person-only meetings", () => {
      render(<MeetingRow meeting={inPersonMeeting} />)
      expect(screen.queryByTestId("hybrid-indicator")).toBeNull()
    })
  })

  describe("online meetings", () => {
    it("renders the fellowship but no venue line", () => {
      // The consolidation's core claim: one component, and the second line
      // simply isn't there for a meeting with no venue. That absence is what
      // keeps online rows single-line in a long Live list, so it's worth
      // pinning rather than leaving to visual inspection.
      render(<MeetingRow meeting={onlineMeeting} />)
      expect(screen.getByText("Os Lusófonos")).toBeTruthy()
      expect(screen.getByText("NA")).toBeTruthy()
      expect(screen.queryByText(/•/)).toBeNull()
    })

    it("never shows a distance badge for a meeting with no venue", () => {
      // Defensive: an online meeting has no location, so the badge must stay
      // absent — the row must not invent a proximity claim for a meeting that
      // has no place.
      render(<MeetingRow meeting={onlineMeeting} />)
      expect(screen.queryByTestId("distance-badge")).toBeNull()
    })
  })

  describe("badge slot", () => {
    it("shows a venue tag in the distance badge's place", () => {
      render(<MeetingRow meeting={onlineMeeting} venueTag="Online" />)
      expect(screen.getByTestId("venue-tag")).toBeTruthy()
      expect(screen.getByText("Online")).toBeTruthy()
    })

    it("shows nothing when neither is supplied", () => {
      // Only mixed lists pass a tag; Live and In-Person leave the slot empty
      // rather than labelling every row with the same word.
      render(<MeetingRow meeting={onlineMeeting} />)
      expect(screen.queryByTestId("venue-tag")).toBeNull()
      expect(screen.queryByTestId("distance-badge")).toBeNull()
    })

    it("lets distance win when both are supplied", () => {
      // They share one slot. Rendering both would stack two badges and make
      // the row taller than its neighbours; distance is the more specific
      // answer to the same question, so it takes the spot.
      render(<MeetingRow meeting={inPersonMeeting} distanceLabel="0.8 mi" venueTag="In-Person" />)
      expect(screen.getByTestId("distance-badge")).toBeTruthy()
      expect(screen.queryByTestId("venue-tag")).toBeNull()
    })
  })

  describe("shared chrome", () => {
    it("shows the language after the time", () => {
      render(<MeetingRow meeting={onlineMeeting} />)
      // Uppercased for display; the model stores lowercase ISO codes.
      expect(screen.getByText("PT")).toBeTruthy()
    })

    it("renders stars only when rated", () => {
      // Rating and favourite are the two pieces the old online-only row
      // carried; consolidating must not quietly drop them for either venue.
      const { rerender } = render(<MeetingRow meeting={inPersonMeeting} rating={0} />)
      expect(screen.queryByText("icon:star")).toBeNull()

      rerender(<MeetingRow meeting={inPersonMeeting} rating={3} />)
      expect(screen.getAllByText("icon:star")).toHaveLength(3)
      expect(screen.getAllByText("icon:star-outline")).toHaveLength(2)
    })

    it("shows the favourite heart on an in-person meeting", () => {
      // Specifically in-person: the old in-person row had no heart at all, so
      // this is the regression consolidation could most easily reintroduce.
      render(<MeetingRow meeting={inPersonMeeting} isFavorite />)
      expect(screen.getByTestId("favorite-heart")).toBeTruthy()
    })

    it("hides the favourite heart when not favourited", () => {
      render(<MeetingRow meeting={inPersonMeeting} />)
      expect(screen.queryByTestId("favorite-heart")).toBeNull()
    })

    it("shows the reminder bell for both venues", () => {
      const { rerender } = render(<MeetingRow meeting={inPersonMeeting} hasReminder />)
      expect(screen.getByTestId("reminder-bell")).toBeTruthy()

      rerender(<MeetingRow meeting={onlineMeeting} hasReminder />)
      expect(screen.getByTestId("reminder-bell")).toBeTruthy()
    })
  })
})
