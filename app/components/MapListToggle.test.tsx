import { fireEvent, render, screen } from "@testing-library/react-native"

import { MapListToggle } from "./MapListToggle"

// test/setup.ts stubs i18n globally to echo "<key> <params-json>", which
// would make `getByLabelText("Map")` fail even though the component is
// correct. This test is specifically about what a screen reader SAYS, so it
// resolves against the real `en` catalogue instead, same pattern as
// ScheduleGrid.test.tsx. Only react-i18next is overridden — the rest of
// setup.ts (icon mock, theme mock) still applies.
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

// CHANGED 2026-08-12: rewritten for the segmented pill. The old suite asserted
// on a single button whose label named the DESTINATION ("Show map" while the
// list was up). Both halves are now permanently on screen with noun labels, so
// every lookup is by half rather than by mode, and "which one is active" moved
// from the label text into `accessibilityState.selected` — which is the
// property that has to hold, because it is the only thing a screen-reader user
// gets in place of the tint fill a sighted user sees.
describe("MapListToggle", () => {
  it("shows both destinations at once, whichever mode is active", () => {
    render(<MapListToggle viewMode="list" onToggle={jest.fn()} />)
    // The whole point of the redesign: "Map" is on screen without interaction.
    expect(screen.getByLabelText("List")).toBeTruthy()
    expect(screen.getByLabelText("Map")).toBeTruthy()
  })

  it("marks the active half selected and the other not", () => {
    render(<MapListToggle viewMode="list" onToggle={jest.fn()} />)
    expect(screen.getByLabelText("List").props.accessibilityState?.selected).toBe(true)
    expect(screen.getByLabelText("Map").props.accessibilityState?.selected).toBe(false)
  })

  it("tracks the active half when the mode flips", () => {
    render(<MapListToggle viewMode="map" onToggle={jest.fn()} />)
    expect(screen.getByLabelText("Map").props.accessibilityState?.selected).toBe(true)
    expect(screen.getByLabelText("List").props.accessibilityState?.selected).toBe(false)
  })

  it("fires onToggle when the inactive half is pressed", () => {
    const onToggle = jest.fn()
    render(<MapListToggle viewMode="list" onToggle={onToggle} />)
    fireEvent.press(screen.getByLabelText("Map"))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("ignores a press on the already-active half", () => {
    // Load-bearing: `onToggle` is a flip, so firing it here would bounce the
    // user OUT of the mode they just asked for.
    const onToggle = jest.fn()
    render(<MapListToggle viewMode="list" onToggle={onToggle} />)
    fireEvent.press(screen.getByLabelText("List"))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it("does not fire when disabled and exposes the disabled state", () => {
    const onToggle = jest.fn()
    render(<MapListToggle viewMode="list" disabled onToggle={onToggle} />)
    const map = screen.getByLabelText("Map")
    fireEvent.press(map)
    expect(onToggle).not.toHaveBeenCalled()
    expect(map.props.accessibilityState?.disabled).toBe(true)
    expect(map.props.accessibilityHint).toBe("Map is unavailable offline")
  })

  it("leaves the active half usable while disabled", () => {
    // `disabled` means "can't ENTER map mode while offline", never "stuck".
    // Only the inactive half takes it — see mapToggleDisabled in
    // InPersonScreen, which is why a user who goes offline on the map can
    // still get back to the list.
    render(<MapListToggle viewMode="list" disabled onToggle={jest.fn()} />)
    expect(screen.getByLabelText("List").props.accessibilityState?.disabled).toBe(false)
  })

  it("does not expose the accessibility hint when enabled", () => {
    render(<MapListToggle viewMode="list" onToggle={jest.fn()} />)
    expect(screen.getByLabelText("Map").props.accessibilityHint).toBeUndefined()
  })
})
