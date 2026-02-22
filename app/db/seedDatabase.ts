/**
 * Database Seeding (disabled)
 *
 * Seeding is no longer needed — meetings, schedules, and trexes come from the API.
 * This module is kept as a stub to satisfy existing imports in DatabaseProvider.
 */

import { loadString, saveString } from "@/utils/storage"

const SEED_FLAG_KEY = "db_seeded_v2"

export interface SeedProgress {
  step: number
  totalSteps: number
  stepName: string
  stepKey: string
  current: number
  total: number
}

export type SeedProgressCallback = (progress: SeedProgress) => void

export function isDatabaseSeeded(): boolean {
  const flag = loadString(SEED_FLAG_KEY)
  return flag === "true"
}

export async function seedDatabase(): Promise<void> {
  if (isDatabaseSeeded()) return
  saveString(SEED_FLAG_KEY, "true")
}
