import { fireEvent, render } from "@testing-library/react-native"

import { SupportContactRow } from "./SupportContactRow"

describe("SupportContactRow (spec D1: names only)", () => {
  it("shows role and name and wires the three actions with labelled buttons", () => {
    const onCall = jest.fn()
    const onText = jest.fn()
    const onMore = jest.fn()
    const { getByText, getByLabelText } = render(
      <SupportContactRow
        roleTx="support:roleSponsor"
        name="Julie J."
        onCall={onCall}
        onText={onText}
        onMore={onMore}
      />,
    )
    expect(getByText(/support:roleAndName/)).toBeTruthy()
    fireEvent.press(getByLabelText(/support:callA11y/))
    fireEvent.press(getByLabelText(/support:textA11y/))
    fireEvent.press(getByLabelText(/support:moreA11y/))
    expect(onCall).toHaveBeenCalledTimes(1)
    expect(onText).toHaveBeenCalledTimes(1)
    expect(onMore).toHaveBeenCalledTimes(1)
  })

  it("shows the role alone when the name is empty", () => {
    const { queryByText, getByText } = render(
      <SupportContactRow
        roleTx="support:roleSupport"
        name="  "
        onCall={() => {}}
        onText={() => {}}
        onMore={() => {}}
      />,
    )
    expect(queryByText(/support:roleAndName/)).toBeNull()
    expect(getByText(/support:roleSupport/)).toBeTruthy()
  })
})
