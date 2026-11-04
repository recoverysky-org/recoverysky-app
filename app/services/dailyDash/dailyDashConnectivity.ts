import type { ClientConnectivity } from "@daily-dash/client"
import { reaction } from "mobx"

/**
 * The client's connectivity port over the app's NetworkStore. ADDED 2026-11-04.
 *
 * Takes the store structurally (`{ readonly isOffline: boolean }`) rather than
 * importing `@/models`: `services/dailyDash` must never depend on `models`, or
 * depcruise sees a cycle once `app.tsx` wires this in. app.tsx passes
 * `rootStore.networkStore` (an MST computed, so the reaction below tracks it).
 */
export function createDailyDashConnectivity(networkStore: {
  readonly isOffline: boolean
}): ClientConnectivity {
  return {
    // A no-op on purpose. The client reports how each of its requests ended
    // ("answered" / "no_answer"), but the app's own connectivity is NetInfo's
    // interface state plus the internet oracle (CLAUDE.md "Maintenance Mode"),
    // and NetworkStore has one writer, the NetInfo listener. Letting a second
    // API's request outcomes move our banner would give it two sources of truth.
    reach: () => {},

    // Fires on the offline → online edge only (true → false). `reaction` skips
    // its initial run, so subscribing while online does not fire, and a
    // repeated `false` never fires. Returns MobX's disposer, which is what the
    // client calls to unsubscribe.
    onReconnect: (fn) =>
      reaction(
        () => networkStore.isOffline,
        (isOffline, wasOffline) => {
          if (wasOffline && !isOffline) fn()
        },
      ),
  }
}
