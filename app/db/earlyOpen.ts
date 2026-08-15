/**
 * Early database open for the cold-start config cache.
 *
 * app.tsx init needs to read the cached /config payload BEFORE the React
 * tree (and therefore DatabaseProvider) mounts — the tree only renders
 * once init calls setRootStore. Safe to open here because openDb() is a
 * module singleton (DatabaseProvider's later call reuses the instance)
 * and drizzle migrations are idempotent (tracked in __drizzle_migrations),
 * so DatabaseProvider's own migrate() becomes a no-op. Running migrate()
 * here also guarantees the config_caches table exists before the first
 * read — no "table missing on first launch after OTA" edge.
 *
 * Returns false on ANY failure: the caller treats that as a cache miss and
 * takes the cold (gated) path. DatabaseProvider still owns the user-facing
 * error UX for a genuinely broken database — this function never throws.
 *
 * Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
 */

import { migrations } from "@recoverysky-org/common/sqlite"

import { getSqliteEncryptionKey } from "@/services/encryption/sqliteKey"
import { logger } from "@/utils/logger"

import { openDb } from "./provider"

const log = logger.child({ module: "earlyOpen" })

export async function openDbEarly(): Promise<boolean> {
  try {
    const key = await getSqliteEncryptionKey()
    const { db } = await openDb(key)
    // Dynamic import mirrors DatabaseProvider — keeps the migrator out of
    // the module graph until it's actually needed.
    const { migrate } = await import("drizzle-orm/expo-sqlite/migrator")
    await migrate(db, migrations)
    return true
  } catch (error) {
    // Expected on web if expo-sqlite isn't available there — cold path.
    log.warn("Early DB open failed — config cache unavailable this launch", {
      error: String(error),
    })
    return false
  }
}
