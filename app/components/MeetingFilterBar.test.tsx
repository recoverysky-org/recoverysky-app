import { fireEvent, render, screen } from "@testing-library/react-native"

import { MeetingFilterBar } from "./MeetingFilterBar"

// Resolve against the real `en` catalogue so a11y labels are asserted as a
// screen reader says them. Same pattern as MapListToggle.test.tsx.
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

const baseProps = {
  fellowship: "NA",
  fellowshipOptions: ["AA", "NA", "CMA"],
  language: null as string | null,
  languageOptions: ["EN", "ES"],
  onSelectFellowship: jest.fn(),
  onSelectLanguage: jest.fn(),
}

describe("MeetingFilterBar", () => {
  beforeEach(() => jest.clearAllMocks())

  it("announces both current values", () => {
    render(<MeetingFilterBar {...baseProps} language="ES" />)
    expect(screen.getByLabelText("Fellowship, NA")).toBeTruthy()
    expect(screen.getByLabelText("Language, Español")).toBeTruthy()
  })

  it("announces 'All' when no language is selected", () => {
    render(<MeetingFilterBar {...baseProps} />)
    expect(screen.getByLabelText("Language, All")).toBeTruthy()
  })

  it("offers no 'All' fellowship option", () => {
    render(<MeetingFilterBar {...baseProps} />)
    fireEvent.press(screen.getByTestId("filter-bar-fellowship"))
    expect(screen.queryByTestId("fellowship-option-all")).toBeNull()
    expect(screen.getByTestId("fellowship-option-CMA")).toBeTruthy()
  })

  it("reports a fellowship pick", () => {
    render(<MeetingFilterBar {...baseProps} />)
    fireEvent.press(screen.getByTestId("filter-bar-fellowship"))
    fireEvent.press(screen.getByTestId("fellowship-option-CMA"))
    expect(baseProps.onSelectFellowship).toHaveBeenCalledWith("CMA")
  })

  it("reports a language pick and the 'All' pick as null", () => {
    render(<MeetingFilterBar {...baseProps} language="EN" />)
    fireEvent.press(screen.getByTestId("filter-bar-language"))
    fireEvent.press(screen.getByTestId("language-option-ES"))
    expect(baseProps.onSelectLanguage).toHaveBeenLastCalledWith("ES")

    fireEvent.press(screen.getByTestId("filter-bar-language"))
    fireEvent.press(screen.getByTestId("language-option-all"))
    expect(baseProps.onSelectLanguage).toHaveBeenLastCalledWith(null)
  })

  it("marks the selected option for screen readers", () => {
    render(<MeetingFilterBar {...baseProps} />)
    fireEvent.press(screen.getByTestId("filter-bar-fellowship"))
    expect(screen.getByTestId("fellowship-option-NA").props.accessibilityState?.selected).toBe(true)
    expect(screen.getByTestId("fellowship-option-AA").props.accessibilityState?.selected).toBe(
      false,
    )
  })
})
