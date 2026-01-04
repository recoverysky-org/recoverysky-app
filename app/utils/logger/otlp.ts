/**
 * OTLP Log format utilities
 * @see https://opentelemetry.io/docs/specs/otel/logs/data-model/
 */

import type { LogRecord, LogLevel, LoggerConfig } from "./types"

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
 * Convert internal log records to OTLP format
 */
export function toOtlpPayload(records: LogRecord[], config: LoggerConfig): OtlpLogsPayload {
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
          attributes: [
            { key: "service.name", value: { stringValue: config.serviceName } },
            {
              key: "service.version",
              value: { stringValue: config.serviceVersion },
            },
          ],
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
): Promise<{ ok: boolean; error?: string }> {
  if (!config.endpoint) {
    return { ok: true } // No endpoint = silent drop
  }

  const payload = toOtlpPayload(records, config)

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
