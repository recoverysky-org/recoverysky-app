// A .tsx file with no JSX, on purpose: the store imports `@/utils/logger`,
// which vitest cannot resolve (CLAUDE.md "Test Runner Split"), and jest picks
// up only `*.test.tsx`.
import { AuthenticationStoreModel } from "./AuthenticationStore"

// A plain object stands in for the logger, so building the store never loads
// the real logger (createLogger's OTLP transport and timers) and the refusal's
// log line can be read back. Built inside the factory because jest.mock is
// hoisted above the imports; reached through jest.requireMock below.
jest.mock("@/utils/logger", () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  return { __log: log, logger: { child: () => log }, hashUserId: jest.fn() }
})

const { __log: log } = jest.requireMock("@/utils/logger") as {
  __log: Record<"info" | "warn" | "error" | "debug", jest.Mock>
}

const OWNER_SUB = "auth0|65f0000000000000000000aa"

describe("AuthenticationStore.enterGuest", () => {
  beforeEach(() => jest.clearAllMocks())

  it("enters guest mode when no identity is present", () => {
    const store = AuthenticationStoreModel.create({})
    store.enterGuest()
    expect(store.isGuest).toBe(true)
    expect(store.userId).toBeUndefined()
  })

  // Login also shows while a userId is present: for a signed-in owner whose
  // token is renewing at cold start, and while a forced logout is deferred for
  // a persisted attendance timer. Guest mode over that session would put the
  // owner's own Join on the guest path, with no attendance timer.
  it("refuses while a userId is present, leaving the session as it was", () => {
    const store = AuthenticationStoreModel.create({ userId: OWNER_SUB })
    store.enterGuest()
    expect(store.isGuest).toBe(false)
    expect(store.userId).toBe(OWNER_SUB)
  })

  it("logs the refusal as a warning that carries no identity", () => {
    const store = AuthenticationStoreModel.create({ userId: OWNER_SUB })
    store.enterGuest()
    expect(log.warn.mock.calls).toEqual([["enterGuest() refused: a signed-in identity is present"]])
    // No log line of any level may carry the raw sub (CLAUDE.md "Logging").
    const everyCall = [log.info, log.warn, log.error, log.debug].flatMap((fn) => fn.mock.calls)
    expect(JSON.stringify(everyCall)).not.toContain(OWNER_SUB)
  })
})
