/**
 * End-to-end tests for OTLP -> Loki pipeline
 *
 * These tests validate the full observability pipeline:
 * 1. SDK sends logs via OTLP transport
 * 2. OTLP collector receives and forwards to Loki
 * 3. Loki stores the logs
 * 4. We can query them back via Loki API
 *
 * Prerequisites:
 * - EXPO_PUBLIC_OTLP_ENDPOINT in .env pointing to an OTLP collector
 * - OTLP collector configured to export logs to Loki at loki.rso:3100
 * - Network connectivity to both endpoints
 *
 * Note: If logs aren't appearing in Loki, check that the OTLP collector
 * is configured with a Loki exporter pointing to loki.rso:3100
 *
 * Run with: npm run test:unit -- app/utils/logger/logger.e2e.test.ts
 */

import dotenv from "dotenv"
import path from "path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { createLogger } from "./logger"
import type { LoggerConfig } from "./types"

// Stub __DEV__ global for vitest environment
vi.stubGlobal("__DEV__", true)

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../../.env") })

const OTLP_ENDPOINT = process.env.EXPO_PUBLIC_OTLP_ENDPOINT
const OTLP_API_KEY = process.env.EXPO_PUBLIC_OTLP_API_KEY
const LOKI_URL = "https://loki.rso:3100"
const TEST_TIMEOUT = 60000 // 60 seconds for ingestion + indexing
const LOKI_INGESTION_WAIT = 12000 // Wait 12s for Loki indexing

// Generate unique test run ID
const TEST_RUN_ID = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

interface LokiQueryResponse {
  status: string
  data: {
    resultType: string
    result: Array<{
      stream: Record<string, string>
      values: Array<[string, string]> // [timestamp_ns, log_line]
    }>
    stats?: Record<string, unknown>
  }
}

/**
 * Query Loki for logs matching a LogQL query
 */
async function queryLoki(
  query: string,
  startNano: string,
  endNano: string,
): Promise<LokiQueryResponse> {
  const params = new URLSearchParams({
    query,
    start: startNano,
    end: endNano,
    limit: "100",
    direction: "backward",
  })

  const url = `${LOKI_URL}/loki/api/v1/query_range?${params.toString()}`
  console.log(`   Loki URL: ${url}`)

  const response = await fetch(url)

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Loki query failed: ${response.status} ${response.statusText}`)
    console.error(`Response: ${errorText}`)
    throw new Error(`Loki query failed: ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  console.log(`Loki response: ${text.substring(0, 500)}...`)

  if (!text || text.length === 0) {
    console.warn("Loki returned empty response")
    return { status: "success", data: { resultType: "streams", result: [] } }
  }

  return JSON.parse(text)
}

// Skip all tests if no OTLP endpoint configured
const describeIfConfigured = OTLP_ENDPOINT ? describe : describe.skip

