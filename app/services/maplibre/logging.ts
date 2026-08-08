/**
 * mapLogging — keeps MapLibre Native's internal log stream off the console.
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
 * Destination: a bare `console.log` in `__DEV__`, and nothing at all in
 * production. Notably NOT the app logger.
 *
 * CHANGED 2026-08-08: this first shipped as `logger.debug`, reasoning that the
 * app logger's `minLevel` (`__DEV__ ? "debug" : "info"`) would drop the
 * records in production. That much was true, but it made development
 * materially worse: in dev, `minLevel` IS `"debug"`, so every record passed
 * `shouldLog`, landed in the OTLP buffer, and got shipped to Loki over the
 * network. Since the records being logged are overwhelmingly *network
 * failures*, that closed a feedback loop — a failing tile produced a log
 * record, the record produced an HTTP POST, the POST competed with the tile
 * retries, and the whole thing amplified itself. The observed symptom was a
 * rising tide of "The network connection was lost" glyph and tile errors.
 * MapLibre's stream is high-volume diagnostic chatter; it must never touch a
 * transport that costs anything.
 *
 * This module imports the native MapLibre package, so it must only ever be
 * reached from native-only code (currently InPersonMapView.tsx, which has a
 * `.web.tsx` stub sibling). Do not import it from a shared or web-reachable
 * module.
 */

import { LogManager } from "@maplibre/maplibre-react-native"

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
    // This handler must never throw. MapLibre calls it from its native log
    // event callback for EVERY record, so an exception here is raised once per
    // record — during a tile-failure storm that is hundreds of fatals, each
    // one captured by Sentry, which is far worse than the console spam this
    // exists to prevent. (Seen for real on 2026-08-08: a half-applied edit
    // left a dangling `logger` reference here and Fast Refresh loaded it,
    // turning every map log line into a fatal ReferenceError.) The catch is
    // deliberately silent — there is nowhere safe to report from inside it.
    try {
      // console.log, not console.error/warn: LogBox only intercepts the latter
      // two, so this stays in the Metro terminal instead of covering the app.
      // Stripped entirely in production — there is no consumer for it there,
      // and see the header for why it must not go to the app logger.
      if (__DEV__) {
        console.log(`MapLibre native [${event.level}] ${event.message}`)
      }
    } catch {
      // Swallowed on purpose — see above.
    }

    // Returning true tells MapLibre we handled this record, which is what
    // skips its own console.error/console.warn. Returning false — or letting
    // this throw — puts the LogBox spam straight back.
    return true
  })
}
