// A jest test (.tsx) only because the service imports `@/`, which vitest cannot resolve.
import { optOut, registerPushToken, unregisterPushToken } from "./expoNotificationService"

const mockRegisterPushToken = jest.fn()
jest.mock("@/services/api", () => ({
  api: { registerPushToken: (...args: unknown[]) => mockRegisterPushToken(...args) },
}))
jest.mock("@/i18n", () => ({ translate: (key: string) => key }))
jest.mock("@/utils/logger", () => {
  const log = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
  return { logger: { child: () => log } }
})
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: "project-1" } } } },
}))
jest.mock("expo-device", () => ({ isDevice: true }))
jest.mock("expo-notifications", () => ({
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[device-token]" })),
}))

describe("expoNotificationService", () => {
  beforeEach(async () => {
    mockRegisterPushToken.mockReset()
    mockRegisterPushToken.mockResolvedValue({ kind: "ok" })
    // Sign in, which caches the identity and the token.
    await registerPushToken("user-1", "device-1")
    mockRegisterPushToken.mockClear()
  })

  afterEach(() => unregisterPushToken())

  // Settings → Delete User Data calls optOut() and then, without waiting, unregisterPushToken().
  // The opt-out read the cached token and identity after its first await, so it found them
  // cleared, threw on the null token, and never reached the server: the phone's token stayed
  // enabled and a deleted person could still get reminders.
  it("sends the opt-out with the identity it started with when logout clears the cache meanwhile", async () => {
    const optedOut = optOut()
    unregisterPushToken()
    await optedOut

    expect(mockRegisterPushToken).toHaveBeenCalledTimes(1)
    expect(mockRegisterPushToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        deviceId: "device-1",
        token: "ExponentPushToken[device-token]",
        enabled: false,
      }),
    )
  })

  it("sends nothing once logout has already cleared the cache", async () => {
    unregisterPushToken()
    await optOut()

    expect(mockRegisterPushToken).not.toHaveBeenCalled()
  })
})
