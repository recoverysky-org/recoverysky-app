/**
 * mapLogging — routes MapLibre Native's internal log stream into the app
 * logger instead of the console.
 *
 * Why this exists: MapLibre's `LogManager` writes every native log record to
 * `console.error` / `console.warn` (see its `handleLog`, which is what runs
 * when no handler is installed). React Native's LogBox promotes both into
 * full-screen red/yellow overlays, and the map emits one record *per failed
 * tile request* — a slow connection or a cold CDN produced 44 stacked LogBox
 * entries reading "Failed to load source maptiler_planet_v4: The request
 * timed out." None of them were actionable and they buried real errors.
 *
 * Per-tile failures are transient and self-healing: MapLibre retries, and the
 * tiles that matter arrive on the next pan. The signal that a map is actually
 * broken — a bad style URL, a rejected MapTiler key — is
 * `Map.onDidFailLoadingMap`, which InPersonMapView already handles by falling
 * back to the list view. That callback fires once per failure, not once per
 * tile, so suppressing this stream loses no diagnostic we depend on.
 *
 * Level choice: `logger.debug` is deliberate, not lazy. The app logger's
 * `minLevel` is `__DEV__ ? "debug" : "info"`, so debug records are dropped
 * entirely in production and never reach OTLP/Loki — which is the point,
 * since per-tile failures would otherwise flood the log backend from every
 * user on a weak connection. In dev, debug maps to `console.log`, which
 * LogBox ignores, so the records stay inspectable in the Metro terminal
 * without stealing the screen.
 *
 * This module imports the native MapLibre package, so it must only ever be
 * reached from native-only code (currently InPersonMapView.tsx, which has a
 * `.web.tsx` stub sibling). Do not import it from a shared or web-reachable
 * module.
 */

import { LogManager } from "@maplibre/maplibre-react-native"

import { logger } from "@/utils/logger"

let installed = false

/**
 * Install the log handler. Idempotent — safe to call from module scope on
 * every import, and safe to call again if the map is mounted more than once.
 *
 * `LogManager.start()` / `.stop()` are owned by MapLibre's own `Map`
 * component (its `useLayoutEffect`), so this only swaps the handler and must
 * NOT try to manage the subscription lifecycle itself.
 */
export function installMapLogging(): void {
  if (installed) return
  installed = true

  LogManager.onLog((event) => {
    logger.debug(`MapLibre native: ${event.message}`, {
      tag: event.tag,
      maplibreLevel: event.level,
    })

    // Returning true tells MapLibre we handled this record, which is what
    // skips its own console.error/console.warn. Returning false — or letting
    // this throw — puts the LogBox spam straight back.
    return true
  })
}
