/**
 * ProgressDots draws the current onboarding variant's card set (ADDED
 * 2026-10-11): six dots for a real sign-in, four for a guest's first visit.
 * Each card names itself, so the selected dot follows the set — Zoom is the
 * third dot in one and the second in the other.
 *
 * The dot labels ("Step N of total") go through react-i18next, which has no
 * instance under test/setup.ts and returns the bare key, so the count and the
 * selected state are what is assertable here.
 */
import { render, screen } from "@testing-library/react-native"

import { OnboardingVariantProvider } from "./OnboardingVariant"
import { ProgressDots } from "./ProgressDots"

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn() }),
}))

const selected = () =>
  screen.getAllByRole("tab").map((tab) => tab.props.accessibilityState?.selected === true)

describe("ProgressDots", () => {
  it("draws six dots for the full onboarding", () => {
    render(<ProgressDots current="OnboardingZoom" />)

    expect(selected()).toEqual([false, false, true, false, false, false])
  })

  it("draws four dots for a guest's first visit, with Zoom second", () => {
    render(
      <OnboardingVariantProvider value="guest">
        <ProgressDots current="OnboardingZoom" />
      </OnboardingVariantProvider>,
    )

    expect(selected()).toEqual([false, true, false, false])
  })

  it("selects no dot for a card outside the set (the parked Profile)", () => {
    render(<ProgressDots current="OnboardingProfile" />)

    expect(selected()).toEqual([false, false, false, false, false, false])
  })
})
