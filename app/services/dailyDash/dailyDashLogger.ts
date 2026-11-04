import { createLogger } from "@daily-dash/client"
import type { LogLine, Logger } from "@daily-dash/client"

import { logger } from "@/utils/logger"

import { toDailyDashAttributes } from "./dailyDashLogLogic"

/**
 * The client's house logger over the app's OTLP logger. ADDED 2026-11-04.
 *
 * The client calls `log.info(fields, msg)` (object first); the app's logger is
 * `log.info(msg, attributes)`. The sink swaps the order and flattens the fields
 * through `toDailyDashAttributes`, which drops `cause` (spec §4.8) and moves
 * the client's `module` to `ddModule`, so every Daily Dash line lands in Loki
 * under `module: "DailyDash"` with the app's
 * sessionId/appVersion/deviceId context like any other record. The client
 * already never logs content or identity (its standards §3.3); this side adds
 * nothing personal either.
 *
 * `host: "recoverysky"` is the client logger's own binding, so lines from the
 * same packages inside the Daily Dash app and inside RecoverySky can be told
 * apart in shared dashboards.
 */
export function createDailyDashLogger(): Logger {
  const appLog = logger.child({ module: "DailyDash" })
  // `level`/`msg` are the line's reserved keys; everything else is the call's
  // fields plus the bindings, already flat (client `composeLine`). A throwing
  // sink is swallowed by the client's createLogger, so no try here.
  // CHANGED 2026-11-04: `toDailyDashAttributes`, not bare `toLogAttributes`.
  // The client's own children bind `module: "api" | "db" | "sync" | "session"`,
  // which would override `module: "DailyDash"` below and split these lines
  // across other modules' Loki streams; it is forwarded as `ddModule` instead.
  const sink = (line: LogLine) => {
    const { level, msg, ...rest } = line
    appLog[level](msg, toDailyDashAttributes(rest))
  }
  return createLogger(sink, { host: "recoverysky" })
}
