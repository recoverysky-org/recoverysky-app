/**
 * Pure half of the postal-code lookup (`api.lookupPostalCode`): turns an API
 * response into a result the In-Person ZIP search can act on.
 *
 * Zero runtime `@/` imports so vitest can load it (CLAUDE.md, "Test Runner
 * Split"). PRIVACY: nothing here logs; the code and its point never leave the
 * caller.
 */
import type { ZipAnswer } from "../../utils/inPersonSearchLogic"

export type PostalLookupResult =
  | { kind: "ok"; answer: ZipAnswer }
  | { kind: "unavailable" }
  | { kind: "failed"; problem: string }

function isCoord(v: unknown, limit: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -limit && v <= limit
}

function parseAnswer(data: unknown): ZipAnswer | null {
  if (!data || typeof data !== "object") return null
  const o = data as Record<string, unknown>
  if (o.found === false) return { found: false }
  if (o.found !== true) return null
  if (!isCoord(o.lat, 90) || !isCoord(o.lon, 180)) return null
  if (o.country !== "US" && o.country !== "CA") return null
  return { found: true, lat: o.lat, lon: o.lon, country: o.country }
}

export function toPostalLookupResult(input: {
  ok: boolean
  problemKind: string | null
  data: unknown
}): PostalLookupResult {
  if (!input.ok) {
    // A 404 means the route does not exist yet (older API), not "no such code".
    if (input.problemKind === "not-found") return { kind: "unavailable" }
    return { kind: "failed", problem: input.problemKind ?? "unknown" }
  }
  const answer = parseAnswer(input.data)
  return answer ? { kind: "ok", answer } : { kind: "failed", problem: "bad-data" }
}