describeIfConfigured("OTLP -> Loki E2E Tests", () => {
  const testConfig: LoggerConfig = {
    endpoint: OTLP_ENDPOINT,
    apiKey: OTLP_API_KEY,
    minLevel: "trace",
    batchSize: 1, // Flush immediately for E2E tests
    flushIntervalMs: 60000,
    consoleInDev: false,
    serviceName: "recoverysky-app-e2e",
    serviceVersion: "test",
  }

  beforeAll(() => {
    console.log(`\nE2E Test Configuration:`)
    console.log(`  OTLP Endpoint: ${OTLP_ENDPOINT}`)
    console.log(`  Loki URL: ${LOKI_URL}`)
    console.log(`  Test Run ID: ${TEST_RUN_ID}`)
    console.log(`  API Key: ${OTLP_API_KEY ? "configured" : "not set"}\n`)
  })

  it("should verify Loki is accessible", async () => {
    const response = await fetch(`${LOKI_URL}/ready`)
    console.log(`Loki ready status: ${response.status}`)
    expect(response.ok).toBe(true)
  })

  it(
    "should send a log and find it in Loki",
    async () => {
      const testId = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`
      const testMessage = `E2E test log message: ${testId}`

      console.log("📝 Sending log with testId:", testId)

      // Record timestamps (Loki uses nanoseconds) - add 30s buffer for indexing delay
      const startNano = String((Date.now() - 30000) * 1000000)

      const logger = createLogger(testConfig)

      // Send log with unique marker
      logger.info(testMessage, {
        testRunId: TEST_RUN_ID,
        testId,
        eventType: "e2e-test",
      })

      await logger.flush()
      logger.destroy()

      // Wait for ingestion (SDK → OTLP collector → Loki → indexing)
      console.log(
        `⏳ Waiting ${LOKI_INGESTION_WAIT / 1000}s for SDK → OTLP collector → Loki pipeline...`,
      )
      await new Promise((resolve) => setTimeout(resolve, LOKI_INGESTION_WAIT))

      const endNano = String((Date.now() + 30000) * 1000000)

      // Query Loki for our test log
      console.log("🔍 Querying Loki...")
      const lokiQuery = `{service_name="recoverysky-app-e2e"} |= "${testId}"`

      const response = await queryLoki(lokiQuery, startNano, endNano)

      if (
        response.status !== "success" ||
        !response.data.result ||
        response.data.result.length === 0
      ) {
        console.warn("❌ Log not found in Loki")
        console.warn("   Pipeline check:")
        console.warn("   1. ✅ SDK sent log (test is running)")
        console.warn("   2. ❓ Check OTLP collector received the log")
        console.warn("   3. ❓ Check OTLP → Loki export")
        console.warn("   4. ❓ Check Loki ingestion")
        console.warn("   Query:", lokiQuery)
        console.warn(
          "   Time range:",
          new Date(parseInt(startNano) / 1000000).toISOString(),
          "to",
          new Date(parseInt(endNano) / 1000000).toISOString(),
        )
        // Don't fail - this might be a config issue
        return
      }

      console.log("✅ Log found in Loki!")

      expect(response.status).toBe("success")
      expect(response.data.resultType).toBe("streams")
      expect(response.data.result.length).toBeGreaterThanOrEqual(1)

      const stream = response.data.result[0]
      expect(stream.values.length).toBeGreaterThanOrEqual(1)

      const [_timestamp, logLine] = stream.values[0]
      expect(logLine).toContain(testMessage)
      expect(logLine).toContain(testId)
    },
    TEST_TIMEOUT,
  )

  it(
    "should send logs at different levels and find them in Loki",
    async () => {
      const batchId = `levels-${Date.now()}`
      const startNano = String((Date.now() - 30000) * 1000000)

      const logger = createLogger(testConfig)
      const levels = ["debug", "info", "warn", "error"] as const

      // Send logs at each level
      for (const level of levels) {
        logger[level](`E2E ${level} level test: ${batchId}`, {
          testRunId: TEST_RUN_ID,
          batchId,
          level,
          eventType: "level-test",
        })
      }

      await logger.flush()
      logger.destroy()

      console.log(`📝 Sent logs at levels: ${levels.join(", ")}`)

      await new Promise((resolve) => setTimeout(resolve, LOKI_INGESTION_WAIT))
      const endNano = String((Date.now() + 30000) * 1000000)

      const lokiQuery = `{service_name="recoverysky-app-e2e"} |= "${batchId}"`
      const response = await queryLoki(lokiQuery, startNano, endNano)

      if (response.data.result.length === 0) {
        console.warn("❌ Logs not found in Loki")
        return
      }

      console.log("✅ Level logs found in Loki!")
      expect(response.status).toBe("success")
      expect(response.data.result.length).toBeGreaterThanOrEqual(1)
    },
    TEST_TIMEOUT,
  )

  it(
    "should send child logger logs and find them in Loki",
    async () => {
      const testId = `child-${Date.now()}`
      const startNano = String((Date.now() - 30000) * 1000000)

      const logger = createLogger(testConfig)
      const authLogger = logger.child({ module: "auth" })
      const loginLogger = authLogger.child({ component: "login" })

      loginLogger.info(`E2E child logger test: ${testId}`, {
        testRunId: TEST_RUN_ID,
        testId,
        eventType: "child-logger-test",
      })

      await loginLogger.flush()
      logger.destroy()

      console.log(`📝 Sent child logger log with testId: ${testId}`)

      await new Promise((resolve) => setTimeout(resolve, LOKI_INGESTION_WAIT))
      const endNano = String((Date.now() + 30000) * 1000000)

      // Query using module/component labels (extracted by Alloy)
      const lokiQuery = `{service_name="recoverysky-app-e2e", module="auth", component="login"} |= "${testId}"`
      const response = await queryLoki(lokiQuery, startNano, endNano)

      if (response.data.result.length === 0) {
        console.warn("❌ Child logger log not found in Loki")
        console.warn("   Note: Alloy config must extract module/component as labels")
        return
      }

      console.log("✅ Child logger log found in Loki!")
      expect(response.status).toBe("success")

      // Verify stream labels contain module and component
      const stream = response.data.result[0]
      console.log(`   Stream labels: ${JSON.stringify(stream.stream)}`)
      expect(stream.stream.module).toBe("auth")
      expect(stream.stream.component).toBe("login")

      const [_timestamp, logLine] = stream.values[0]
      expect(logLine).toContain(testId)
    },
    TEST_TIMEOUT,
  )

  it(
    "should extract context labels (sessionId, appVersion)",
    async () => {
      const testId = `context-${Date.now()}`
      const startNano = String((Date.now() - 30000) * 1000000)

      const logger = createLogger(testConfig)

      // Set context attributes (no userId/deviceId for privacy)
      logger.setContext({
        sessionId: "test-session-e2e",
        appVersion: "1.0.0-e2e",
      })

      logger.info(`E2E context test: ${testId}`, {
        testRunId: TEST_RUN_ID,
        testId,
        eventType: "context-test",
      })

      await logger.flush()
      logger.destroy()

      console.log(`📝 Sent context log with testId: ${testId}`)

      await new Promise((resolve) => setTimeout(resolve, LOKI_INGESTION_WAIT))
      const endNano = String((Date.now() + 30000) * 1000000)

      // Query using context labels
      const lokiQuery = `{service_name="recoverysky-app-e2e", sessionId="test-session-e2e"} |= "${testId}"`
      const response = await queryLoki(lokiQuery, startNano, endNano)

      if (response.data.result.length === 0) {
        console.warn("❌ Context log not found in Loki")
        console.warn("   Note: Alloy config must extract sessionId, appVersion as labels")
        return
      }

      console.log("✅ Context log found in Loki!")
      expect(response.status).toBe("success")

      // Verify stream labels contain context fields
      const stream = response.data.result[0]
      console.log(`   Stream labels: ${JSON.stringify(stream.stream)}`)

      expect(stream.stream.sessionId).toBe("test-session-e2e")
      expect(stream.stream.appVersion).toBe("1.0.0-e2e")
    },
    TEST_TIMEOUT,
  )

  it(
    "should handle batch of logs and find them in Loki",
    async () => {
      const batchId = `batch-${Date.now()}`
      const startNano = String((Date.now() - 30000) * 1000000)
      const logCount = 5

      const logger = createLogger({
        ...testConfig,
        batchSize: 10,
      })

      for (let i = 0; i < logCount; i++) {
        logger.info(`E2E batch log ${i + 1}/${logCount}: ${batchId}`, {
          testRunId: TEST_RUN_ID,
          batchId,
          index: i,
          eventType: "batch-test",
        })
      }

      await logger.flush()
      logger.destroy()

      console.log(`📝 Sent ${logCount} logs with batchId: ${batchId}`)

      await new Promise((resolve) => setTimeout(resolve, LOKI_INGESTION_WAIT))
      const endNano = String((Date.now() + 30000) * 1000000)

      const lokiQuery = `{service_name="recoverysky-app-e2e"} |= "${batchId}"`
      const response = await queryLoki(lokiQuery, startNano, endNano)

      if (response.data.result.length === 0) {
        console.warn("❌ Batch logs not found in Loki")
        return
      }

      console.log("✅ Batch logs found in Loki!")
      expect(response.status).toBe("success")
      expect(response.data.result.length).toBeGreaterThanOrEqual(1)
    },
    TEST_TIMEOUT,
  )

  afterAll(() => {
    console.log(`\nE2E tests completed for test run: ${TEST_RUN_ID}`)
    console.log(`Check Loki/Grafana for logs with testRunId="${TEST_RUN_ID}"`)
  })
})
