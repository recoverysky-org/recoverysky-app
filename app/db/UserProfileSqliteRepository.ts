/**
 * UserProfileSqliteRepository - SQLite data access for user profile
 *
 * Stores sensitive profile data in encrypted SQLite database.
 * Uses the "default" profile ID since there's only one profile per device.
 */

import { user_profiles as userProfiles } from "@sqlite"
import { eq, sql } from "drizzle-orm"
import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"

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
      console.error("[UserProfileSqliteRepository] findDefault error:", error)
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
      console.error("[UserProfileSqliteRepository] create error:", error)
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
      console.error("[UserProfileSqliteRepository] update error:", error)
      return null
    }
  }

  /**
   * Upsert the default profile (insert or update on conflict)
   */
  async upsert(data: UserProfileInput): Promise<UserProfileRecord | null> {
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
        .onConflictDoUpdate({
          target: userProfiles.id as any,
          set: {
            shortName: sql`excluded.short_name`,
            pronouns: sql`excluded.pronouns`,
            recoveryDate: sql`excluded.recovery_date`,
            fellowship: sql`excluded.fellowship`,
            language: sql`excluded.language`,
          },
        })
        .returning()) as UserProfileRecord[]
      return rows[0] || null
    } catch (error) {
      console.error("[UserProfileSqliteRepository] upsert error:", error)
      return null
    }
  }
}
