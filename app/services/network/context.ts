/**
 * The device's current network, flattened for log attributes. ADDED 2026-09-28.
 *
 * Written by the NetInfo listener in ./index.ts (the only writer), read by the
 * internet oracle's log line and — via the provider injected into the Api —
 * by every "API request" line. Those request lines already carry `durationMs`
 * and production ships LOG_LEVEL=trace, so with this attached every device
 * reports its latency to our API broken down by the network it was on: the
 * per-device baseline behind "which users typically have poor network",
 * without sending anything anywhere new.
 *
 * Only fields NetInfo exposes WITHOUT a permission prompt:
 * - `netType` — wifi / cellular / ethernet / none / unknown / other.
 * - `cellGen` + `carrier` — cellular only. `carrier` is Android-only in
 *   practice; iOS 16+ returns "--" (CTCarrier is deprecated), dropped here.
 * - `wifiStrength` — 0–100, Android only.
 *
 * NOT the Wi-Fi name (SSID) or BSSID, deliberately: both need precise-location
 * permission (plus an entitlement on iOS), and an SSID is often a family name —
 * effectively a home address tied to a recovery user. Decided 2026-09-28.
 *
 * Deliberately free of `@/models` imports so ConfigStore and services/api can
 * read it without an import cycle.
 */
import type { NetInfoState } from "@react-native-community/netinfo"

export type NetworkLogContext = Record<string, string | number>

let current: NetworkLogContext = {}

/** Called by the NetInfo listener on every state event. */
export function updateNetworkLogContext(state: NetInfoState): void {
  const next: NetworkLogContext = { netType: state.type }
  if (state.type === "cellular") {
    if (state.details?.cellularGeneration) next.cellGen = state.details.cellularGeneration
    const carrier = state.details?.carrier
    if (carrier && carrier !== "--") next.carrier = carrier
  } else if (state.type === "wifi") {
    if (typeof state.details?.strength === "number") next.wifiStrength = state.details.strength
  }
  current = next
}

/** Snapshot of the current network for a log line. Empty until NetInfo reports. */
export function getNetworkLogContext(): NetworkLogContext {
  return current
}
