import { fireEvent, render, screen } from "@testing-library/react-native"

import { MapListToggle } from "./MapListToggle"

// test/setup.ts stubs i18n globally to echo "<key> <params-json>", which
// would make `getByLabelText("Show map")` fail even though the component is
// correct. This test is specifically about what a screen reader SAYS (the
// label names the tap destination — see MapListToggle.tsx), so it resolves
// against the real `en` catalogue instead, same pattern as
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

describe("MapListToggle", () => {
  it("offers the map when in list mode", () => {
    render(<MapListToggle viewMode="list" onToggle={jest.fn()} />)
    expect(screen.getByLabelText("Show map")).toBeTruthy()
  })

  it("offers the list when in map mode", () => {
    render(<MapListToggle viewMode="map" onToggle={jest.fn()} />)
    expect(screen.getByLabelText("Show list")).toBeTruthy()
  })

  it("fires onToggle on press", () => {
    const onToggle = jest.fn()
    render(<MapListToggle viewMode="list" onToggle={onToggle} />)
    fireEvent.press(screen.getByRole("button"))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("does not fire when disabled and exposes the disabled state", () => {
    const onToggle = jest.fn()
    render(<MapListToggle viewMode="list" disabled onToggle={onToggle} />)
    const button = screen.getByRole("button")
    fireEvent.press(button)
    expect(onToggle).not.toHaveBeenCalled()
    expect(button.props.accessibilityState?.disabled).toBe(true)
    // When disabled, the hint is present with the offline message
    expect(button.props.accessibilityHint).toBe("Map is unavailable offline")
  })

  it("does not expose the accessibility hint when enabled", () => {
    render(<MapListToggle viewMode="list" onToggle={jest.fn()} />)
    const button = screen.getByRole("button")
    // When not disabled, the hint should be undefined
    expect(button.props.accessibilityHint).toBeUndefined()
  })
})
