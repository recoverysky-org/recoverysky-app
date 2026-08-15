/**
 * Pure decision logic for the startup config cache.
 *
 * Kept free of runtime `@/` imports so vitest can load it (see "Test Runner
 * Split" in CLAUDE.md) — the type-only import below is erased at compile
 * time. The I/O halves live in app/db/ConfigCacheSqliteRepository.ts and
 * the init path in app.tsx.
 *
 * Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
 */

import type { ServerConfig } from "@/services/api"

/** The cache row fields this decision needs (subset of ConfigCacheRecord) */
export interface CachedConfigRow {
  payload: string
  fetchedAt: number
}

export type StartupConfigDecision =
  | { mode: "warm"; config: ServerConfig }
  | { mode: "cold" }

/**
 * Decide the startup path from the cache row. Warm = a parseable object
 * payload; anything else (missing row, empty payload, bad JSON, non-object
 * JSON) is cold — byte-for-byte the pre-cache gated startup. Deliberately
 * no field-level validation: the payload was written verbatim from a
 * successful /config response, and ConfigStore.applyServerConfig already
 * guards every field it applies.
 */
export function decideStartupConfigPath(row: CachedConfigRow | null): StartupConfigDecision {
  if (!row || !row.payload) return { mode: "cold" }
  try {
    const parsed: unknown = JSON.parse(row.payload)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { mode: "cold" }
    }
    return { mode: "warm", config: parsed as ServerConfig }
  } catch {
    return { mode: "cold" }
  }
}
