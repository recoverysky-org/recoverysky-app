import { fireEvent, render } from "@testing-library/react-native"

import { SupportCard, type SupportCardContact } from "./SupportCard"

const noop = () => {}

const julie: SupportCardContact = { roleTx: "support:roleSponsor", name: "Julie J." }
const marco: SupportCardContact = { roleTx: "support:roleSupport", name: "Marco" }

function renderCard(
  contacts: SupportCardContact[],
  handlers: Partial<Record<string, jest.Mock>> = {},
) {
  return render(
    <SupportCard
      contacts={contacts}
      onAdd={handlers.onAdd ?? noop}
      onCall={handlers.onCall ?? noop}
      onText={handlers.onText ?? noop}
      onRemove={handlers.onRemove ?? noop}
      onOpenSupport={handlers.onOpenSupport ?? noop}
    />,
  )
}

describe("SupportCard (spec D8, D1)", () => {
  // CHANGED 2026-11-08: the empty card explains itself and adds from the header's +, instead of
  // "Add your sponsor or support person" with a Choose button.
  it("explains itself when there is no contact, adds from +, and offers no edit", () => {
    const onAdd = jest.fn()
    const { getByText, getByLabelText, queryByLabelText } = renderCard([], { onAdd })
    expect(getByText(/support:emptyIntro/)).toBeTruthy()
    expect(getByText(/support:emptyPrivacy/)).toBeTruthy()
    fireEvent.press(getByLabelText(/support:addContact/))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(queryByLabelText(/support:editA11y/)).toBeNull()
  })

  // CHANGED 2026-11-08: every contact is listed, not just the first.
  it("lists every contact by role and name, calls and texts the pressed one by index", () => {
    const onCall = jest.fn()
    const onText = jest.fn()
    const { getAllByText, getAllByLabelText, queryByText } = renderCard([julie, marco], {
      onCall,
      onText,
    })
    expect(getAllByText(/support:roleAndName/)).toHaveLength(2)
    expect(queryByText(/support:emptyIntro/)).toBeNull()
    fireEvent.press(getAllByLabelText(/support:callA11y/)[1])
    fireEvent.press(getAllByLabelText(/support:textA11y/)[0])
    expect(onCall).toHaveBeenCalledWith(1)
    expect(onText).toHaveBeenCalledWith(0)
  })

  it("opens Support from the title", () => {
    const onOpenSupport = jest.fn()
    const { getByLabelText } = renderCard([julie], { onOpenSupport })
    fireEvent.press(getByLabelText(/support:openSupportA11y/))
    expect(onOpenSupport).toHaveBeenCalledTimes(1)
  })

  it("edit puts a trash on each row in place of Call and Text, and Done ends it", () => {
    const onRemove = jest.fn()
    const { getByLabelText, getAllByLabelText, queryAllByLabelText, queryByLabelText } = renderCard(
      [julie, marco],
      { onRemove },
    )

    fireEvent.press(getByLabelText(/support:editA11y/))
    expect(queryAllByLabelText(/support:callA11y/)).toHaveLength(0)
    expect(queryAllByLabelText(/support:textA11y/)).toHaveLength(0)
    // + and the pencil give way to Done while editing.
    expect(queryByLabelText(/support:addContact/)).toBeNull()
    expect(queryByLabelText(/support:editA11y/)).toBeNull()

    fireEvent.press(getAllByLabelText(/support:removeA11y/)[1])
    expect(onRemove).toHaveBeenCalledWith(1)

    fireEvent.press(getByLabelText(/support:done/))
    expect(queryAllByLabelText(/support:removeA11y/)).toHaveLength(0)
    expect(getAllByLabelText(/support:callA11y/)).toHaveLength(2)
    expect(getByLabelText(/support:addContact/)).toBeTruthy()
  })

  it("leaves edit mode when the last contact goes, so the next add is not in edit mode", () => {
    const view = renderCard([julie])
    fireEvent.press(view.getByLabelText(/support:editA11y/))
    expect(view.getByLabelText(/support:removeA11y/)).toBeTruthy()

    view.rerender(
      <SupportCard
        contacts={[]}
        onAdd={noop}
        onCall={noop}
        onText={noop}
        onRemove={noop}
        onOpenSupport={noop}
      />,
    )
    expect(view.queryByLabelText(/support:done/)).toBeNull()
    expect(view.getByText(/support:emptyIntro/)).toBeTruthy()

    view.rerender(
      <SupportCard
        contacts={[marco]}
        onAdd={noop}
        onCall={noop}
        onText={noop}
        onRemove={noop}
        onOpenSupport={noop}
      />,
    )
    expect(view.queryByLabelText(/support:removeA11y/)).toBeNull()
    expect(view.getByLabelText(/support:callA11y/)).toBeTruthy()
  })
})
