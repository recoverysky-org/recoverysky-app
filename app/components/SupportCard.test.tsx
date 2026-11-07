import { fireEvent, render } from "@testing-library/react-native"

import { SupportCard } from "./SupportCard"

const noop = () => {}

describe("SupportCard (spec D8, D1)", () => {
  it("offers Choose when there is no contact", () => {
    const onChoose = jest.fn()
    const { getByText } = render(
      <SupportCard
        primary={null}
        onChoose={onChoose}
        onCall={noop}
        onText={noop}
        onOpenSupport={noop}
      />,
    )
    expect(getByText(/support:emptyTitle/)).toBeTruthy()
    fireEvent.press(getByText(/support:choose/))
    expect(onChoose).toHaveBeenCalledTimes(1)
  })

  it("shows the primary by role and name with Call and Text, and opens Support from the title", () => {
    const onCall = jest.fn()
    const onText = jest.fn()
    const onOpenSupport = jest.fn()
    const { getByText, getByLabelText } = render(
      <SupportCard
        primary={{ roleTx: "support:roleSponsor", name: "Julie J." }}
        onChoose={noop}
        onCall={onCall}
        onText={onText}
        onOpenSupport={onOpenSupport}
      />,
    )
    expect(getByText(/support:roleAndName/)).toBeTruthy()
    fireEvent.press(getByLabelText(/support:callA11y/))
    fireEvent.press(getByLabelText(/support:textA11y/))
    fireEvent.press(getByLabelText(/support:openSupportA11y/))
    expect(onCall).toHaveBeenCalledTimes(1)
    expect(onText).toHaveBeenCalledTimes(1)
    expect(onOpenSupport).toHaveBeenCalledTimes(1)
  })
})
