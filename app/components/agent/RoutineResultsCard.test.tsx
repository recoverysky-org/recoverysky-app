import { StyleSheet } from "react-native"
import { fireEvent, render, screen } from "@testing-library/react-native"

import { lightTheme } from "@/theme/theme"
import type { SkyRoutineItem, SkyToday } from "@/utils/agentRoutineLogic"

import { RoutineResultsCard } from "./RoutineResultsCard"

// The real hook warns once per run with no i18next instance, and answers the key anyway.
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}))

// My Day's own English words: the app's `myDay` strings mirror them leaf for leaf
// (myDayCopy.test.ts), and the global i18n mock answers keys, not words.
jest.mock("@/hooks/useMyDayCopy", () => ({
  useMyDayCopy: () => jest.requireActual("@daily-dash/my-day/copy").defaultMyDayCopy,
}))

const OPEN = "agentScreen:openMyDay"
const SHOW = "agentScreen:showRoutineDetails"
const HIDE = "agentScreen:hideRoutineDetails"
// `count` too, so a language with plural forms can choose one by the number done
const progress = (done: number, total: number) =>
  `agentScreen:routineProgress ${JSON.stringify({ done, total, count: done })}`

/** The global test setup's theme (test/setup.ts mocks useAppTheme with lightTheme) */
const { colors } = lightTheme

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

/** The mockup's Sunday: three done, one set aside, two not yet */
const SUNDAY = [
  item({ id: "m1" }),
  item({ id: "m2", title: "Make my bed", timeOfDay: null, weekDone: 5 }),
  item({
    id: "a1",
    title: "Call my sponsor",
    bucket: "afternoon",
    timeOfDay: "12:30",
    mark: "open",
    weekDone: 2,
  }),
  item({
    id: "a2",
    title: "Walk outside",
    bucket: "afternoon",
    timeOfDay: null,
    mark: "skipped",
    weekDone: 1,
  }),
  item({
    id: "e1",
    title: "Read the Big Book",
    bucket: "evening",
    timeOfDay: "21:00",
    mark: "open",
    weekDone: 3,
  }),
  item({ id: "y1", title: "Drink water", bucket: "anytime", timeOfDay: null, weekDone: 6 }),
]

const styleOf = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style)

const bucketLabels = () =>
  screen
    .getAllByText(/^(Morning|Afternoon|Evening|Any time|Other)$/)
    .map((node) => node.props.children)

describe("RoutineResultsCard: closed, as it first shows", () => {
  it("shows the title, the day, and how many are done", () => {
    render(<RoutineResultsCard today={today(SUNDAY)} />)

    expect(screen.getByText("My Daily Routine")).toBeTruthy()
    // An old card further up the thread says which day it was
    expect(screen.getByText("Sunday, November 8")).toBeTruthy()
    expect(screen.getByText(progress(3, 6))).toBeTruthy()
  })

  // The bar is hidden from screen readers (the count says it in words), so it is asked for as hidden.
  it("fills the bar by the share done", () => {
    render(<RoutineResultsCard today={today(SUNDAY)} />)
    const fill = screen.getByTestId("routine-progress-fill", { includeHiddenElements: true })
    expect(StyleSheet.flatten(fill.props.style).width).toBe("50%")
  })

  it("takes the bar's share from the count, rounded", () => {
    render(
      <RoutineResultsCard
        today={today([
          item({ id: "a" }),
          item({ id: "b", mark: "open" }),
          item({ id: "c", mark: "open" }),
        ])}
      />,
    )
    const fill = screen.getByTestId("routine-progress-fill", { includeHiddenElements: true })
    expect(StyleSheet.flatten(fill.props.style).width).toBe("33%")
  })

  it("lists each part of the day as one line of chips, in day order, with no times or counts", () => {
    render(<RoutineResultsCard today={today([...SUNDAY].reverse())} />)

    expect(bucketLabels()).toEqual(["Morning", "Afternoon", "Evening", "Any time"])
    for (const { title } of SUNDAY) expect(screen.getByText(title)).toBeTruthy()
    expect(screen.queryByText("07:00")).toBeNull()
    expect(screen.queryByText(/this week/)).toBeNull()
  })

  // A chip's look carries its state, so a screen reader hears it in words.
  it("reads each chip as its title and state; only a done chip has the check", () => {
    render(<RoutineResultsCard today={today(SUNDAY)} />)

    expect(screen.getByTestId("routine-chip-m1").props.accessibilityLabel).toBe(
      "Morning prayer, Done",
    )
    expect(screen.getByTestId("routine-chip-a1").props.accessibilityLabel).toBe(
      "Call my sponsor, Not yet",
    )
    expect(screen.getByTestId("routine-chip-a2").props.accessibilityLabel).toBe(
      "Walk outside, Set aside today",
    )
    expect(screen.getByTestId("routine-chip-check-m1")).toBeTruthy()
    expect(screen.queryByTestId("routine-chip-check-a1")).toBeNull()
    expect(screen.queryByTestId("routine-chip-check-a2")).toBeNull()
  })

  it("tints a done chip, and leaves a not-yet chip plain", () => {
    render(<RoutineResultsCard today={today(SUNDAY)} />)

    expect(styleOf("routine-chip-m1")).toMatchObject({ backgroundColor: colors.tint + "2E" })
    expect(styleOf("routine-chip-a1").backgroundColor).toBeUndefined()
  })

  // Dimmed by colour, not opacity: at 0.45 the dashed edge could not be seen (review 2026-11-08).
  it("dashes a set-aside chip's edge and dims its words", () => {
    render(<RoutineResultsCard today={today(SUNDAY)} />)

    expect(styleOf("routine-chip-a2")).toMatchObject({
      borderStyle: "dashed",
      borderColor: colors.textDim,
    })
    expect(styleOf("routine-chip-a2").opacity).toBeUndefined()
    expect(StyleSheet.flatten(screen.getByText("Walk outside").props.style).color).toBe(
      colors.textDim,
    )
    expect(StyleSheet.flatten(screen.getByText("Call my sponsor").props.style).color).toBe(
      colors.text,
    )
  })

  it("lists a bucket it does not know last, under Other", () => {
    render(
      <RoutineResultsCard
        today={today([item({ id: "x", title: "Stretch", bucket: "night" }), item()])}
      />,
    )
    expect(bucketLabels()).toEqual(["Morning", "Other"])
  })
})

