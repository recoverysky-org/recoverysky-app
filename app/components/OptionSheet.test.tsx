import { fireEvent, render } from "@testing-library/react-native"

import { OptionSheet } from "./OptionSheet"

const options = [
  { key: "moveUp", tx: "support:moveUp" as const },
  { key: "remove", tx: "support:remove" as const, destructive: true },
]

describe("OptionSheet", () => {
  it("renders every option and reports the tapped key", () => {
    const onSelect = jest.fn()
    const { getByText } = render(
      <OptionSheet visible options={options} onSelect={onSelect} onClose={() => {}} />,
    )
    fireEvent.press(getByText(/support:remove/))
    expect(onSelect).toHaveBeenCalledWith("remove")
  })

  it("closes from the Cancel row", () => {
    const onClose = jest.fn()
    const { getByText } = render(
      <OptionSheet visible options={options} onSelect={() => {}} onClose={onClose} />,
    )
    fireEvent.press(getByText(/common:cancel/))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("leaves closing to the caller: selecting an option does not call onClose", () => {
    const onClose = jest.fn()
    const { getByText } = render(
      <OptionSheet visible options={options} onSelect={() => {}} onClose={onClose} />,
    )
    fireEvent.press(getByText(/support:moveUp/))
    expect(onClose).not.toHaveBeenCalled()
  })
})
