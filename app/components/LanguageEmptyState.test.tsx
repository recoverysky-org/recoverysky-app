import { fireEvent, render, screen } from "@testing-library/react-native"

import { LanguageEmptyState } from "./LanguageEmptyState"

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

describe("LanguageEmptyState", () => {
  it("names the language by its native name and clears on tap", () => {
    const onShowAll = jest.fn()
    render(<LanguageEmptyState language="ES" onShowAll={onShowAll} />)
    expect(screen.getByText("No Español meetings here")).toBeTruthy()
    fireEvent.press(screen.getByRole("button", { name: "Show all languages" }))
    expect(onShowAll).toHaveBeenCalledTimes(1)
  })
})
