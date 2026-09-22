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
        apiKey: "test-key",
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
        apiKey: "test-key",
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
        apiKey: "test-key",
      })

      logger.info("Test message", { requestId: "123", action: "login" })

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({
        level: "info",
        message: "Test message",
        attributes: { requestId: "123", action: "login" },
      })
      expect(records[0].timestamp).toBeTypeOf("number")

      logger.destroy()
    })

    it("should handle logs without attributes", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
        apiKey: "test-key",
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
        apiKey: "test-key",
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
        apiKey: "test-key",
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
        apiKey: "test-key",
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
        apiKey: "test-key",
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
        apiKey: "test-key",
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
        apiKey: "test-key",
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
        apiKey: "test-key",
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
        apiKey: "test-key",
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
        apiKey: "test-key",
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

    it("should pass full context to sendToOtlp as the third arg", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
        apiKey: "test-key",
      })

      logger.setContext({
        sessionId: "session-xyz",
        appVersion: "1.0.0",
        deviceId: "device-abc",
      })
      logger.info("With full context")

      await logger.flush()

      // Third argument to sendToOtlp is the LoggerContext; it populates the
      // OTLP Resource's service.version (identity is per-record — RS-042).
      const call = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(call[2]).toEqual({
        sessionId: "session-xyz",
        appVersion: "1.0.0",
        deviceId: "device-abc",
      })

      logger.destroy()
    })

    it("should stamp userId from context onto every record", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
        apiKey: "test-key",
      })

      logger.setContext({ userId: "0123456789abcdef" })
      logger.info("With user")

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({ userId: "0123456789abcdef" })

      logger.destroy()
    })

    it("should drop userId from records once context clears it", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
        apiKey: "test-key",
      })

      logger.setContext({ userId: "0123456789abcdef" })
      logger.setContext({ userId: undefined }) // sign-out
      logger.info("After sign-out")

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({})

      logger.destroy()
    })

    it("should merge partial context updates", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
        apiKey: "test-key",
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
        apiKey: "test-key",
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
        apiKey: "test-key",
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

    // RS-026: a child created BEFORE setContext must still see the context.
    // Module-scope loggers (`const log = logger.child({ module })`) are created
    // during import, long before app.tsx sets sessionId/appVersion, deviceId,
    // and the hashed userId — if the child holds a snapshot, every line those
    // modules ever emit lacks all four fields.
    it("should give a child created before setContext the later context", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
        apiKey: "test-key",
      })

      const childLogger = logger.child({ module: "App" })
      logger.setContext({ sessionId: "session-xyz", appVersion: "4.10.1-5" })
      logger.setContext({ deviceId: "device-abc" })
      logger.setContext({ userId: "0123456789abcdef" })
      childLogger.info("Emitted after the root context filled in")

      await childLogger.flush()

      const [records, , context] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({
        sessionId: "session-xyz",
        appVersion: "4.10.1-5",
        deviceId: "device-abc",
        userId: "0123456789abcdef",
        module: "App",
      })
      // The same object reaches sendToOtlp at flush time (service.version).
      expect(context).toEqual({
        sessionId: "session-xyz",
        appVersion: "4.10.1-5",
        deviceId: "device-abc",
        userId: "0123456789abcdef",
      })

      logger.destroy()
    })

    it("should clear a pre-existing child's context when the root clears", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
        apiKey: "test-key",
      })

      logger.setContext({ sessionId: "session-xyz", userId: "0123456789abcdef" })
      const childLogger = logger.child({ module: "App" })
      logger.clearContext()
      childLogger.info("After clear")

      await childLogger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({ module: "App" })

      logger.destroy()
    })

    // CHANGED 2026-09-22 (RS-043): context keys are reserved — per-call values
    // used to win, which is how a raw-sub prefix replaced the hashed userId.
    it("should not let per-call attributes override context keys", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
        apiKey: "test-key",
      })

      logger.setContext({ sessionId: "context-session", userId: "0123456789abcdef" })
      logger.info("Override test", {
        sessionId: "override-session",
        userId: "google-o...",
        user_id: "forged",
        module: "kept",
      })

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({
        sessionId: "context-session",
        userId: "0123456789abcdef",
        module: "kept",
      })

      logger.destroy()
    })

    it("should drop a per-call context key even when context lacks it", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
        apiKey: "test-key",
      })

      // Anonymous user: no userId in context, so there is nothing to win the
      // spread — the caller's value must still not reach the record.
      logger.setContext({ deviceId: "device-hash" })
      logger.info("Anonymous", { userId: "auth0|6a...", deviceId: "raw-dev..." })

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({ deviceId: "device-hash" })

      logger.destroy()
    })

    it("should not let child attributes override context keys", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
        apiKey: "test-key",
      })

      logger.setContext({ appVersion: "4.10.1-8" })
      const child = logger.child({ module: "Push", appVersion: "stale" })
      child.info("From child")

      await child.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({ appVersion: "4.10.1-8", module: "Push" })

      logger.destroy()
    })

    it("should keep traceId as an ordinary per-call attribute", async () => {
      const logger = createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
        apiKey: "test-key",
      })

      logger.info("API request", { traceId: "4bf92f3577b34da6a3ce929d0e0e4736" })

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736")

      logger.destroy()
    })
  })

  // RS-042: cold-start lines are logged before app.tsx knows deviceId/userId
  // and held until /config supplies the OTLP key. They used to reach Loki
  // with identity only as the flush-time Resource (snake_case user_id).
  describe("late-bound identity", () => {
    const make = () =>
      createLogger({
        minLevel: "info",
        consoleInDev: false,
        endpoint: "https://test.example.com",
        apiKey: "test-key",
      })

    it("should fill never-set keys from the context at flush", async () => {
      const logger = make()

      logger.info("App module loaded")
      logger.setContext({ sessionId: "session-xyz", appVersion: "4.10.1-9" })
      logger.info("getDeviceId()")
      logger.setContext({ deviceId: "device-abc" })
      logger.setContext({ userId: "0123456789abcdef" })

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      const full = {
        sessionId: "session-xyz",
        appVersion: "4.10.1-9",
        deviceId: "device-abc",
        userId: "0123456789abcdef",
      }
      expect(records[0].attributes).toEqual(full)
      expect(records[1].attributes).toEqual(full)
      expect(records[0].pendingContext).toBeUndefined()
      expect(records[1].pendingContext).toBeUndefined()

      logger.destroy()
    })

    it("should not back-fill a key resolved as absent (anonymous user)", async () => {
      const logger = make()

      // app.tsx writes userId: hashUserId(undefined) === undefined for an
      // anonymous user — that resolves the key.
      logger.setContext({ deviceId: "device-abc", userId: undefined })
      logger.info("Anonymous line")
      logger.setContext({ userId: "0123456789abcdef" })

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes).toEqual({ deviceId: "device-abc" })

      logger.destroy()
    })

    it("should not give a signed-out line the next sign-in's identity", async () => {
      const logger = make()

      logger.setContext({ userId: "aaaaaaaaaaaaaaaa" })
      logger.setContext({ userId: undefined })
      logger.info("Signed out")
      logger.setContext({ userId: "bbbbbbbbbbbbbbbb" })

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes.userId).toBeUndefined()

      logger.destroy()
    })

    it("should keep a value the record already carried", async () => {
      const logger = make()

      logger.setContext({ deviceId: "device-old" })
      logger.info("Before userId")
      logger.setContext({ deviceId: "device-new", userId: "0123456789abcdef" })

      await logger.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(records[0].attributes.deviceId).toBe("device-old")
      expect(records[0].attributes.userId).toBe("0123456789abcdef")

      logger.destroy()
    })

    it("should share resolved keys with a child created before setContext", async () => {
      const logger = make()
      const child = logger.child({ module: "sqliteKey" })

      child.info("loadSqliteEncryptionKey()")
      logger.setContext({ deviceId: "device-abc", userId: undefined })
      child.info("After resolution")
      logger.setContext({ userId: "0123456789abcdef" })

      await child.flush()

      const [records] = (otlp.sendToOtlp as ReturnType<typeof vi.fn>).mock.calls[0]
      // Logged while userId was unresolved → filled.
      expect(records[0].attributes.userId).toBe("0123456789abcdef")
      // Logged after the root resolved userId as absent → not filled.
      expect(records[1].attributes.userId).toBeUndefined()
      expect(records[1].attributes.deviceId).toBe("device-abc")

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
        apiKey: "test-key",
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
        apiKey: "test-key",
      })

      logger.info("Test message")
      await logger.flush()

      expect(warnSpy).toHaveBeenCalledWith(
        "[Logger] Failed to send 1 logs, re-queued: Network error",
      )

      warnSpy.mockRestore()
      logger.destroy()
    })
  })
})
