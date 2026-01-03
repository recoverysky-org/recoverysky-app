import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createLogger } from "./logger"
import * as otlp from "./otlp"

// Mock the otlp module
vi.mock("./otlp", () => ({
  sendToOtlp: vi.fn().mockResolvedValue({ ok: true }),
}))

// Mock __DEV__ global
declare const __DEV__: boolean
vi.stubGlobal("__DEV__", true)

describe("Logger", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("createLogger", () => {
    it("should create a logger with default config", () => {
      const logger = createLogger()

      expect(logger).toBeDefined()
      expect(logger.info).toBeInstanceOf(Function)
      expect(logger.error).toBeInstanceOf(Function)
      expect(logger.debug).toBeInstanceOf(Function)
      expect(logger.warn).toBeInstanceOf(Function)
      expect(logger.trace).toBeInstanceOf(Function)
      expect(logger.fatal).toBeInstanceOf(Function)
      expect(logger.flush).toBeInstanceOf(Function)
      expect(logger.child).toBeInstanceOf(Function)

      logger.destroy()
    })

    it("should accept custom config", () => {
      const logger = createLogger({
        endpoint: "https://test.example.com",
        apiKey: "test-key",
        minLevel: "warn",
        batchSize: 5,
        flushIntervalMs: 1000,
        serviceName: "test-service",
        serviceVersion: "1.0.0",
      })

      expect(logger).toBeDefined()
      logger.destroy()
    })
  })

  describe("log level filtering", () => {
    it("should filter logs below minLevel", async () => {
      const logger = createLogger({
        minLevel: "warn",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.trace("trace message")
      logger.debug("debug message")
      logger.info("info message")
      logger.warn("warn message")
      logger.error("error message")

      await logger.flush()

      expect(otlp.sendToOtlp).toHaveBeenCalledTimes(1)
      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]

      // Only warn and error should be in the buffer
      expect(records).toHaveLength(2)
      expect(records[0].level).toBe("warn")
      expect(records[1].level).toBe("error")

      logger.destroy()
    })

    it("should log all levels when minLevel is trace", async () => {
      const logger = createLogger({
        minLevel: "trace",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.trace("trace")
      logger.debug("debug")
      logger.info("info")
      logger.warn("warn")
      logger.error("error")
      logger.fatal("fatal")

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records).toHaveLength(6)

      logger.destroy()
    })
  })

  describe("log record structure", () => {
    it("should create proper log records with message and attributes", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.info("Test message", { userId: "123", action: "login" })

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({
        level: "info",
        message: "Test message",
        attributes: { userId: "123", action: "login" },
      })
      expect(records[0].timestamp).toBeTypeOf("number")

      logger.destroy()
    })

    it("should handle logs without attributes", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.info("Simple message")

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({})

      logger.destroy()
    })
  })

  describe("batching and flushing", () => {
    it("should batch logs and flush when batchSize is reached", async () => {
      const logger = createLogger({
        minLevel: "info",
        batchSize: 3,
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.info("message 1")
      logger.info("message 2")

      // Not yet flushed
      expect(otlp.sendToOtlp).not.toHaveBeenCalled()

      logger.info("message 3") // This should trigger flush

      // Wait for the promise to resolve (flush is async but triggered immediately)
      await Promise.resolve()

      expect(otlp.sendToOtlp).toHaveBeenCalledTimes(1)
      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records).toHaveLength(3)

      logger.destroy()
    })

    it("should flush on interval", async () => {
      const logger = createLogger({
        minLevel: "info",
        batchSize: 100,
        flushIntervalMs: 5000,
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.info("message 1")
      logger.info("message 2")

      expect(otlp.sendToOtlp).not.toHaveBeenCalled()

      // Advance time by flush interval
      await vi.advanceTimersByTimeAsync(5000)

      expect(otlp.sendToOtlp).toHaveBeenCalledTimes(1)

      logger.destroy()
    })

    it("should not call sendToOtlp when buffer is empty", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      await logger.flush()

      expect(otlp.sendToOtlp).not.toHaveBeenCalled()

      logger.destroy()
    })
  })

  describe("trace context", () => {
    it("should include trace context in log records", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.setTraceContext("trace-123", "span-456")
      logger.info("With trace context")

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].traceId).toBe("trace-123")
      expect(records[0].spanId).toBe("span-456")

      logger.destroy()
    })

    it("should clear trace context", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.setTraceContext("trace-123", "span-456")
      logger.info("With trace context")
      logger.clearTraceContext()
      logger.info("Without trace context")

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].traceId).toBe("trace-123")
      expect(records[1].traceId).toBeUndefined()

      logger.destroy()
    })
  })

  describe("child loggers", () => {
    it("should create child logger with inherited attributes", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      const childLogger = logger.child({ module: "auth", component: "login" })
      childLogger.info("Child message", { extra: "value" })

      await childLogger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({
        module: "auth",
        component: "login",
        extra: "value",
      })

      logger.destroy()
    })

    it("should allow nested child loggers", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      const authLogger = logger.child({ module: "auth" })
      const loginLogger = authLogger.child({ component: "login" })
      loginLogger.info("Nested child message")

      await loginLogger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({
        module: "auth",
        component: "login",
      })

      logger.destroy()
    })

    it("should override parent attributes with child attributes", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      const childLogger = logger.child({ value: "parent" })
      const grandchildLogger = childLogger.child({ value: "child" })
      grandchildLogger.info("Override test")

      await grandchildLogger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes.value).toBe("child")

      logger.destroy()
    })
  })

  describe("context", () => {
    it("should include context attributes in log records", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.setContext({
        sessionId: "session-xyz",
        appVersion: "1.0.0",
      })
      logger.info("With context")

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({
        sessionId: "session-xyz",
        appVersion: "1.0.0",
      })

      logger.destroy()
    })

    it("should merge partial context updates", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.setContext({ appVersion: "1.0.0" })
      logger.setContext({ sessionId: "session-xyz" }) // Should merge, not replace
      logger.info("Merged context")

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({
        sessionId: "session-xyz",
        appVersion: "1.0.0",
      })

      logger.destroy()
    })

    it("should clear context", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.setContext({ sessionId: "session-xyz", appVersion: "1.0.0" })
      logger.info("With context")
      logger.clearContext()
      logger.info("Without context")

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes.sessionId).toBe("session-xyz")
      expect(records[1].attributes.sessionId).toBeUndefined()

      logger.destroy()
    })

    it("should pass context to child loggers", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.setContext({ sessionId: "session-xyz" })
      const childLogger = logger.child({ module: "auth" })
      childLogger.info("Child with context")

      await childLogger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({
        sessionId: "session-xyz",
        module: "auth",
      })

      logger.destroy()
    })

    it("should prioritize per-call attributes over context", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.setContext({ sessionId: "context-session" })
      logger.info("Override test", { sessionId: "override-session" })

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes.sessionId).toBe("override-session")

      logger.destroy()
    })
  })

  describe("console output in dev", () => {
    it("should log to console when consoleInDev is true and __DEV__ is true", () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {})

      const logger = createLogger({
        minLevel: "info",
        consoleInDev: true,
      })

      logger.info("Console test", { key: "value" })

      expect(consoleSpy).toHaveBeenCalledWith('[INFO] Console test {"key":"value"}')

      consoleSpy.mockRestore()
      logger.destroy()
    })

    it("should not log to console when consoleInDev is false", () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {})

      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
      })

      logger.info("No console test")

      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
      logger.destroy()
    })

    it("should use correct console method for each level", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      const logger = createLogger({
        minLevel: "trace",
        consoleInDev: true,
      })

      logger.trace("trace")
      logger.debug("debug")
      logger.info("info")
      logger.warn("warn")
      logger.error("error")
      logger.fatal("fatal")

      expect(logSpy).toHaveBeenCalledTimes(2) // trace and debug
      expect(infoSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledTimes(2) // error and fatal

      logSpy.mockRestore()
      infoSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
      logger.destroy()
    })
  })

  describe("destroy", () => {
    it("should stop flush timer and perform final flush", async () => {
      const logger = createLogger({
        minLevel: "info",
        flushIntervalMs: 5000,
        consoleInDev: false,
        endpoint: "https://test.example.com",
      })

      logger.info("Before destroy")
      logger.destroy()

      // Wait for any async operations
      await vi.runAllTimersAsync()

      expect(otlp.sendToOtlp).toHaveBeenCalled()

      // Advancing time should not trigger additional flushes
      vi.clearAllMocks()
      await vi.advanceTimersByTimeAsync(10000)

      expect(otlp.sendToOtlp).not.toHaveBeenCalled()
    })
  })

  describe("error handling", () => {
    it("should handle sendToOtlp failures gracefully", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      vi.mocked(otlp.sendToOtlp).mockResolvedValueOnce({ ok: false, error: "Network error" })

      const logger = createLogger({
        minLevel: "info",
        consoleInDev: true,
        endpoint: "https://test.example.com",
      })

      logger.info("Test message")
      await logger.flush()

      expect(warnSpy).toHaveBeenCalledWith("[Logger] Failed to send logs: Network error")

      warnSpy.mockRestore()
      logger.destroy()
    })
  })
})
