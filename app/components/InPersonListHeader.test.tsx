import { render, screen } from "@testing-library/react-native"

import { InPersonListHeader, type InPersonListHeaderProps } from "./InPersonListHeader"

// Same pattern as MapListToggle.test.tsx: resolve against the real `en`
// catalogue so accessibility strings can be asserted by what a screen reader
// actually says. The rest of test/setup.ts (icon + theme mocks) still applies.
jest.mock("react-i18next", () => {
  const en = require("@/i18n/en").default
  const resolve = (key: string, params?: Record<string, string | number>) => {
    const [ns, path] = key.split(":")
    const value = (path ?? "")
      .split(".")
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], en[ns])
    if (typeof value !== "string") return key
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params?.[name] ?? `{{${name}}}`))
  }
  return { useTranslation: () => ({ t: resolve }) }
})

const baseProps: InPersonListHeaderProps = {
  fellowshipLabel: "AA",
  selectedDayLabel: "Mon",
  radiusLabel: "25 mi",
  radiusA11yLabel: "Within 25 miles",
  shortTimeLabel: "Any",
  bannerReason: null,
  canAskAgain: true,
  locationDisabled: false,
  showSpinner: false,
  isRefetching: false,
  onOpenFellowship: jest.fn(),
  onOpenDay: jest.fn(),
  onOpenRadius: jest.fn(),
  onOpenShortTime: jest.fn(),
  onBannerPress: jest.fn(),
  resultCount: 7,
  showMapToggle: false,
  viewMode: "list",
  mapToggleDisabled: false,
  onToggleView: jest.fn(),
}

describe("InPersonListHeader result-count slot", () => {
  it("shows the result count when nothing is loading", () => {
    render(<InPersonListHeader {...baseProps} />)
    expect(screen.getByTestId("result-count")).toBeTruthy()
    expect(screen.queryByTestId("result-count-loading")).toBeNull()
  })

  // The bug this pins (2026-09-05): a day / radius / fellowship change refetches
  // while the previous rows are still on screen. The screen's large first-load
  // spinner is gated on "no rows yet", and RefreshControl can't be relied on
  // for a programmatic reload (no FlatList in map mode, a no-op on web, and a
  // 250 ms offset animation on iOS that a fast fetch beats). So the header
  // itself has to signal the reload, in the one slot both view modes render.
  it("replaces the stale count with a loading indicator while refetching", () => {
    render(<InPersonListHeader {...baseProps} isRefetching />)
    expect(screen.getByTestId("result-count-loading")).toBeTruthy()
    expect(screen.queryByTestId("result-count")).toBeNull()
  })

  it("announces the refetch indicator to screen readers", () => {
    render(<InPersonListHeader {...baseProps} isRefetching />)
    expect(screen.getByLabelText("Loading")).toBeTruthy()
  })

  it("keeps the count slot empty during the first-load spinner", () => {
    // `showSpinner` is the pre-existing "no rows yet" path: the big spinner
    // below the filters owns the loading signal, so the subtitle slot must not
    // add a second one.
    render(<InPersonListHeader {...baseProps} showSpinner />)
    expect(screen.queryByTestId("result-count")).toBeNull()
    expect(screen.queryByTestId("result-count-loading")).toBeNull()
  })
})
