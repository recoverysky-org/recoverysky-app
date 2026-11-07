import type { ReactNode } from "react"
import { Alert, type AlertButton } from "react-native"
import { act, fireEvent, render, screen } from "@testing-library/react-native"

import { SettingsScreen } from "./SettingsScreen"

// Everything Settings draws around its Delete User Data row is mocked: these tests are about what
// the handler does and in what order, and the screen pulls in most of the app.
jest.mock("@/components/Screen", () => {
  const { createElement } = jest.requireActual<typeof import("react")>("react")
  const { View } = jest.requireActual<typeof import("react-native")>("react-native")
  return {
    Screen: ({ children }: { children: ReactNode }) => createElement(View, null, children),
  }
})
jest.mock("@/components/AccountMethodRow", () => ({ AccountMethodRow: () => null }))
jest.mock("@/components/Icon", () => ({ Icon: () => null }))
jest.mock("@/components/PermissionsSection", () => ({ PermissionsSection: () => null }))
jest.mock("@/components/ThemeColorPicker", () => ({ ThemeColorPicker: () => null }))
jest.mock("@/components/Toast", () => ({ useToast: () => ({ showToast: jest.fn() }) }))
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-location", () => ({ getForegroundPermissionsAsync: jest.fn() }))
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

jest.mock("@/i18n", () => ({
  translate: (key: string) => key,
  getAvailableLanguages: () => [],
  getCurrentLanguage: () => "en",
  languageNames: {},
}))

// One record of the handler's steps, so the tests can read their order.
const mockSteps: string[] = []
const mockStep =
  <T,>(name: string, answer?: T) =>
  () => {
    mockSteps.push(name)
    return answer
  }

let mockLogoutSubscription: () => Promise<void>
jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({
    isPremium: false,
    hasAttendance: false,
    isLoading: false,
    billingUnresponsive: false,
    subscriptionInfo: null,
    showPaywall: jest.fn(),
    restore: jest.fn(),
    logout: () => mockLogoutSubscription(),
  }),
}))

const mockAuthStore = {
  loginMethod: "email",
  userId: "user-1",
  authEmail: "user@example.com",
  idToken: null,
  ownerEmail: "user@example.com",
  logout: () => mockStep("authStore.logout")(),
  clearOwner: jest.fn(),
}
const mockProfileStore = {
  isHydrated: false,
  shortName: "",
  language: "en",
  fellowship: "AA",
  recoveryDateAsDate: new Date(2020, 0, 1),
  reset: () => mockStep("profile.reset")(),
}
const mockConversationStore = { forgetConversation: () => mockStep("forgetConversation")() }
jest.mock("@/models", () => ({
  useProfileStore: () => mockProfileStore,
  useAuthenticationStore: () => mockAuthStore,
  useConversationStore: () => mockConversationStore,
  useConfigStore: () => ({ agentUrl: "https://agent.test", maintenanceMode: false }),
  useNetworkStore: () => ({ isOffline: false }),
}))

jest.mock("@/db", () => ({
  reminderRepo: { deleteByUserId: jest.fn() },
  reminderEvents: { emit: jest.fn() },
}))
const mockResetLocalDatabase = jest.fn()
jest.mock("@/db/resetLocalDatabase", () => ({
  resetLocalDatabase: (...args: unknown[]) => {
    mockSteps.push("resetLocalDatabase")
    return mockResetLocalDatabase(...args)
  },
}))
jest.mock("@/hooks/useCloudBackupPrompt", () => ({
  RESTORE_BACKUP_PROMPT_COPY: {},
  useCloudBackupPrompt: () => ({ promptCloudBackup: jest.fn() }),
}))
jest.mock("@/hooks/usePermissionToggles", () => ({
  usePermissionToggles: () => ({
    handleNotificationsToggle: jest.fn(),
    handleLocationToggle: jest.fn(),
  }),
}))
jest.mock("@/hooks/useSubscriptionReturn", () => ({
  useSubscriptionReturn: () => ({ consume: jest.fn() }),
}))
jest.mock("@/navigators/navigationUtilities", () => ({ setPendingMeetingId: jest.fn() }))
jest.mock("@/services/api", () => ({ api: {} }))
const mockArchive = jest.fn()
jest.mock("@/services/api/agentConversations", () => ({
  agentConversationsClient: () => ({
    archive: (...args: unknown[]) => {
      mockSteps.push("archive")
      return mockArchive(...args)
    },
  }),
}))
jest.mock("@/services/auth/accountMethodsLogic", () => ({
  describeAccount: () => ({ active: null, linked: [] }),
}))
jest.mock("@/services/auth/secureStorage", () => ({
  clearAllSecureData: () => mockStep("clearAllSecureData")(),
}))
jest.mock("@/services/auth/useAuth0Wrapper", () => ({
  useAuth0Wrapper: () => ({ logout: () => mockStep("logout")() }),
}))
jest.mock("@/services/dailyDash", () => ({
  resetDailyDashLocalData: () => mockStep("resetDailyDashLocalData")(),
}))
jest.mock("@/services/notifications", () => ({
  logoutNotificationUser: () => mockStep("logoutNotificationUser")(),
  optOutNotifications: () => mockStep("optOutNotifications")(),
}))
jest.mock("@/services/purchases", () => ({ billingUnresponsiveCopy: () => ({}) }))
jest.mock("@/services/rating", () => ({ requestRatingFromSettings: jest.fn() }))
jest.mock("@/services/support", () => ({
  clearSupportContacts: () => mockStep("clearSupportContacts")(),
}))
jest.mock("@/services/sync", () => ({
  attendanceSync: { syncState: { phase: "idle", lastSyncedAt: null, pendingCount: 0 } },
}))
jest.mock("@/services/sync/enableCloudBackup", () => ({ enableCloudBackup: jest.fn() }))
jest.mock("@/services/tracking", () => ({ trackEvent: jest.fn() }))
jest.mock("@/utils/checkForUpdates", () => ({ checkForUpdates: jest.fn() }))
jest.mock("@/utils/logger", () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
  },
}))
let mockReloadApp: (onError?: (error: unknown) => void) => Promise<void>
jest.mock("@/utils/reloadApp", () => ({
  reloadApp: (onError?: (error: unknown) => void) => mockReloadApp(onError),
}))
jest.mock("@/utils/storage", () => ({ clear: () => mockStep("clearStorage")() }))

