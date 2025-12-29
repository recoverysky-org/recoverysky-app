/**
 * Time formatting utilities
 *
 * Converts UTC milliseconds to local time display strings.
 */

import { DateTime } from "@common"

/**
 * Format UTC milliseconds to local time string (e.g., "3:30p")
 *
 * @param millis - UTC milliseconds timestamp
 * @returns Formatted time string in local timezone (e.g., "3:30p")
 */
export function formatMillisToLocalTime(millis: number): string {
  if (!millis) return ""
  return DateTime.fromMillis(millis).toLocal().toFormat("h:mma").toLowerCase().slice(0, -1)
}
