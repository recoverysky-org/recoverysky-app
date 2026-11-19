/**
 * MyDayWelcomeGate (ADDED 2026-11-18, spec
 * `docs/superpowers/specs/2026-11-18-my-day-welcome-design.md`): the first visit to My Day shows
 * the welcome page in place of Today, Get started writes the flag and shows Today, and a seen
 * flag in a production build goes straight to Today.
 *
 * `useMyDayTheme` returns the package's light look and test-controlled surfaces (no blur, which is
 * native), so the page renders without a `MyDayProvider`. Text renders its `tx` key in jest (test/setup.ts
 * mocks i18n), so the queries match keys.
 */
import { ImageBackground } from "react-native"
import { fireEvent, render, screen } from "@testing-library/react-native"

import { Text } from "@/components/Text"
import { loadString, saveString } from "@/utils/storage"

import { MyDayWelcomeGate } from "./MyDayWelcomeGate"

jest.mock("@/utils/storage", () => ({
  loadString: jest.fn(),
  saveString: jest.fn(() => true),
}))

// `mock` prefix: jest.mock factories may only close over variables named so (they are hoisted).
let mockSurfaces: { photo?: { uri: string }; insets?: { top: number } } = {}

jest.mock("@daily-dash/my-day", () => {
  const actual = jest.requireActual("@daily-dash/my-day")
  return {
    ...actual,
    useMyDayTheme: () => ({ theme: actual.dailyDashLight, surfaces: mockSurfaces }),
  }
})

const mockLoadString = loadString as jest.Mock
const mockSaveString = saveString as jest.Mock

function renderGate() {
  return render(
    <MyDayWelcomeGate>
      <Text text="TODAY" />
    </MyDayWelcomeGate>,
  )
}

const g = global as unknown as { __DEV__: boolean }
let savedDev: boolean

beforeEach(() => {
  jest.clearAllMocks()
  savedDev = g.__DEV__
  mockSurfaces = { insets: { top: 47 } }
})

afterEach(() => {
  g.__DEV__ = savedDev
})

describe("MyDayWelcomeGate", () => {
  // Production (`__DEV__` false), so these exercise the once-only path the person gets.
  it("shows the welcome page on a first visit and writes nothing on show", () => {
    g.__DEV__ = false
    mockLoadString.mockReturnValue(null)
    renderGate()
    expect(screen.getByText(/^myDayWelcome:title/)).toBeTruthy()
    expect(screen.queryByText("TODAY")).toBeNull()
    expect(mockSaveString).not.toHaveBeenCalled()
  })

  it("Get started writes the flag and shows Today", () => {
    g.__DEV__ = false
    mockLoadString.mockReturnValue(null)
    renderGate()
    fireEvent.press(screen.getByText(/^myDayWelcome:getStarted/))
    expect(mockSaveString).toHaveBeenCalledWith("myDay.welcomeSeen", "1")
    expect(screen.getByText("TODAY")).toBeTruthy()
    expect(screen.queryByText(/^myDayWelcome:title/)).toBeNull()
  })

  it("goes straight to Today in a production build once seen", () => {
    g.__DEV__ = false
    mockLoadString.mockReturnValue("1")
    renderGate()
    expect(screen.getByText("TODAY")).toBeTruthy()
    expect(screen.queryByText(/^myDayWelcome:title/)).toBeNull()
  })

  it("shows in a dev build even once seen", () => {
    g.__DEV__ = true
    mockLoadString.mockReturnValue("1")
    renderGate()
    expect(screen.getByText(/^myDayWelcome:title/)).toBeTruthy()
  })

  it("announces the three titles as headings", () => {
    mockLoadString.mockReturnValue(null)
    renderGate()
    for (const key of ["title", "whatTitle", "whyTitle"]) {
      const node = screen.getByText(new RegExp(`^myDayWelcome:${key}`))
      expect(node.props.accessibilityRole).toBe("header")
    }
  })

  it("backs the photo and keeps it out of Smart Invert", () => {
    g.__DEV__ = false
    mockLoadString.mockReturnValue(null)
    mockSurfaces = { photo: { uri: "photo.jpg" }, insets: { top: 47 } }
    renderGate()
    const photo = screen.UNSAFE_getByType(ImageBackground)
    expect(photo.props.source).toEqual({ uri: "photo.jpg" })
    expect(photo.props.accessibilityIgnoresInvertColors).toBe(true)
  })
})
