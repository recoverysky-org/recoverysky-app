import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AGENT_GUIDE, createAgentConversationsClient } from "./agentConversationsLogic"

const BASE = "http://agent.test"
const HEADERS = { "Authorization": "Bearer user.jwt.sig", "X-Device-Token": "dev.jwt.sig" }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const html = (status: number) =>
  new Response("<html><body>Bad Gateway</body></html>", {
    status,
    headers: { "Content-Type": "text/html" },
  })

/** A client over a fake fetch, with the fake's calls readable by the test. */
function setup(answer: () => Promise<Response>, timeoutMs?: number) {
  const fetchFake = vi.fn((_input: unknown, _init?: RequestInit) => answer())
  const headers = vi.fn<() => Promise<Record<string, string>>>(async () => HEADERS)
  const client = createAgentConversationsClient({
    baseUrl: BASE,
    headers,
    fetch: fetchFake,
    timeoutMs,
  })
  /** The one request the client made. */
  const sent = () => {
    expect(fetchFake).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFake.mock.calls[0]
    return { url: String(url), init: init as RequestInit }
  }
  return { client, fetchFake, headers, sent }
}

const never = () => new Promise<Response>(() => {})

describe("AGENT_GUIDE", () => {
  it("is the agent's default guide", () => {
    expect(AGENT_GUIDE).toBe("base-identity")
  })
})

describe("listNewest", () => {
  it("asks for the newest base-identity conversation and answers its id", async () => {
    const { client, sent } = setup(async () =>
      json(200, { conversations: [{ conversationId: "c-1" }] }),
    )

    expect(await client.listNewest()).toEqual({ kind: "ok", value: "c-1" })

    const { url, init } = sent()
    expect(url).toBe(`${BASE}/api/v1/conversations?guide=base-identity&limit=1`)
    expect(init.headers).toEqual(HEADERS)
  })

  it("answers null when none is listed", async () => {
    const { client } = setup(async () => json(200, { conversations: [] }))
    expect(await client.listNewest()).toEqual({ kind: "ok", value: null })
  })

  it("treats a body with no array as unavailable", async () => {
    for (const body of [{}, { conversations: "c-1" }, null, []]) {
      const { client } = setup(async () => json(200, body))
      expect(await client.listNewest()).toEqual({ kind: "unavailable" })
    }
  })

  it("treats an HTML page as unavailable", async () => {
    for (const status of [200, 502]) {
      const { client } = setup(async () => html(status))
      expect(await client.listNewest()).toEqual({ kind: "unavailable" })
    }
  })

  // null would send the caller off to mint an id, forking the person's thread
  it("treats a listed row with no usable id as unavailable, never as none", async () => {
    for (const row of [{}, { conversationId: "" }, { conversationId: 7 }, null]) {
      const { client } = setup(async () => json(200, { conversations: [row] }))
      expect(await client.listNewest()).toEqual({ kind: "unavailable" })
    }
  })

  it("treats 503 and a thrown fetch as unavailable", async () => {
    const down = setup(async () => json(503, { conversations: [] }))
    expect(await down.client.listNewest()).toEqual({ kind: "unavailable" })

    const offline = setup(() => Promise.reject(new TypeError("Network request failed")))
    expect(await offline.client.listNewest()).toEqual({ kind: "unavailable" })
  })

  it("treats a headers() rejection as unavailable and sends nothing", async () => {
    const { client, fetchFake, headers } = setup(async () => json(200, { conversations: [] }))
    headers.mockRejectedValueOnce(new Error("keychain locked"))

    expect(await client.listNewest()).toEqual({ kind: "unavailable" })
    expect(fetchFake).not.toHaveBeenCalled()
  })
})

describe("readMessages", () => {
  const message = { id: "m-1", role: "user", parts: [{ type: "text", text: "hi" }] }

  it("reads limit=200 and answers the messages", async () => {
    const { client, sent } = setup(async () => json(200, { messages: [message] }))

    expect(await client.readMessages("c-1")).toEqual({ kind: "ok", value: [message] })

    const { url, init } = sent()
    expect(url).toBe(`${BASE}/api/v1/conversations/c-1/messages?limit=200`)
    expect(init.headers).toEqual(HEADERS)
  })

  it("encodes the id into the path", async () => {
    const { client, sent } = setup(async () => json(200, { messages: [] }))

    await client.readMessages("a/b c")

    expect(sent().url).toBe(`${BASE}/api/v1/conversations/a%2Fb%20c/messages?limit=200`)
  })

  it("keeps a message's metadata", async () => {
    const withMetadata = { ...message, metadata: { createdAt: "2026-11-06" } }
    const { client } = setup(async () => json(200, { messages: [withMetadata] }))
    expect(await client.readMessages("c-1")).toEqual({ kind: "ok", value: [withMetadata] })
  })

  it("answers refused on 403 and 404", async () => {
    for (const status of [403, 404]) {
      const { client } = setup(async () => json(status, { error: "nope" }))
      expect(await client.readMessages("c-1")).toEqual({ kind: "refused" })
    }
  })

  // A refusal makes the caller drop the id. A 401 or a 503 says nothing about the thread.
  it("answers unavailable on the other failures", async () => {
    for (const status of [401, 429, 500, 503]) {
      const { client } = setup(async () => json(status, { error: "nope" }))
      expect(await client.readMessages("c-1")).toEqual({ kind: "unavailable" })
    }
  })

  it("drops entries with no id, role or parts array", async () => {
    const { client } = setup(async () =>
      json(200, {
        messages: [
          { role: "user", parts: [] },
          { id: "", role: "user", parts: [] },
          { id: "m-2", parts: [] },
          { id: "m-3", role: "user" },
          { id: "m-4", role: "user", parts: "hi" },
          null,
          "m-5",
          message,
        ],
      }),
    )
    expect(await client.readMessages("c-1")).toEqual({ kind: "ok", value: [message] })
  })

  it("treats a body with no messages array as unavailable", async () => {
    for (const body of [{}, { messages: {} }, null]) {
      const { client } = setup(async () => json(200, body))
      expect(await client.readMessages("c-1")).toEqual({ kind: "unavailable" })
    }
    const page = setup(async () => html(200))
    expect(await page.client.readMessages("c-1")).toEqual({ kind: "unavailable" })
  })

  it("treats a thrown fetch and a headers() rejection as unavailable", async () => {
    const offline = setup(() => Promise.reject(new TypeError("Network request failed")))
    expect(await offline.client.readMessages("c-1")).toEqual({ kind: "unavailable" })

    const locked = setup(async () => json(200, { messages: [] }))
    locked.headers.mockRejectedValueOnce(new Error("keychain locked"))
    expect(await locked.client.readMessages("c-1")).toEqual({ kind: "unavailable" })
  })
})

