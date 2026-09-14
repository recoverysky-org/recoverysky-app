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
export type BannerState = "none" | "offline" | "connecting" | "maintenance"

/** Which copy the full-screen cold-start outage screen shows. */
export type OutageVariant = "offline" | "maintenance"

/**
 * Pick the runtime banner. Offline wins over everything: an offline device
 * cannot verify any server claim, and "you're offline" is true and
 * actionable regardless of our service state.
 * ADDED 2026-09-09 "connecting": cold-start attestation hit a temporary
 * failure, the app opened on local data, and the refresher is retrying.
 * Ranks above maintenance because it is the more specific diagnosis — the
 * device-token-less requests are what make features look "in maintenance".
 */
export function decideBanner(i: {
  isOffline: boolean
  maintenanceMode: boolean
  deviceAuthDegraded: boolean
}): BannerState {
  if (i.isOffline) return "offline"
  if (i.deviceAuthDegraded) return "connecting"
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

/**
 * Is the Live meetings fetch pointless right now? Either service-side state
 * means `getLiveSchedules` cannot succeed and should not be attempted:
 *
 * - `maintenanceMode` — runtime maintenance (server flag, or an online
 *   device's exhausted /config retries). Banner UX.
 * - `outageMode` — cold-start outage (`/status/ready` precheck failed, or
 *   /config failed / reported maintenance on a cold cache). Full-screen UX.
 *
 * ADDED 2026-09-14: MeetingContext used to watch `maintenanceMode` alone.
 * On the cold-start outage path `maintenanceMode` never becomes true — the
 * precheck fails before /config is ever fetched — so when the outage cleared
 * there was no true→false edge to fire the refresh, and the Live list stayed
 * empty until a manual pull. Production was masked because outage recovery
 * reloads the whole app (`Updates.reloadAsync`), which re-runs the initial
 * fetch; `reloadAsync` throws in `__DEV__`, which is where the empty list
 * was seen. Observing both flags makes the refresh independent of whether
 * that reload succeeds.
 */
export function isLiveRefreshBlocked(i: {
  maintenanceMode: boolean
  outageMode: boolean
}): boolean {
  return i.maintenanceMode || i.outageMode
}

/**
 * Did the service just become usable again? True only on the blocked →
 * unblocked transition. `wasBlocked` is `undefined` on a reaction's first
 * evaluation (no previous value); that is not an edge — the mount-time
 * refresh already covers the initial state.
 */
export function isServiceRecoveryEdge(
  wasBlocked: boolean | undefined,
  isBlocked: boolean,
): boolean {
  return wasBlocked === true && !isBlocked
}
