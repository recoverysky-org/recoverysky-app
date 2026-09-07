/**
 * connectivityLogic — pure decisions for network-aware maintenance UX.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it (vitest
 * has no path-alias resolution in this repo — see CLAUDE.md "Test Runner
 * Split"). The I/O half — the NetInfo subscription feeding NetworkStore —
 * lives in `@/services/network`.
 *
 * The single rule, applied everywhere: `isOffline` (device interface down)
 * means "it's the device, not us" — no API failure may be presented as
 * maintenance while it is true. Only an online device's exhausted retries
 * count as evidence of a service problem.
 *
 * See docs/superpowers/specs/2026-09-06-network-aware-maintenance-design.md.
 */

/** What the sticky top banner should show. */
export type BannerState = "none" | "offline" | "maintenance"

/** Which copy the full-screen cold-start outage screen shows. */
export type OutageVariant = "offline" | "maintenance"

/**
 * Pick the runtime banner. Offline wins over maintenance: an offline device
 * cannot verify a maintenance claim, and "you're offline" is true and
 * actionable regardless of our service state.
 */
export function decideBanner(i: { isOffline: boolean; maintenanceMode: boolean }): BannerState {
  if (i.isOffline) return "offline"
  if (i.maintenanceMode) return "maintenance"
  return "none"
}

/**
 * Pick the cold-start outage screen's copy. The screen is an observer, so a
 * device that regains wifi mid-outage flips to the maintenance variant live
 * (correct — at that point the API genuinely still hasn't answered).
 */
export function decideOutageVariant(i: { isOffline: boolean }): OutageVariant {
  return i.isOffline ? "offline" : "maintenance"
}

/**
 * Should an exhausted /config retry budget flip `maintenanceMode`?
 *
 * - Offline → never. The failure is the device's; the offline banner is
 *   already telling the truth. This is the fix for offline users seeing
 *   "Maintenance in progress".
 * - `isLoaded` false → never. The cold-start failure path is owned by
 *   app.tsx's outage gate (`setOutageMode`), not the banner.
 */
export function shouldFlipMaintenanceOnPollFailure(i: {
  isOffline: boolean
  isLoaded: boolean
}): boolean {
  return !i.isOffline && i.isLoaded
}

/**
 * Should a config poll tick be skipped entirely? While offline, a poll
 * cannot succeed and must not run at all — otherwise its failure gets
 * counted somewhere. Resync on reconnect is the reaction in app.tsx's poll
 * effect, not this predicate's job.
 */
export function shouldSkipConfigPoll(i: { isOffline: boolean }): boolean {
  return i.isOffline
}
