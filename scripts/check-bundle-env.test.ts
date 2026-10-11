import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

// The checker is a plain CommonJS script run with `node`, like
// check-env-sync.js. createRequire keeps tsc from needing a declaration file
// (allowJs is off).
const load = createRequire(import.meta.url)
const { leakCandidates, findLeaks } = load("./check-bundle-env.js") as {
  leakCandidates: (input: {
    local: Array<[string, string]>
    easNames: Set<string>
    sourceText: string
  }) => Array<{ name: string; value: string }>
  findLeaks: (
    candidates: Array<{ name: string; value: string }>,
    bundles: Record<string, Buffer>,
  ) => Record<string, string[]>
}

const AGENT = "http://localhost:3333"
const KEY = "dev-key-0123456789"

describe("leakCandidates", () => {
  it("keeps a local EXPO_PUBLIC_ value the EAS environment does not define", () => {
    expect(
      leakCandidates({
        local: [["EXPO_PUBLIC_AGENT_URL", AGENT]],
        easNames: new Set(["EXPO_PUBLIC_API_URL"]),
        sourceText: "",
      }),
    ).toEqual([{ name: "EXPO_PUBLIC_AGENT_URL", value: AGENT }])
  })

  it("drops a variable EAS defines, because the EAS value is the one that ships", () => {
    expect(
      leakCandidates({
        local: [["EXPO_PUBLIC_API_URL", "http://192.168.1.20:4000"]],
        easNames: new Set(["EXPO_PUBLIC_API_URL"]),
        sourceText: "",
      }),
    ).toEqual([])
  })

  it("ignores names Expo never inlines", () => {
    expect(
      leakCandidates({
        local: [["SENTRY_AUTH_TOKEN", "sntrys_0123456789"]],
        easNames: new Set(),
        sourceText: "",
      }),
    ).toEqual([])
  })

  it("drops values too short to search a bundle for without false alarms", () => {
    expect(
      leakCandidates({
        local: [
          ["EXPO_PUBLIC_RATING_MIN_DAYS", "30"],
          ["EXPO_PUBLIC_JOIN_MEETING_ZID", ""],
        ],
        easNames: new Set(),
        sourceText: "",
      }),
    ).toEqual([])
  })

  it("drops a value written literally in app source, which is meant to ship", () => {
    expect(
      leakCandidates({
        local: [["EXPO_PUBLIC_AGENT_URL", "https://agent.recoverysky.app"]],
        easNames: new Set(),
        sourceText: 'process.env.EXPO_PUBLIC_AGENT_URL || "https://agent.recoverysky.app"',
      }),
    ).toEqual([])
  })
})

describe("findLeaks", () => {
  const candidates = [
    { name: "EXPO_PUBLIC_AGENT_URL", value: AGENT },
    { name: "EXPO_PUBLIC_AUTH_KEY", value: KEY },
  ]

  it("names each candidate found in a bundle, with the bundles it is in", () => {
    expect(
      findLeaks(candidates, {
        "android/index.hbc": Buffer.from(`\u0000${AGENT}\u0000${KEY}\u0000`),
        "ios/index.hbc": Buffer.from(`\u0000${KEY}\u0000`),
      }),
    ).toEqual({
      EXPO_PUBLIC_AGENT_URL: ["android/index.hbc"],
      EXPO_PUBLIC_AUTH_KEY: ["android/index.hbc", "ios/index.hbc"],
    })
  })

  it("reports nothing when no bundle carries a candidate", () => {
    expect(findLeaks(candidates, { "ios/index.hbc": Buffer.from("api.recoverysky.app") })).toEqual(
      {},
    )
  })
})
