import { act, render, screen } from "@testing-library/react-native"

import { ConversationStoreModel } from "@/models/ConversationStore"

import { ToolResultRenderer } from "./ToolResultRenderer"

// The real hook warns once per run with no i18next instance, and answers the key anyway.
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

let mockStore: ReturnType<typeof ConversationStoreModel.create>
jest.mock("@/models", () => ({
  useConversationStore: () => mockStore,
}))

const part = {
  type: "tool-result" as const,
  toolCallId: "call-1",
  toolName: "searchMeetings",
  result: { meetings: [{ id: "m1", name: "Sunrise Serenity", fellowship: "AA" }] },
}

// The real store and the real card, because what this pins is the wiring between them.
describe("ToolResultRenderer", () => {
  beforeEach(() => {
    mockStore = ConversationStoreModel.create({})
  })

  // Spec D5: the collapse state lives in the store's volatile map. As a plain component the renderer
  // read it once, and the card never redrew when its popup closed. The observer wrap is the fix.
  it("collapses the card when the store's map changes", () => {
    render(<ToolResultRenderer part={part} messageId="reply" onSelectMeeting={jest.fn()} />)
    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()

    act(() => {
      mockStore.collapseToolResult("call-1", "Selected: Sunrise Serenity")
    })

    expect(screen.getByText("Selected: Sunrise Serenity")).toBeTruthy()
    expect(screen.queryByText("Sunrise Serenity")).toBeNull()
  })

  it("leaves the card open when another tool call collapses", () => {
    render(<ToolResultRenderer part={part} messageId="reply" onSelectMeeting={jest.fn()} />)

    act(() => {
      mockStore.collapseToolResult("call-2", "Selected: another")
    })

    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()
  })
})
