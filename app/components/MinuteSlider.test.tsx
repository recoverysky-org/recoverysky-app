/**
 * Covers the parts of MinuteSlider a screen-reader user depends on. Pan
 * gestures are deliberately NOT simulated — PanResponder under jsdom exercises
 * the mock rather than the behaviour, and the arithmetic underneath the drag is
 * already covered by app/utils/sliderLogic.test.ts. The drag itself is a manual
 * check (see the plan's Task 5).
 */
import { fireEvent, render, screen } from "@testing-library/react-native"

import { MinuteSlider } from "./MinuteSlider"

const baseProps = {
  value: 60,
  min: 1,
  max: 120,
  accessibilityLabel: "Duration",
  testID: "minute-slider",
}

const adjust = (action: "increment" | "decrement") =>
  fireEvent(screen.getByTestId("minute-slider"), "accessibilityAction", {
    nativeEvent: { actionName: action },
  })

describe("MinuteSlider", () => {
  it("exposes the range and current value to screen readers", () => {
    render(<MinuteSlider {...baseProps} onChange={jest.fn()} />)

    const slider = screen.getByTestId("minute-slider")
    expect(slider.props.accessibilityRole).toBe("adjustable")
    expect(slider.props.accessibilityValue).toEqual({ min: 1, max: 120, now: 60 })
  })

  it("steps the value by one on the increment and decrement actions", () => {
    const onChange = jest.fn()
    render(<MinuteSlider {...baseProps} onChange={onChange} />)

    adjust("increment")
    expect(onChange).toHaveBeenCalledWith(61)

    adjust("decrement")
    expect(onChange).toHaveBeenCalledWith(59)
  })

  it("does not step past the ceiling", () => {
    const onChange = jest.fn()
    render(<MinuteSlider {...baseProps} value={120} onChange={onChange} />)

    adjust("increment")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("does not step past the floor", () => {
    const onChange = jest.fn()
    render(<MinuteSlider {...baseProps} value={1} onChange={onChange} />)

    adjust("decrement")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("ignores both actions while disabled", () => {
    const onChange = jest.fn()
    render(<MinuteSlider {...baseProps} disabled onChange={onChange} />)

    adjust("increment")
    adjust("decrement")
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId("minute-slider").props.accessibilityState).toMatchObject({
      disabled: true,
    })
  })

  it("reports itself disabled for a degenerate range", () => {
    // A one-minute attendance record: there is no legal value to slide to.
    const onChange = jest.fn()
    render(<MinuteSlider {...baseProps} value={1} min={1} max={1} onChange={onChange} />)

    adjust("increment")
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId("minute-slider").props.accessibilityState).toMatchObject({
      disabled: true,
    })
  })
})
