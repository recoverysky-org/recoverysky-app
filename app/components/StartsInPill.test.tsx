import { fireEvent, render, screen } from "@testing-library/react-native"

import { StartsInPill } from "./StartsInPill"

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

describe("StartsInPill", () => {
  it("shows all five options with Live selected by default", () => {
    render(<StartsInPill value="live" onSelect={jest.fn()} />)
    for (const label of ["Live", "15 min", "30 min", "45 min", "60 min"]) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
    expect(screen.getByLabelText("Live").props.accessibilityState?.selected).toBe(true)
  })

  it("reports the picked option", () => {
    const onSelect = jest.fn()
    render(<StartsInPill value="live" onSelect={onSelect} />)
    fireEvent.press(screen.getByLabelText("30 min"))
    expect(onSelect).toHaveBeenCalledWith("30")
  })

  it("blocks the minute options while disabled (maintenance)", () => {
    const onSelect = jest.fn()
    render(<StartsInPill value="live" disabled onSelect={onSelect} />)
    expect(screen.getByLabelText("15 min").props.accessibilityState?.disabled).toBe(true)
    fireEvent.press(screen.getByLabelText("15 min"))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
