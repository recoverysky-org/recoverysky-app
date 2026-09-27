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
  // CHANGED 2026-09-27: "Live Now" + "Starts in" + only the minute chips that
  // have meetings (the screen prefetches all four and passes the non-empty ones).
  it("shows Live Now, the Starts in caption and only the available minute chips", () => {
    render(<StartsInPill value="live" available={["15", "45"]} onSelect={jest.fn()} />)
    expect(screen.getByLabelText("Live Now")).toBeTruthy()
    expect(screen.getByText("Starts in")).toBeTruthy()
    expect(screen.getByText("15m")).toBeTruthy()
    expect(screen.getByText("45m")).toBeTruthy()
    expect(screen.queryByText("30m")).toBeNull()
    expect(screen.queryByText("60m")).toBeNull()
  })

  it("announces minute chips in full for screen readers", () => {
    render(<StartsInPill value="live" available={["30"]} onSelect={jest.fn()} />)
    expect(screen.getByLabelText("Starts in 30 minutes")).toBeTruthy()
  })

  it("marks Live Now selected by default and a minute chip when chosen", () => {
    const { rerender } = render(
      <StartsInPill value="live" available={["15", "30"]} onSelect={jest.fn()} />,
    )
    expect(screen.getByLabelText("Live Now").props.accessibilityState?.selected).toBe(true)
    expect(screen.getByLabelText("Starts in 30 minutes").props.accessibilityState?.selected).toBe(
      false,
    )

    rerender(<StartsInPill value="30" available={["15", "30"]} onSelect={jest.fn()} />)
    expect(screen.getByLabelText("Live Now").props.accessibilityState?.selected).toBe(false)
    expect(screen.getByLabelText("Starts in 30 minutes").props.accessibilityState?.selected).toBe(
      true,
    )
  })

  it("reports picks in both directions", () => {
    const onSelect = jest.fn()
    const { rerender } = render(
      <StartsInPill value="live" available={["15", "30"]} onSelect={onSelect} />,
    )
    fireEvent.press(screen.getByLabelText("Starts in 30 minutes"))
    expect(onSelect).toHaveBeenLastCalledWith("30")

    rerender(<StartsInPill value="30" available={["15", "30"]} onSelect={onSelect} />)
    fireEvent.press(screen.getByLabelText("Live Now"))
    expect(onSelect).toHaveBeenLastCalledWith("live")
  })

  it("renders nothing when no minute option has meetings", () => {
    render(<StartsInPill value="live" available={[]} onSelect={jest.fn()} />)
    expect(screen.queryByLabelText("Live Now")).toBeNull()
  })
})
