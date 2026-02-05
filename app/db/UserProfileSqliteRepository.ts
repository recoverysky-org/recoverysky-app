/**
 * UserProfileSqliteRepository - SQLite data access for user profile
 *
 * Stores sensitive profile data in encrypted SQLite database.
 * Uses the "default" profile ID since there's only one profile per device.
 */

import { user_profiles as userProfiles } from "@recoverysky-org/common/sqlite"
import { eq, sql } from "drizzle-orm"
import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "UserProfileRepo" })

/** Profile data stored in SQLite */
export interface UserProfileRecord {
  id: string
  shortName: string
  pronouns: string | null
  recoveryDate: string | null
  fellowship: string
  language: string
}

/** Input for creating/updating profile */
export interface UserProfileInput {
  shortName?: string
  pronouns?: string | null
  recoveryDate?: string | null
  fellowship?: string
  language?: string
}

const DEFAULT_PROFILE_ID = "default"

export class UserProfileSqliteRepository {
  constructor(private db: ExpoSQLiteDatabase<Record<string, never>>) {}

  /**
   * Find the default profile
   */
  async findDefault(): Promise<UserProfileRecord | null> {
    try {
      const rows = await this.db
        .select()
        .from(userProfiles as any)
        .limit(1)
      return (rows[0] as UserProfileRecord) || null
    } catch (error) {
      log.error("findDefault error", { error: String(error) })
      return null
    }
  }

  /**
   * Create a new profile with default ID
   */
  async create(data: UserProfileInput): Promise<UserProfileRecord | null> {
    try {
      const rows = (await this.db
        .insert(userProfiles as any)
        .values({
          id: DEFAULT_PROFILE_ID,
          shortName: data.shortName ?? "",
          pronouns: data.pronouns ?? null,
          recoveryDate: data.recoveryDate ?? null,
          fellowship: data.fellowship ?? "AA",
          language: data.language ?? "",
        })
        .returning()) as UserProfileRecord[]
      return rows[0] || null
    } catch (error) {
      log.error("create error", { error: String(error) })
      return null
    }
  }

  /**
   * Update the default profile
   */
  async update(changes: UserProfileInput): Promise<UserProfileRecord | null> {
    try {
      const rows = (await this.db
        .update(userProfiles as any)
        .set(changes as any)
        .where(eq(userProfiles.id as any, DEFAULT_PROFILE_ID) as any)
        .returning()) as UserProfileRecord[]
      return rows[0] || null
    } catch (error) {
      log.error("update error", { error: String(error) })
      return null
    }
  }

  /**
   * Upsert the default profile (insert or update on conflict)
   *
   * IMPORTANT: Only updates fields that are explicitly provided.
   * Missing fields are NOT reset to defaults on update.
   */
  async upsert(data: UserProfileInput): Promise<UserProfileRecord | null> {
    try {
      // First, try to get existing profile to merge with
      const existing = await this.findDefault()

      if (existing) {
        // Profile exists - only update provided fields
        const updates: Partial<UserProfileInput> = {}
        if (data.shortName !== undefined) updates.shortName = data.shortName
        if (data.pronouns !== undefined) updates.pronouns = data.pronouns
        if (data.recoveryDate !== undefined) updates.recoveryDate = data.recoveryDate
        if (data.fellowship !== undefined) updates.fellowship = data.fellowship
        if (data.language !== undefined) updates.language = data.language

        if (Object.keys(updates).length === 0) {
          return existing // Nothing to update
        }

        log.debug("Updating profile", { fields: Object.keys(updates) })
        return await this.update(updates)
      } else {
        // No profile exists - create with provided values + defaults
        log.debug("Creating new profile", { fields: Object.keys(data) })
        return await this.create(data)
      }
    } catch (error) {
      log.error("upsert error", { error: String(error) })
      return null
    }
  }
}
