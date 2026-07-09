/**
 * Pure, dependency-free date helpers.
 *
 * Kept free of any `@/` runtime imports so it stays unit-testable under Vitest
 * (Vitest has no `@/` path alias — see project memory). Any I/O or app wiring
 * belongs in the callers, not here.
 */

/**
 * Device-LOCAL calendar date as "YYYY-MM-DD" for a given instant
 * (defaults to now).
 *
 * Why this exists: `new Date().toISOString().split("T")[0]` serializes in UTC,
 * so for a device BEHIND UTC the date string can roll to *tomorrow* in the
 * evening — e.g. a US-Eastern user at 11pm on Jun 29 got a "Jun 30"
 * recovery-date default. Reading the local getters keeps "today" anchored to
 * the device clock. Use this anywhere you need "today" as a calendar day the
 * user would recognize, never `toISOString()`.
 */
export function todayLocalISODate(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
