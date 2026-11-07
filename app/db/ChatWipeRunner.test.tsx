import { act, render } from "@testing-library/react-native"

import { logger } from "@/utils/logger"

import { ChatWipeRunner } from "./ChatWipeRunner"
import { useDatabase } from "./DatabaseProvider"
import { chatMessageRepo } from "./repositories"

/* The one-time delete of the chat rows (spec D4). The rule these tests hold: the flag is saved only
 * after a delete that reported success, and a build with no agent URL touches nothing, because there
 * those rows are the person's only readable copy of their chats. */

jest.mock("./DatabaseProvider", () => ({ useDatabase: jest.fn() }))
// Only `clear`: a runner that read a row would throw here.
jest.mock("./repositories", () => ({ chatMessageRepo: { clear: jest.fn() } }))
jest.mock("@/utils/logger", () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  return { logger: { child: () => log } }
})
// A real little store rather than two independent stubs, so the tests catch a save under one key and
// a load under another, which would wipe on every launch.
const mockStorage = new Map<string, string>()
jest.mock("@/utils/storage", () => ({
  loadString: (key: string) => mockStorage.get(key) ?? null,
  saveString: (key: string, value: string) => {
    mockStorage.set(key, value)
    return true
  },
}))

const clear = chatMessageRepo.clear as jest.Mock
const useDatabaseMock = useDatabase as jest.Mock
const log = logger.child({ module: "test" })

const DONE_KEY = "agent.chatWipe.done"

/** Long enough for the runner's await on `clear` and whatever follows it to finish. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve))
  })
}

async function launch(status = "seeded") {
  useDatabaseMock.mockReturnValue({ status })
  const view = render(<ChatWipeRunner />)
  await settle()
  return view
}

describe("ChatWipeRunner", () => {
  const originalUrl = process.env.EXPO_PUBLIC_AGENT_URL

  beforeEach(() => {
    jest.clearAllMocks()
    mockStorage.clear()
    clear.mockResolvedValue({ ok: true, value: undefined })
    // direnv exports `.env` into the shell, so a value here must never be left to chance.
    process.env.EXPO_PUBLIC_AGENT_URL = "https://agent.example.test"
  })

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_AGENT_URL
    else process.env.EXPO_PUBLIC_AGENT_URL = originalUrl
  })

  it("wipes once the database is seeded, and saves the flag on ok", async () => {
    await launch()
    expect(clear).toHaveBeenCalledTimes(1)
    expect(mockStorage.has(DONE_KEY)).toBe(true)
  })

  it("does not save the flag when the wipe fails", async () => {
    clear.mockResolvedValue({ ok: false, error: new Error("disk I/O error") })
    await launch()
    expect(clear).toHaveBeenCalledTimes(1)
    expect(mockStorage.has(DONE_KEY)).toBe(false)
    expect(log.error).toHaveBeenCalledTimes(1)
  })

  // `chatMessageRepo.clear` builds its repository first, and that step can throw before any Result
  // exists. It must end the same way as a failed Result. The log line is what shows the rejection
  // was caught: an uncaught one would leave the flag unsaved too, and jest would not fail on it.
  it("does not save the flag when the wipe throws", async () => {
    clear.mockRejectedValue(new Error("database not open"))
    await launch()
    expect(clear).toHaveBeenCalledTimes(1)
    expect(mockStorage.has(DONE_KEY)).toBe(false)
    expect(log.error).toHaveBeenCalledTimes(1)
  })

  it("tries again on the next launch after a failure, and not after a success", async () => {
    clear.mockResolvedValueOnce({ ok: false, error: new Error("disk I/O error") })
    const first = await launch()
    first.unmount()
    expect(clear).toHaveBeenCalledTimes(1)

    const second = await launch()
    second.unmount()
    expect(clear).toHaveBeenCalledTimes(2)

    await launch()
    expect(clear).toHaveBeenCalledTimes(2)
  })

  // The hidden-tab production install (spec D4): an OTA reaches it, and the rows there are the only
  // readable copy of chats from before the tab was hidden.
  it("does nothing in a build with no agent URL", async () => {
    delete process.env.EXPO_PUBLIC_AGENT_URL
    await launch()
    expect(clear).not.toHaveBeenCalled()
    expect(mockStorage.has(DONE_KEY)).toBe(false)
  })

  it("does nothing when the flag is saved", async () => {
    mockStorage.set(DONE_KEY, "1")
    await launch()
    expect(clear).not.toHaveBeenCalled()
  })

  it("waits for the database, then wipes when it is seeded", async () => {
    const view = await launch("open")
    expect(clear).not.toHaveBeenCalled()

    useDatabaseMock.mockReturnValue({ status: "seeded" })
    view.rerender(<ChatWipeRunner />)
    await settle()
    expect(clear).toHaveBeenCalledTimes(1)
  })

  // A rekey takes the status out of "seeded" and back while the runner stays mounted. A wipe that
  // failed must wait for the next launch rather than retrying inside this one.
  it("runs once per launch even when the status comes back to seeded", async () => {
    clear.mockResolvedValue({ ok: false, error: new Error("disk I/O error") })
    const view = await launch()

    useDatabaseMock.mockReturnValue({ status: "reencrypting" })
    view.rerender(<ChatWipeRunner />)
    useDatabaseMock.mockReturnValue({ status: "seeded" })
    view.rerender(<ChatWipeRunner />)
    await settle()

    expect(clear).toHaveBeenCalledTimes(1)
  })
})
