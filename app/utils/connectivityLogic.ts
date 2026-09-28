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

/**
 * What the sticky top banner should show.
 * ADDED 2026-09-28 "network" / "no-internet": see `decideBanner`.
 */
export type BannerState =
  | "none"
  | "offline"
  | "no-internet"
  | "network"
  | "connecting"
  | "maintenance"

/**
 * Which copy the full-screen cold-start outage screen shows.
 * ADDED 2026-09-28 "network": the precheck / config fetch failed at the
 * transport level on a device whose interface is up.
 */
export type OutageVariant = "offline" | "network" | "maintenance"

/**
 * Why `maintenanceMode` / `outageMode` is on. ADDED 2026-09-28.
 *
 * - "server" — the server said so (`MAINTENANCE_MODE`), or it answered with
 *   something other than a transport failure (5xx, bad data, a rejection).
 * - "network" — every failed attempt was a transport failure
 *   (`cannot-connect` / `timeout`): no request got an answer at all.
 *
 * Why this exists: `isOffline` keys off the network INTERFACE (see
 * services/network), and a phone on dead-backhaul Wi-Fi, a captive portal or
 * a one-bar cellular link has an interface that is up. Those devices failed
 * the /config ladder and were told "Maintenance in progress" while our API was
 * healthy — 2026-09-27/28 Loki: four sessions, NetInfo `isOffline: false` on
 * all four, every attempt cannot-connect/timeout, and one of them failed Expo's
 * OTA server with a TLS error in the same second. A request that never reached
 * anyone is not evidence about our service.
 */
export type MaintenanceCause = "server" | "network"

/**
 * Problem kinds meaning "no answer arrived" — the request never completed a
 * round trip, so it says nothing about the server. Deliberately excludes
 * `unknown`: apisauce's UNKNOWN_ERROR covers odd client states too, and an
 * unclassified failure keeps the old (server) interpretation rather than
 * quietly blaming the user's connection.
 */
const TRANSPORT_PROBLEMS: readonly string[] = ["cannot-connect", "timeout"]

/** Whether an API problem kind is a transport failure (see TRANSPORT_PROBLEMS). */
export function isTransportProblem(kind: string | undefined | null): boolean {
  return kind != null && TRANSPORT_PROBLEMS.includes(kind)
}

/**
 * How one internet-oracle probe ended (services/network/oracle.ts). ADDED
 * 2026-09-28. "answered" = ANY HTTP response, whatever the status — a 404
 * from 1.1.1.1 still proves packets made the round trip.
 */
export type OracleProbeOutcome = "answered" | "timeout" | "failed"

/**
 * The oracle's verdict: is the public internet reachable from this device?
 * True when ANY probe answered. False only when EVERY probe failed — both
 * Cloudflare and Google unreachable inside the budget is as close to "this
 * device's network is down" as a client can get, since neither is our
 * infrastructure and both are anycast IP literals (no DNS involved). One
 * provider can be blocked on its own (8.8.8.8 is, in some countries), which
 * is why one failure alone never counts. An empty list is "no verdict".
 */
export function decideOracleVerdict(outcomes: readonly OracleProbeOutcome[]): boolean | null {
  if (outcomes.length === 0) return null
  return outcomes.some((o) => o === "answered")
}

/**
 * Classify a failed retry ladder from the problem kind of each failed attempt.
 * "network" only when there was at least one attempt and EVERY attempt was a
 * transport failure — a single real server answer (a 502, a 401) means the
 * server was reachable, so the ladder's failure is ours to own.
 */
export function decideMaintenanceCause(
  failedKinds: readonly (string | undefined | null)[],
): MaintenanceCause {
  return failedKinds.length > 0 && failedKinds.every(isTransportProblem) ? "network" : "server"
}

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
  /** ADDED 2026-09-28. Absent/null reads as "server" (the old behavior). */
  maintenanceCause?: MaintenanceCause | null
  /** NetInfo's reachability probe; null = not yet known. ADDED 2026-09-28. */
  isInternetReachable?: boolean | null
  /**
   * Our own 1.1.1.1 / 8.8.8.8 oracle verdict from the last failed ladder
   * (decideOracleVerdict); null = not run. Outranks NetInfo's probe when
   * present — it ran at the moment of failure, against two independent
   * providers. ADDED 2026-09-28.
   */
  internetOracle?: boolean | null
}): BannerState {
  if (i.isOffline) return "offline"
  // ADDED 2026-09-28: a transport-failure "maintenance" is really the
  // device's connection — say so. Ranks above "connecting" because it is the
  // root cause: a degraded device lane on a dead link can't re-attest either.
  // The probe only picks the COPY, never whether we show the network variant:
  // the probe host is blocked on some national networks (services/network
  // header), so `false` alone must never classify anyone. When it agrees
  // with our own failed requests, we can name the connection plainly.
  // CHANGED 2026-09-28 (later): the internet oracle, when it ran, decides the
  // copy. false → the device's internet is down for sure; true → the
  // internet works and only RecoverySky is unreachable from here (a network
  // that blocks us, or an edge ban). Either way still the network variant —
  // the oracle refines the wording, it never escalates to amber.
  if (i.maintenanceMode && i.maintenanceCause === "network") {
    const internetDown =
      i.internetOracle != null ? !i.internetOracle : i.isInternetReachable === false
    return internetDown ? "no-internet" : "network"
  }
  if (i.deviceAuthDegraded) return "connecting"
  if (i.maintenanceMode) return "maintenance"
  return "none"
}

/**
 * Pick the cold-start outage screen's copy. The screen is an observer, so a
 * device that regains wifi mid-outage flips to the maintenance variant live
 * (correct — at that point the API genuinely still hasn't answered).
 */
export function decideOutageVariant(i: {
  isOffline: boolean
  /** ADDED 2026-09-28. Absent/null reads as "server" (the old behavior). */
  maintenanceCause?: MaintenanceCause | null
}): OutageVariant {
  if (i.isOffline) return "offline"
  return i.maintenanceCause === "network" ? "network" : "maintenance"
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
