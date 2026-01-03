/**
 * Integration tests for OTLP logging
 *
 * These tests actually send logs to the configured OTLP endpoint.
 * Requires EXPO_PUBLIC_OTLP_ENDPOINT to be set in .env
 *
 * Run with: npm run test:unit -- app/utils/logger/logger.integration.test.ts
 */

import dotenv from "dotenv"
import path from "path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { createLogger } from "./logger"
import { sendToOtlp, toOtlpPayload } from "./otlp"
import type { LogRecord, LoggerConfig } from "./types"

// Stub __DEV__ global for vitest environment
vi.stubGlobal("__DEV__", true)

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../../.env") })

const OTLP_ENDPOINT = process.env.EXPO_PUBLIC_OTLP_ENDPOINT
const OTLP_API_KEY = process.env.EXPO_PUBLIC_OTLP_API_KEY

// Skip all tests if no endpoint configured
const describeIfEndpoint = OTLP_ENDPOINT ? describe : describe.skip

describeIfEndpoint("OTLP Integration Tests", () => {
  const testConfig: LoggerConfig = {
    endpoint: OTLP_ENDPOINT,
    apiKey: OTLP_API_KEY,
    minLevel: "trace",
    batchSize: 10,
    flushIntervalMs: 30000,
    consoleInDev: false,
    serviceName: "recoverysky-app-test",
    serviceVersion: "test",
  }

  beforeAll(() => {
    console.log(`OTLP Endpoint: ${OTLP_ENDPOINT}`)
    console.log(`API Key configured: ${OTLP_API_KEY ? "yes" : "no"}`)
  })

  describe("sendToOtlp", () => {
    it("should successfully send a single log record", async () => {
      const records: LogRecord[] = [
        {
          timestamp: Date.now(),
          level: "info",
          message: "Integration test - single log",
          attributes: {
            test: "true",
            testName: "single-log-test",
          },
        },
      ]

      const result = await sendToOtlp(records, testConfig)

      if (!result.ok) {
        console.log("OTLP Error:", result.error)
      }

      expect(result.ok).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it("should successfully send multiple log records", async () => {
      const now = Date.now()
      const records: LogRecord[] = [
        {
          timestamp: now,
          level: "debug",
          message: "Integration test - batch log 1",
          attributes: { batch: "1", testName: "batch-log-test" },
        },
        {
          timestamp: now + 1,
          level: "info",
          message: "Integration test - batch log 2",
          attributes: { batch: "2", testName: "batch-log-test" },
        },
        {
          timestamp: now + 2,
          level: "warn",
          message: "Integration test - batch log 3",
          attributes: { batch: "3", testName: "batch-log-test" },
        },
      ]

      const result = await sendToOtlp(records, testConfig)

      expect(result.ok).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it("should send logs with trace context", async () => {
      const records: LogRecord[] = [
        {
          timestamp: Date.now(),
          level: "info",
          message: "Integration test - with trace context",
          attributes: { testName: "trace-context-test" },
          traceId: "0af7651916cd43dd8448eb211c80319c",
          spanId: "b7ad6b7169203331",
        },
      ]

      const result = await sendToOtlp(records, testConfig)

      expect(result.ok).toBe(true)
    })

    it("should send all log levels", async () => {
      const now = Date.now()
      const levels = ["trace", "debug", "info", "warn", "error", "fatal"] as const
      const records: LogRecord[] = levels.map((level, i) => ({
        timestamp: now + i,
        level,
        message: `Integration test - ${level} level`,
        attributes: { testName: "all-levels-test", level },
      }))

      const result = await sendToOtlp(records, testConfig)

      expect(result.ok).toBe(true)
    })
  })

  describe("toOtlpPayload", () => {
    it("should generate valid OTLP payload structure", () => {
      const records: LogRecord[] = [
        {
          timestamp: 1704067200000, // Fixed timestamp for snapshot
          level: "info",
          message: "Test message",
          attributes: { key: "value", count: 42 },
        },
      ]

      const payload = toOtlpPayload(records, testConfig)

      // Verify structure
      expect(payload.resourceLogs).toHaveLength(1)
      expect(payload.resourceLogs[0].resource.attributes).toContainEqual({
        key: "service.name",
        value: { stringValue: "recoverysky-app-test" },
      })
      expect(payload.resourceLogs[0].scopeLogs).toHaveLength(1)
      expect(payload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1)

      const logRecord = payload.resourceLogs[0].scopeLogs[0].logRecords[0]
      expect(logRecord.severityNumber).toBe(9) // INFO
      expect(logRecord.severityText).toBe("INFO")
      expect(logRecord.body.stringValue).toBe("Test message")
      expect(logRecord.attributes).toContainEqual({
        key: "key",
        value: { stringValue: "value" },
      })
      expect(logRecord.attributes).toContainEqual({
        key: "count",
        value: { intValue: "42" },
      })
    })
  })

  describe("Logger end-to-end", () => {
    it("should send logs via flush()", async () => {
      const logger = createLogger({
        ...testConfig,
        serviceName: "recoverysky-app-e2e-test",
      })

      logger.info("E2E test - manual flush", {
        testName: "e2e-flush-test",
        timestamp: new Date().toISOString(),
      })

      logger.warn("E2E test - warning log", {
        testName: "e2e-flush-test",
        warningType: "test-warning",
      })

      // Manually flush and verify no errors
      await expect(logger.flush()).resolves.not.toThrow()

      logger.destroy()
    })

    it("should send logs with child logger attributes", async () => {
      const logger = createLogger({
        ...testConfig,
        serviceName: "recoverysky-app-child-test",
      })

      const authLogger = logger.child({ module: "auth" })
      const loginLogger = authLogger.child({ component: "login" })

      loginLogger.info("E2E test - child logger", {
        testName: "e2e-child-logger-test",
        userId: "test-user-123",
      })

      await expect(loginLogger.flush()).resolves.not.toThrow()

      logger.destroy()
    })

    it("should send logs with trace context", async () => {
      const logger = createLogger({
        ...testConfig,
        serviceName: "recoverysky-app-trace-test",
      })

      logger.setTraceContext("0af7651916cd43dd8448eb211c80319c", "b7ad6b7169203331")

      logger.info("E2E test - with trace context", {
        testName: "e2e-trace-context-test",
        operation: "user-login",
      })

      await expect(logger.flush()).resolves.not.toThrow()

      logger.destroy()
    })

    it("should handle high-volume logging", async () => {
      const logger = createLogger({
        ...testConfig,
        serviceName: "recoverysky-app-volume-test",
        batchSize: 50,
      })

      // Generate 100 logs
      for (let i = 0; i < 100; i++) {
        logger.info(`E2E test - high volume log ${i}`, {
          testName: "e2e-volume-test",
          index: i,
          batch: Math.floor(i / 50),
        })
      }

      await expect(logger.flush()).resolves.not.toThrow()

      logger.destroy()
    })
  })

  describe("Error scenarios", () => {
    it("should handle invalid endpoint gracefully", async () => {
      const records: LogRecord[] = [
        {
          timestamp: Date.now(),
          level: "info",
          message: "Test with bad endpoint",
          attributes: {},
        },
      ]

      const badConfig: LoggerConfig = {
        ...testConfig,
        endpoint: "https://invalid.endpoint.that.does.not.exist.example.com",
      }

      const result = await sendToOtlp(records, badConfig)

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it("should return ok when no endpoint configured", async () => {
      const records: LogRecord[] = [
        {
          timestamp: Date.now(),
          level: "info",
          message: "Test without endpoint",
          attributes: {},
        },
      ]

      const noEndpointConfig: LoggerConfig = {
        ...testConfig,
        endpoint: undefined,
      }

      const result = await sendToOtlp(records, noEndpointConfig)

      // Should return ok: true (silent drop)
      expect(result.ok).toBe(true)
    })
  })

  afterAll(() => {
    console.log("\nIntegration tests completed. Check your OTLP backend for received logs.")
  })
})
