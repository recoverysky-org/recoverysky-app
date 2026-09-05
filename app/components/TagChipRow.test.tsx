/**
 * Guards the chip row's screen-reader contract: each chip is a button whose
 * label is the tag itself and whose `accessibilityState.selected` mirrors the
 * tint fill — that state is the only thing a VoiceOver/TalkBack user gets in
 * place of the fill.
 */
import { fireEvent, render, screen } from "@testing-library/react-native"

import { TagChipRow } from "./TagChipRow"

describe("TagChipRow", () => {
  it("renders one chip per tag, labelled by the tag", () => {
    render(
      <TagChipRow tags={["step-work", "beginner-friendly"]} selected={[]} onToggle={jest.fn()} />,
    )
    expect(screen.getByLabelText("step-work")).toBeTruthy()
    expect(screen.getByLabelText("beginner-friendly")).toBeTruthy()
  })

  it("marks selected chips selected and the rest not", () => {
    render(
      <TagChipRow
        tags={["step-work", "beginner-friendly"]}
        selected={["step-work"]}
        onToggle={jest.fn()}
      />,
    )
    expect(screen.getByLabelText("step-work").props.accessibilityState?.selected).toBe(true)
    expect(screen.getByLabelText("beginner-friendly").props.accessibilityState?.selected).toBe(
      false,
    )
  })

  it("reports the pressed tag to onToggle", () => {
    const onToggle = jest.fn()
    render(<TagChipRow tags={["step-work"]} selected={[]} onToggle={onToggle} />)
    fireEvent.press(screen.getByLabelText("step-work"))
    expect(onToggle).toHaveBeenCalledWith("step-work")
  })

  it("renders nothing when there are no tags", () => {
    const { toJSON } = render(<TagChipRow tags={[]} selected={[]} onToggle={jest.fn()} />)
    expect(toJSON()).toBeNull()
  })
})
