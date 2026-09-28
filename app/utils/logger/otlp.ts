/**
 * OTLP Log format utilities
 * @see https://opentelemetry.io/docs/specs/otel/logs/data-model/
 */

import type { LogRecord, LogLevel, LoggerConfig, LoggerContext } from "./types"

/** OTLP severity numbers */
const SEVERITY_NUMBER: Record<LogLevel, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
}

const SEVERITY_TEXT: Record<LogLevel, string> = {
  trace: "TRACE",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  fatal: "FATAL",
}

interface OtlpLogRecord {
  timeUnixNano: string
  severityNumber: number
  severityText: string
  body: { stringValue: string }
  attributes: Array<{
    key: string
    value: { stringValue?: string; intValue?: string; boolValue?: boolean }
  }>
  traceId?: string
  spanId?: string
}

interface OtlpLogsPayload {
  resourceLogs: Array<{
    resource: {
      attributes: Array<{
        key: string
        value: { stringValue: string }
      }>
    }
    scopeLogs: Array<{
      scope: { name: string; version?: string }
      logRecords: OtlpLogRecord[]
    }>
  }>
}

/**
 * Build the OTLP Resource attributes array, using canonical OpenTelemetry
 * semantic convention names:
 *
 *   serviceName → `service.name`
 *   appVersion  → `service.version`  (context value overrides the static
 *                                     config value)
 *
 * CHANGED 2026-09-22 (RS-042): identity used to ride here too, as `device.id`
 * / `session.id` / `user.id`, with the camelCase copies kept on each record
 * "during the migration window". Loki surfaced those as a second spelling
 * (`device_id`, `session_id`, `user_id`), and because the Resource was built
 * from the context at FLUSH time while records carry the context at LOG time,
 * every cold-start line had only the snake_case one — ~35 lines per launch,
 * silently missed by `| userId="<hash>"`. Nothing promoted them to labels.
 * The logger now late-binds identity onto those records itself
 * (`resolvePendingContext` in logger.ts), so the per-record camelCase fields
 * are complete and the only spelling. Don't re-add the identity keys here.
 */
function buildResourceAttributes(
  config: LoggerConfig,
  context: LoggerContext | undefined,
): Array<{ key: string; value: { stringValue: string } }> {
  const attrs: Array<{ key: string; value: { stringValue: string } }> = [
    { key: "service.name", value: { stringValue: config.serviceName } },
    {
      key: "service.version",
      value: { stringValue: context?.appVersion ?? config.serviceVersion },
    },
  ]
  return attrs
}

/**
 * Convert internal log records to OTLP format.
 *
 * `context` is optional and supplies `appVersion` for the Resource's
 * `service.version` (see `buildResourceAttributes`). Identity lives on
 * `record.attributes` only (RS-042).
 */
export function toOtlpPayload(
  records: LogRecord[],
  config: LoggerConfig,
  context?: LoggerContext,
): OtlpLogsPayload {
  const otlpRecords: OtlpLogRecord[] = records.map((record) => ({
    timeUnixNano: (record.timestamp * 1_000_000).toString(),
    severityNumber: SEVERITY_NUMBER[record.level],
    severityText: SEVERITY_TEXT[record.level],
    body: { stringValue: record.message },
    attributes: Object.entries(record.attributes)
      .filter(([_, v]) => v !== undefined)
      .map(([key, value]) => ({
        key,
        value:
          typeof value === "string"
            ? { stringValue: value }
            : typeof value === "number"
              ? { intValue: value.toString() }
              : { boolValue: value as boolean },
      })),
    ...(record.traceId && { traceId: record.traceId }),
    ...(record.spanId && { spanId: record.spanId }),
  }))

  return {
    resourceLogs: [
      {
        resource: {
          attributes: buildResourceAttributes(config, context),
        },
        scopeLogs: [
          {
            scope: { name: "recoverysky-logger" },
            logRecords: otlpRecords,
          },
        ],
      },
    ],
  }
}

/**
 * Send logs to OTLP endpoint
 */
export async function sendToOtlp(
  records: LogRecord[],
  config: LoggerConfig,
  context?: LoggerContext,
): Promise<{ ok: boolean; error?: string }> {
  if (!config.endpoint || !config.apiKey) {
    return { ok: true } // No endpoint or API key = silent drop
  }

  const payload = toOtlpPayload(records, config, context)

  try {
    const response = await fetch(`${config.endpoint}/v1/logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey && { "X-API-Key": config.apiKey }),
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` }
    }

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
