/**
 * Network monitoring — the ONLY writer to NetworkStore.
 *
 * NetworkStore existed since the Ignite template with a comment promising a
 * "NetInfo listener" that was never actually wired: `isConnected` sat at its
 * default `true` forever, so `isOffline` never fired for its consumers (the
 * In-Person map toggle, Settings' offline row, the sync gate). ADDED
 * 2026-09-06 with the network-aware maintenance work — see
 * docs/superpowers/specs/2026-09-06-network-aware-maintenance-design.md.
 *
 * Reachability uses NetInfo's default probe URL, deliberately independent of
 * our API, so "internet reachable" and "RecoverySky reachable" stay two
 * distinct signals. `isOffline` keys off the interface state (`isConnected`),
 * NOT the probe — the probe host can be blocked on some national networks and
 * must not misclassify those users as offline.
 *
 * Never disposed: network state matters for the app's whole lifetime (same
 * rationale as the config-cache persistence reaction in app.tsx).
 */
import NetInfo, { NetInfoState } from "@react-native-community/netinfo"

import type { RootStore } from "@/models"
import { api } from "@/services/api"
import { logger } from "@/utils/logger"

import { getNetworkLogContext, updateNetworkLogContext } from "./context"

const log = logger.child({ module: "NetworkMonitor" })

type StoreConnectionType = "wifi" | "cellular" | "ethernet" | "unknown" | "none"

/**
 * NetInfo reports more types than NetworkStore's enum models (bluetooth,
 * wimax, vpn, other). Anything unmapped is "unknown" — the store only ever
 * branches on none-vs-rest and wifi/cellular.
 */
const TYPE_MAP: Partial<Record<NetInfoState["type"], StoreConnectionType>> = {
  wifi: "wifi",
  cellular: "cellular",
  ethernet: "ethernet",
  none: "none",
}

export function initNetworkMonitoring(rootStore: RootStore): void {
  let lastOffline: boolean | null = null
  // ADDED 2026-09-28: last KNOWN probe verdict (null = not yet known).
  let lastReachable: boolean | null = null

  // ADDED 2026-09-28: every "API request" line carries the current network
  // (type, cellular generation/carrier, Wi-Fi strength) next to its
  // durationMs — see ./context. Injected, not imported by the Api, which must
  // stay a dependency leaf.
  api.setLogContextProvider(getNetworkLogContext)

  // addEventListener fires immediately with the current state on subscribe,
  // so the store is live before the caller's next await completes.
  NetInfo.addEventListener((state: NetInfoState) => {
    updateNetworkLogContext(state)
    const isConnected = state.isConnected === true
    rootStore.networkStore.setNetworkStatus(
      isConnected,
      TYPE_MAP[state.type] ?? "unknown",
      state.isInternetReachable,
    )

    // Log only offline-state EDGES, not every event — NetInfo emits on any
    // interface detail change and would spam Loki.
    // CHANGED 2026-09-28: also logs reachability-probe edges. The four
    // sessions that showed a false "maintenance" banner on 2026-09-27/28 all
    // logged one `isOffline: false` line and nothing after, so whether NetInfo
    // knew the connection was dead was unanswerable. Transitions to/from
    // `null` (probe pending) are skipped — every launch starts there, and
    // logging it would add a line per session for nothing.
    const isOffline = !isConnected
    const reachable = state.isInternetReachable
    const reachabilityEdge = reachable !== null && reachable !== lastReachable
    if (isOffline !== lastOffline || reachabilityEdge) {
      log.info("Device network state changed", {
        isOffline,
        isInternetReachable: reachable ?? "unknown",
        type: state.type,
        ...getNetworkLogContext(),
      })
      lastOffline = isOffline
      if (reachable !== null) lastReachable = reachable
    }
  })
}
