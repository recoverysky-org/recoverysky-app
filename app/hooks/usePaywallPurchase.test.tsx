/**
 * usePaywallPurchase (ADDED 2026-11-19): the in-place paywall's follow-up. A cancelled paywall shows
 * nothing; a purchase shows the cloud-backup offer or, when it does not apply, "Welcome to
 * Premium!"; and `purchase` resolves only after that dialog is tapped, because the reminder popups
 * open their editor (an RN Modal) right after it.
 */
import { Alert } from "react-native"
import { act, renderHook } from "@testing-library/react-native"

import { usePaywallPurchase } from "./usePaywallPurchase"

const mockShowPaywall = jest.fn<Promise<boolean>, []>()
const mockPromptCloudBackup = jest.fn<Promise<boolean>, []>()
const mockTrackEvent = jest.fn()

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ showPaywall: mockShowPaywall }),
}))
jest.mock("./useCloudBackupPrompt", () => ({
  useCloudBackupPrompt: () => ({ promptCloudBackup: mockPromptCloudBackup }),
}))
jest.mock("@/services/tracking", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

type AlertButtons = Parameters<typeof Alert.alert>[2]

let alertSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {})
})

afterEach(() => alertSpy.mockRestore())

describe("usePaywallPurchase", () => {
  it("resolves false and shows nothing when the paywall is cancelled", async () => {
    mockShowPaywall.mockResolvedValue(false)
    const { result } = renderHook(() => usePaywallPurchase())

    let bought: boolean | undefined
    await act(async () => {
      bought = await result.current.purchase("reminder")
    })

    expect(bought).toBe(false)
    expect(mockPromptCloudBackup).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith("upgrade_tapped", { source: "reminder" })
    expect(mockTrackEvent).not.toHaveBeenCalledWith("upgrade_purchased", expect.anything())
  })

  it("offers cloud backup after a purchase and skips the plain success dialog", async () => {
    mockShowPaywall.mockResolvedValue(true)
    mockPromptCloudBackup.mockResolvedValue(true)
    const { result } = renderHook(() => usePaywallPurchase())

    let bought: boolean | undefined
    await act(async () => {
      bought = await result.current.purchase("attendance")
    })

    expect(bought).toBe(true)
    expect(mockPromptCloudBackup).toHaveBeenCalledTimes(1)
    expect(alertSpy).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith("upgrade_purchased", { source: "attendance" })
  })

  it("shows Welcome to Premium when the backup offer does not apply, and waits for its tap", async () => {
    mockShowPaywall.mockResolvedValue(true)
    mockPromptCloudBackup.mockResolvedValue(false)
    const { result } = renderHook(() => usePaywallPurchase())

    let settled = false
    let pending: Promise<boolean> | undefined
    await act(async () => {
      pending = result.current.purchase("settings").then((value) => {
        settled = true
        return value
      })
    })

    expect(alertSpy).toHaveBeenCalledTimes(1)
    expect(alertSpy.mock.calls[0][0]).toMatch(/^settingsScreen:subscriptionSuccess\b/)
    expect(settled).toBe(false)

    const buttons = alertSpy.mock.calls[0][2] as NonNullable<AlertButtons>
    await act(async () => {
      buttons[0].onPress?.()
    })

    await expect(pending).resolves.toBe(true)
    expect(settled).toBe(true)
  })
})