const screenProps = {
  navigation: { setParams: jest.fn(), addListener: () => () => {}, navigate: jest.fn() },
  route: { key: "Settings", name: "Settings", params: {} },
} as unknown as Parameters<typeof SettingsScreen>[0]

/** The confirmation's OK button, as a person gets it each time they tap the row. */
function askToDelete(): () => unknown {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {})
  fireEvent.press(screen.getByLabelText("settingsScreen:deleteUserData"))
  const buttons = alert.mock.lastCall?.[2] as AlertButton[]
  alert.mockRestore()
  return () => buttons.find((button) => button.style === "destructive")?.onPress?.()
}

const count = (name: string) => mockSteps.filter((step) => step === name).length

describe("Settings: Delete User Data", () => {
  const agentUrlBefore = process.env.EXPO_PUBLIC_AGENT_URL

  beforeEach(() => {
    mockSteps.length = 0
    jest.clearAllMocks()
    process.env.EXPO_PUBLIC_AGENT_URL = "https://agent.test"
    mockLogoutSubscription = async () => {
      mockSteps.push("logoutSubscription")
    }
    mockArchive.mockResolvedValue(true)
    mockResetLocalDatabase.mockResolvedValue(undefined)
    mockReloadApp = async () => {
      mockSteps.push("reloadApp")
    }
    render(<SettingsScreen {...screenProps} />)
  })

  afterAll(() => {
    process.env.EXPO_PUBLIC_AGENT_URL = agentUrlBefore
  })

  describe("a second OK while the first still runs", () => {
    // Step 3 can wait 5 seconds after OK with nothing on screen, so a second try is a real thing a
    // person does. It would race the first handler's resetLocalDatabase() and its reload.
    it("starts no second delete", async () => {
      let answerArchive: (archived: boolean) => void = () => {}
      mockArchive.mockReturnValue(new Promise((resolve) => (answerArchive = resolve)))

      const first = askToDelete()()
      await act(async () => {})
      const second = askToDelete()()
      await act(async () => {})
      expect(count("logoutSubscription")).toBe(1)

      answerArchive(true)
      await act(async () => {
        await Promise.all([first, second])
      })

      expect(count("logoutSubscription")).toBe(1)
      expect(count("archive")).toBe(1)
      expect(count("resetLocalDatabase")).toBe(1)
      expect(count("reloadApp")).toBe(1)
    })

    it("stays guarded once the reload has been asked for, which ends this runtime", async () => {
      await act(async () => {
        await askToDelete()()
      })
      await act(async () => {
        await askToDelete()()
      })
      expect(count("reloadApp")).toBe(1)
    })

    // Updates.reloadAsync can reject (it always does in a dev build). The app is still running, and
    // the person has no other way to try again short of a restart.
    it("can run again when the reload failed and the app is still here", async () => {
      mockReloadApp = async (onError) => {
        mockSteps.push("reloadApp")
        onError?.(new Error("reload failed"))
      }

      await act(async () => {
        await askToDelete()()
      })
      await act(async () => {
        await askToDelete()()
      })

      expect(count("reloadApp")).toBe(2)
    })
  })

  describe("forgetting Sky's conversation", () => {
    // Logout writes the root snapshot back to MMKV after step 5 cleared it. Forgetting after that
    // write is what keeps the old id out of the next launch.
    it("forgets after every sign-out step, and archives before them", async () => {
      await act(async () => {
        await askToDelete()()
      })

      expect(mockSteps.indexOf("archive")).toBeLessThan(mockSteps.indexOf("logout"))
      expect(mockSteps.indexOf("forgetConversation")).toBeGreaterThan(mockSteps.indexOf("logout"))
      expect(count("forgetConversation")).toBe(1)
    })

    it("forgets even when step 1 throws, after the catch's sign-out", async () => {
      mockLogoutSubscription = async () => {
        throw new Error("RevenueCat said no")
      }

      await act(async () => {
        await askToDelete()()
      })

      // R21: a throw at step 1 skips the archive, and spec D7 accepts the thread coming back.
      expect(count("archive")).toBe(0)
      expect(mockSteps.indexOf("forgetConversation")).toBeGreaterThan(
        mockSteps.indexOf("authStore.logout"),
      )
      expect(mockSteps.indexOf("forgetConversation")).toBeLessThan(
        mockSteps.indexOf("resetLocalDatabase"),
      )
    })

    it("makes no archive call in a build with no agent URL, and still forgets", async () => {
      process.env.EXPO_PUBLIC_AGENT_URL = ""

      await act(async () => {
        await askToDelete()()
      })

      expect(count("archive")).toBe(0)
      expect(count("forgetConversation")).toBe(1)
    })
  })
})