describe("archive", () => {
  it("posts the guide and except, answering true on 200", async () => {
    const { client, sent } = setup(async () => json(200, { archived: 3 }))

    expect(await client.archive({ except: "c-2" })).toBe(true)

    const { url, init } = sent()
    expect(url).toBe(`${BASE}/api/v1/conversations/archive`)
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({ ...HEADERS, "Content-Type": "application/json" })
    expect(JSON.parse(String(init.body))).toEqual({ guide: "base-identity", except: "c-2" })
  })

  it("omits except when none is given", async () => {
    const { client, sent } = setup(async () => json(200, { archived: 1 }))

    expect(await client.archive({})).toBe(true)

    expect(JSON.parse(String(sent().init.body))).toEqual({ guide: "base-identity" })
  })

  it("answers false on 503 and on a thrown fetch", async () => {
    const down = setup(async () => json(503, {}))
    expect(await down.client.archive({})).toBe(false)

    const offline = setup(() => Promise.reject(new TypeError("Network request failed")))
    expect(await offline.client.archive({})).toBe(false)
  })

  it("answers false on a headers() rejection and sends nothing", async () => {
    const { client, fetchFake, headers } = setup(async () => json(200, {}))
    headers.mockRejectedValueOnce(new Error("keychain locked"))

    expect(await client.archive({})).toBe(false)
    expect(fetchFake).not.toHaveBeenCalled()
  })
})

describe("the timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Resolved yet, without waiting on it? */
  function watch<T>(promise: Promise<T>) {
    const seen: { value?: T; settled: boolean } = { settled: false }
    void promise.then((value) => {
      seen.value = value
      seen.settled = true
    })
    return seen
  }

  it("gives up at the timeout and answers false", async () => {
    const { client, sent } = setup(never)

    const seen = watch(client.archive({ timeoutMs: 5000 }))

    await vi.advanceTimersByTimeAsync(4999)
    expect(seen.settled).toBe(false)
    expect(sent().init.signal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(seen).toEqual({ settled: true, value: false })
    expect(sent().init.signal?.aborted).toBe(true)
  })

  it("defaults to 15 seconds", async () => {
    const { client } = setup(never)

    const seen = watch(client.listNewest())

    await vi.advanceTimersByTimeAsync(14_999)
    expect(seen.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(seen).toEqual({ settled: true, value: { kind: "unavailable" } })
  })

  it("takes the client's timeout, and archive's own over it", async () => {
    const { client } = setup(never, 1000)

    const read = watch(client.readMessages("c-1"))
    const archive = watch(client.archive({ timeoutMs: 2000 }))

    await vi.advanceTimersByTimeAsync(1000)
    expect(read).toEqual({ settled: true, value: { kind: "unavailable" } })
    expect(archive.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    expect(archive).toEqual({ settled: true, value: false })
  })

  // Delete User Data waits on archive for at most 5 seconds. A refresher stuck on the
  // credentials must not outlast that, and nothing may go out after we gave up.
  it("covers the wait for credentials, and sends nothing late", async () => {
    const { client, fetchFake, headers } = setup(async () => json(200, {}))
    let release = (_value: Record<string, string>) => {}
    headers.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )

    const seen = watch(client.archive({ timeoutMs: 5000 }))

    await vi.advanceTimersByTimeAsync(5000)
    expect(seen).toEqual({ settled: true, value: false })

    release(HEADERS)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchFake).not.toHaveBeenCalled()
  })

  it("covers a body that never finishes arriving", async () => {
    const stalled = { ok: true, status: 200, json: () => new Promise(() => {}) } as Response
    const { client } = setup(async () => stalled)

    const seen = watch(client.listNewest())

    await vi.advanceTimersByTimeAsync(15_000)
    expect(seen).toEqual({ settled: true, value: { kind: "unavailable" } })
  })

  it("leaves no timer behind once answered", async () => {
    const { client } = setup(async () => json(200, { conversations: [] }))

    await client.listNewest()

    expect(vi.getTimerCount()).toBe(0)
  })
})
