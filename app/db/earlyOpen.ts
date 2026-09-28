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
 * CHANGED 2026-09-14 (RS-024): the key now comes from acquireSqliteEncryptionKey(),
 * which refuses to mint a fresh key over an existing encrypted file, and a
 * failed open closes the singleton so DatabaseProvider does not inherit a
 * connection whose SQLCipher codec has already latched an error. The
 * failure is logged with its classified kind, not the migration SQL.
 *
 * Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
 */

import { migrations } from "@recoverysky-org/common/sqlite"

import { logger } from "@/utils/logger"

import { acquireSqliteEncryptionKey } from "./acquireKey"
import { classifyDbOpenFailure, errorChainText, rootCauseLine } from "./dbOpenLogic"
import { closeDb, openDb } from "./provider"

const log = logger.child({ module: "earlyOpen" })

export async function openDbEarly(): Promise<boolean> {
  try {
    const key = await acquireSqliteEncryptionKey()
    const { db } = await openDb(key)
    // Dynamic import mirrors DatabaseProvider — keeps the migrator out of
    // the module graph until it's actually needed.
    const { migrate } = await import("drizzle-orm/expo-sqlite/migrator")
    await migrate(db, migrations)
    return true
  } catch (error) {
    // Expected on web if expo-sqlite isn't available there — cold path.
    const message = String(error)
    log.warn("Early DB open failed — config cache unavailable this launch", {
      // CHANGED 2026-09-22 (RS-024): whole cause chain, not just `message`.
      kind: classifyDbOpenFailure(errorChainText(error)),
      // First line only: the DrizzleError message embeds the whole
      // multi-line migration SQL, which is noise in Loki.
      error: message.split("\n")[0],
      cause: rootCauseLine(error),
    })
    // Release the singleton so DatabaseProvider opens a fresh connection.
    await closeDb().catch(() => {})
    return false
  }
}
