/**
 * ConfigCacheSqliteRepository - SQLite data access for the /config cache
 *
 * Single-row (id "default") cache of the raw /config response JSON, stored
 * in the encrypted SQLite database so warm cold-starts don't gate on a live
 * fetch. Mirrors UserProfileSqliteRepository's shape — see that file for
 * why single-row repositories live app-side over the common-lib table.
 *
 * Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
 */

import { config_caches as configCaches } from "@recoverysky-org/common/sqlite"
import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "ConfigCacheRepo" })

/** Cache row as stored in SQLite */
export interface ConfigCacheRecord {
  id: string
  payload: string
  fetchedAt: number
}

const DEFAULT_ID = "default"

export class ConfigCacheSqliteRepository {
  constructor(private db: ExpoSQLiteDatabase<Record<string, never>>) {}

  /** Read the single cache row. null = cache miss (never throws). */
  async load(): Promise<ConfigCacheRecord | null> {
    try {
      const rows = await this.db
        .select()
        .from(configCaches as any)
        .limit(1)
      return (rows[0] as ConfigCacheRecord) || null
    } catch (error) {
      log.error("load error", { error: String(error) })
      return null
    }
  }

  /** Upsert the single cache row. Failures are logged, never thrown —
   *  a failed cache write must not break the config fetch path. */
  async save(payload: string, fetchedAt: number): Promise<void> {
    try {
      await this.db
        .insert(configCaches as any)
        .values({ id: DEFAULT_ID, payload, fetchedAt })
        .onConflictDoUpdate({
          target: configCaches.id as any,
          set: { payload, fetchedAt },
        })
    } catch (error) {
      log.error("save error", { error: String(error) })
    }
  }
}
