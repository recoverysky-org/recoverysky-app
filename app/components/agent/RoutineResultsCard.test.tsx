import { StyleSheet } from "react-native"
import { fireEvent, render, screen } from "@testing-library/react-native"

import type { SkyRoutineItem, SkyToday } from "@/utils/agentRoutineLogic"

import { RoutineResultsCard } from "./RoutineResultsCard"

// The real hook warns once per run with no i18next instance, and answers the key anyway.
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// My Day's own English words: the app's `myDay` strings mirror them leaf for leaf
// (myDayCopy.test.ts), and the global i18n mock answers keys, not words.
jest.mock("@/hooks/useMyDayCopy", () => ({
  useMyDayCopy: () => jest.requireActual("@daily-dash/my-day/copy").defaultMyDayCopy,
}))

// The launch photo is a bundled JPEG; the card only hands it on.
jest.mock("@/theme/myDayPhotos", () => ({ coldStartMyDayPhoto: () => ({ uri: "photo" }) }))

const OPEN = "agentScreen:openMyDay"

const item = (overrides: Partial<SkyRoutineItem> = {}): SkyRoutineItem => ({
  id: "i1",
  title: "Morning prayer",
  bucket: "morning",
  timeOfDay: "07:00",
  mark: "done",
  weekDone: 4,
  ...overrides,
})

const today = (items: SkyRoutineItem[], overrides: Partial<SkyToday> = {}): SkyToday => ({
  date: "2026-11-08",
  items,
  longRoutine: false,
  ...overrides,
})

const opacityOf = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style).opacity

describe("RoutineResultsCard", () => {
  it("draws the title, the day, and every item under its part of the day", () => {
    render(
      <RoutineResultsCard
        today={today([
          item({
            id: "e1",
            title: "Read the Big Book",
            bucket: "evening",
            timeOfDay: "21:00",
            mark: "open",
            weekDone: 3,
          }),
          item({ id: "m1" }),
          item({
            id: "a1",
            title: "Call my sponsor",
            bucket: "afternoon",
            timeOfDay: "12:30",
            mark: "open",
            weekDone: 2,
          }),
        ])}
      />,
    )

    expect(screen.getByText("My Daily Routine")).toBeTruthy()
    expect(screen.getByText("Sunday, November 8")).toBeTruthy()
    expect(screen.getByText("Morning prayer")).toBeTruthy()
    expect(screen.getByText("07:00")).toBeTruthy()
    expect(screen.getByText("Done · 4 this week")).toBeTruthy()
    expect(screen.getByText("Not yet · 2 this week")).toBeTruthy()

    // Day order, whatever order the items came in (my-day BUCKET_ORDER)
    const labels = screen
      .getAllByText(/^(Morning|Afternoon|Evening|Any time|Other)$/)
      .map((node) => node.props.children)
    expect(labels).toEqual(["Morning", "Afternoon", "Evening"])
  })

  it("draws the ring as My Day does: filled when done, open when not yet, dim and dimmed when set aside", () => {
    render(
      <RoutineResultsCard
        today={today([
          item({ id: "d", mark: "done" }),
          item({ id: "o", mark: "open" }),
          item({ id: "s", title: "Walk outside", mark: "skipped", weekDone: 1 }),
        ])}
      />,
    )

    expect(screen.getByTestId("routine-ring-done")).toBeTruthy()
    expect(screen.getByTestId("routine-ring-open")).toBeTruthy()
    expect(screen.getByTestId("routine-ring-skipped")).toBeTruthy()
    expect(screen.getByText("Set aside today · 1 this week")).toBeTruthy()
    // A set-aside item is dimmed, as on My Day's routine card; the others are not.
    expect(opacityOf("routine-row-s")).toBe(0.5)
    expect(opacityOf("routine-row-d")).toBeUndefined()
  })

  // The ring has no words, so a screen reader hears the row as one sentence.
  it("reads each row as one element: title, time, state, week", () => {
    render(
      <RoutineResultsCard
        today={today([
          item(),
          item({ id: "n", title: "Drink water", timeOfDay: null, weekDone: null }),
        ])}
      />,
    )

    expect(screen.getByTestId("routine-row-i1").props.accessibilityLabel).toBe(
      "Morning prayer, 07:00, Done, 4 this week",
    )
    expect(screen.getByTestId("routine-row-n").props.accessibilityLabel).toBe("Drink water, Done")
    expect(screen.getByText("Done")).toBeTruthy()
  })

  it("lists a bucket it does not know last, under Other", () => {
    render(
      <RoutineResultsCard
        today={today([item({ id: "x", title: "Stretch", bucket: "night" }), item({ id: "m" })])}
      />,
    )

    const labels = screen.getAllByText(/^(Morning|Other)$/).map((node) => node.props.children)
    expect(labels).toEqual(["Morning", "Other"])
    expect(screen.getByText("Stretch")).toBeTruthy()
  })

  it("says so in My Day's words when there is no routine", () => {
    render(<RoutineResultsCard today={today([])} />)

    expect(
      screen.getByText(
        "Start with a routine someone has already thought about, or build your own.",
      ),
    ).toBeTruthy()
    expect(screen.queryByText("Morning")).toBeNull()
  })

  it("shows the long routine note when the server flagged it", () => {
    render(<RoutineResultsCard today={today([item()], { longRoutine: true })} />)
    expect(screen.getByText("That's a full day. Would a shorter list feel lighter?")).toBeTruthy()
  })

  it("opens My Day from the link", () => {
    const onOpenMyDay = jest.fn()
    render(<RoutineResultsCard today={today([item()])} onOpenMyDay={onOpenMyDay} />)

    fireEvent.press(screen.getByRole("button", { name: OPEN }))
    expect(onOpenMyDay).toHaveBeenCalledTimes(1)
  })

  // A person with Sky and no My Day tab: the card still shows what Sky read, with no link to nowhere.
  it("has no link without a My Day tab to open", () => {
    render(<RoutineResultsCard today={today([item()])} />)
    expect(screen.queryByText(OPEN)).toBeNull()
  })

  // Display only, for now: nothing on a row is a control.
  it("offers no control on a row", () => {
    render(<RoutineResultsCard today={today([item(), item({ id: "o", mark: "open" })])} />)
    expect(screen.queryAllByRole("button")).toHaveLength(0)
  })
})