describe("RoutineResultsCard: opened with Show details", () => {
  it("turns the chips into rows with time, state and this week's count, and closes again", () => {
    render(<RoutineResultsCard today={today(SUNDAY)} />)

    fireEvent.press(screen.getByRole("button", { name: SHOW }))

    expect(screen.getByText("07:00")).toBeTruthy()
    expect(screen.getByText("Done · 4 this week")).toBeTruthy()
    expect(screen.getByText("Not yet · 2 this week")).toBeTruthy()
    expect(screen.getByText("Set aside today · 1 this week")).toBeTruthy()
    expect(screen.queryByTestId("routine-chip-m1")).toBeNull()
    expect(screen.getByTestId("routine-row-m1").props.accessibilityLabel).toBe(
      "Morning prayer, 07:00, Done, 4 this week",
    )
    expect(screen.getByTestId("routine-row-m2").props.accessibilityLabel).toBe(
      "Make my bed, Done, 5 this week",
    )

    fireEvent.press(screen.getByRole("button", { name: HIDE }))

    expect(screen.queryByText("07:00")).toBeNull()
    expect(screen.getByTestId("routine-chip-m1")).toBeTruthy()
  })

  it("draws the rings as My Day does, and dims a set-aside row", () => {
    render(<RoutineResultsCard today={today(SUNDAY)} />)
    fireEvent.press(screen.getByRole("button", { name: SHOW }))

    // The look, not the test id: the ids come from the mark whatever the styles say
    const rings = (mark: string) =>
      screen
        .getAllByTestId(`routine-ring-${mark}`)
        .map((ring) => StyleSheet.flatten(ring.props.style))
    expect(rings("done")).toHaveLength(3)
    for (const ring of rings("done")) expect(ring.backgroundColor).toBe(colors.tint)
    for (const ring of rings("open")) {
      expect(ring.backgroundColor).toBeUndefined()
      expect(ring.borderColor).toBe(colors.tint)
    }
    expect(rings("skipped")[0]).toMatchObject({
      borderStyle: "dashed",
      borderColor: colors.textDim,
    })
    expect(rings("skipped")[0].backgroundColor).toBeUndefined()
    // My Day's own dim for a set-aside item (its disabledOpacity)
    expect(styleOf("routine-row-a2").opacity).toBe(0.5)
    expect(styleOf("routine-row-a1").opacity).toBeUndefined()
  })

  it("tells a screen reader whether the details are open", () => {
    render(<RoutineResultsCard today={today(SUNDAY)} />)

    expect(screen.getByRole("button", { name: SHOW }).props.accessibilityState).toMatchObject({
      expanded: false,
    })
    fireEvent.press(screen.getByRole("button", { name: SHOW }))
    expect(screen.getByRole("button", { name: HIDE }).props.accessibilityState).toMatchObject({
      expanded: true,
    })
  })
})

describe("RoutineResultsCard: the rest", () => {
  it("says so in My Day's words when there is no routine, with no count or toggle", () => {
    render(<RoutineResultsCard today={today([])} />)

    expect(
      screen.getByText(
        "Start with a routine someone has already thought about, or build your own.",
      ),
    ).toBeTruthy()
    expect(screen.queryByText(progress(0, 0))).toBeNull()
    expect(
      screen.queryByTestId("routine-progress-fill", { includeHiddenElements: true }),
    ).toBeNull()
    expect(screen.queryByRole("button", { name: SHOW })).toBeNull()
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

  // Display only, for now: the toggle is the card's one control without the link.
  it("offers no control on an item", () => {
    render(<RoutineResultsCard today={today(SUNDAY)} />)
    expect(screen.getAllByRole("button")).toHaveLength(1)
    fireEvent.press(screen.getByRole("button", { name: SHOW }))
    expect(screen.getAllByRole("button")).toHaveLength(1)
  })
})
